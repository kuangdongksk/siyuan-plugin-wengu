import { agentChatOnce, type AiSessionGroup } from "../../ai/client";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { detectWindowPrompt } from "../../ai/prompts/convert";
import type { QuestionType } from "../../types";
import { normalizeType } from "../../types";
import { chunkKramdown, isMaterialKramdown, parseVerdict } from "./ConvertService";

/**
 * 转换前置检测与预览行（从 ConvertBatch 拆出，保主文件 ≤500 行）：
 * detectQuestions 问 AI「能否出题+现成题数+题型」——长文档按空行边界
 * 分段**并行计数、总和=全文题数**（20260829 用户反馈「检测数远小于实际
 * 题数」：旧实现只把前 12k 前缀发给 AI 数，长卷必然报小）；20260910 起
 * 各段顺带报题型（TYPES 行），并集喂生成端的题型化 prompt；questionPreview
 * 从题目 kramdown 抽「题号 题型 题干片段」供弹窗渐进预览。
 */

/** 检测分段：单次计数调用最多看 N 字符（输入越长内核 AI 越易超时），
 *  超窗文档分段各数各的、按题干起点归属本段（跨段题不重不漏）。 */
const DETECT_CHARS = 12000;

/** 分段计数并发上限（agentChatOnce 独立会话天然并发，小池限流）。 */
const DETECT_PARALLEL = 4;

/** 前置检测：能否出题 + 原文现成题目数（试卷题库才有意义）。
 *  truncated=有分段计数失败，count 是成功分段之和的下限（N+）。 */
export interface DetectResult {
    can: boolean;
    reason: string;
    /** 原文现成题目数；讲义/无法判定为 undefined。 */
    count?: number;
    /** 有分段计数失败，计数只覆盖成功分段。 */
    truncated?: boolean;
    /** 各段题型并集（生成端题型化 prompt 的输入）；讲义/全部段落都
     *  没报题型时 undefined——调用方回退全题型。 */
    types?: QuestionType[];
}

/** 从检测回复取 COUNT 数字（带 + 也只取数字——加号由本模块按分段
 *  失败自行标注，不再让 AI 输出）。 */
export function parseCount(reply: string): number | undefined {
    const cm = /COUNT\s*[:：]\s*(\d+)/i.exec(reply);
    return cm ? Number(cm[1]) : undefined;
}

/** 从检测回复取 TYPES 题型（normalizeType 容错中英别名；无 TYPES 行/
 *  全部无法识别返回空数组）。 */
export function parseTypes(reply: string): QuestionType[] {
    const m = /TYPES\s*[:：]\s*([^\n]+)/i.exec(reply);
    if (!m) return [];
    const out: QuestionType[] = [];
    for (const tok of m[1].split(/[\s,，、;；/|]+/)) {
        const t = normalizeType(tok);
        if (t && !out.includes(t)) out.push(t);
    }
    return out;
}

/** 分段并行计数（独立会话天然并发，小池限流）。首段失败=整个检测
 *  失败上抛（调用方不阻断转换）；其余段失败留空计 truncated，
 *  count 仍是成功段之和（N+ 下限）。 */
export async function detectQuestions(
    source: string,
    modelId: string,
    signal?: AbortSignal,
    /** 动作分组（AI 会话面板树归并）：整卷转换入口把检测与后续生成挂同组。 */
    group?: AiSessionGroup
): Promise<DetectResult> {
    const wins = chunkKramdown(source, DETECT_CHARS).map((c) => c.text);
    if (wins.length === 0) return { can: true, reason: "" };
    const counts: (number | undefined)[] = new Array(wins.length).fill(undefined);
    const types = new Set<QuestionType>();
    let headReply = "";
    let cursor = 0;
    const worker = async (): Promise<void> => {
        for (;;) {
            if (signal?.aborted) return;
            const i = cursor++;
            if (i >= wins.length) return;
            try {
                const reply = await agentChatOnce(
                    detectWindowPrompt(wins[i], i === 0),
                    modelId,
                    AI_TIMEOUT.quick,
                    signal,
                    {
                        kind: "detect",
                        title: `前段检测 · ${i + 1}/${wins.length}`,
                        group,
                    }
                );
                if (i === 0) headReply = reply;
                counts[i] = parseCount(reply);
                for (const t of parseTypes(reply)) types.add(t);
            } catch (e) {
                if (i === 0 || (e as Error)?.name === "AbortError") throw e;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(DETECT_PARALLEL, wins.length) }, () => worker()));
    const verdict = parseVerdict(headReply);
    const ok = counts.filter((c): c is number => c !== undefined);
    return {
        can: verdict.can,
        reason: verdict.reason,
        ...(ok.length > 0 ? { count: ok.reduce((a, b) => a + b, 0) } : {}),
        truncated: ok.length < wins.length,
        ...(types.size > 0 ? { types: [...types] } : {}),
    };
}

/** 弹窗预览行：题号 + 题型 + 题干片段。 */
export interface QuestionPreview {
    no: number;
    type: string;
    stem: string;
}

/** 从题目 kramdown 抽预览：题型属性 + 去标记后的题干开头（截 80 字）。
 *  材料块无 type 属性，type 记为 "material"（弹窗按 typeMaterial 标签展示）。 */
export function questionPreview(kd: string, no: number): QuestionPreview {
    const type = isMaterialKramdown(kd) ? "material" : (/custom-plugin-wengu-type="([a-z]+)"/.exec(kd)?.[1] ?? "");
    const stem = kd
        .split(/\r?\n/)
        .filter(
            (l) =>
                !/^\s*\{:/.test(l) && // IAL 属性行
                !/^\s*\{\{\{/.test(l) && // 超级块定界
                !/^\s*\}\}\}/.test(l) &&
                !/^\s*>/.test(l) && // 答案/解析引述
                !/^\s*[-*]\s/.test(l) // 选项列表
        )
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    return { no, type, stem: stem.slice(0, 80) };
}
