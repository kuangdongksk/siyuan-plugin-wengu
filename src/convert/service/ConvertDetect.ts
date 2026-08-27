import { agentChat } from "../../ai/client";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { isMaterialKramdown, parseVerdict } from "./ConvertService";
import { esc } from "../../ui/shared";

/**
 * 转换前置检测与预览行（从 ConvertBatch 拆出，保主文件 ≤500 行）：
 * detectQuestions 问 AI「能否出题+现成题数」（检测窗口截断），answer
 * 端截断时 count 是下限（N+）；questionPreview 从题目 kramdown 抽
 * 「题号 题型 题干片段」供弹窗渐进预览。
 */

/** 检测窗口：检测调用只看前 N 字符（输入越长内核 AI 越易超时；
 *  超窗时 AI 只数可见部分并带 + 号（如 12+），UI 如实展示）。 */
const DETECT_CHARS = 12000;

/** 前置检测：能否出题 + 原文现成题目数（试卷题库才有意义）。
 *  truncated=文档超出检测窗口，count 是可见部分的下限（N+）。 */
export interface DetectResult {
    can: boolean;
    reason: string;
    /** 原文现成题目数；讲义/无法判定为 undefined。 */
    count?: number;
    /** 文档超出检测窗口，计数只覆盖可见前缀。 */
    truncated?: boolean;
}

export async function detectQuestions(source: string, modelId: string, signal?: AbortSignal): Promise<DetectResult> {
    const truncated = source.length > DETECT_CHARS;
    const head = truncated ? `${source.slice(0, DETECT_CHARS)}\n<!-- 内容过长已截断 -->` : source;
    const reply = await agentChat(
        `你是思源笔记出题助手的前置检查。判断下面的文档是否适合出题，并统计其中现成题目的数量。
输出严格三行，格式之外不要输出任何文字：
CAN_CONVERT: yes 或 no
COUNT: 数字（原文中现成题目的总数；讲义/笔记等没有现成题目时输出 0；若下方内容带「已截断」标记，只数可见部分并在数字后紧跟一个加号，如 12+）
REASON: 一句话说明（注明文档类型：试卷题库或讲义笔记；不能转换时说明原因）
文档内容：
${head}`,
        modelId,
        AI_TIMEOUT.quick,
        signal
    );
    const verdict = parseVerdict(reply);
    const cm = /COUNT\s*[:：]\s*(\d+)\s*(\+)?/i.exec(reply);
    const count = cm ? Number(cm[1]) : undefined;
    return { can: verdict.can, reason: verdict.reason, count, truncated: truncated && !!cm };
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

/** 渐进预览：追加本批题目的「题号 题型 题干片段」行并滚到底（弹窗调用）。 */
export function appendPreviewStems(
    box: HTMLElement,
    stems: QuestionPreview[] | undefined,
    t: (key: string) => string
): void {
    if (!stems?.length) return;
    box.removeAttribute("hidden");
    for (const s of stems) {
        const row = document.createElement("div");
        row.className = "wengu-preview-row";
        const key = s.type ? `type${s.type[0].toUpperCase()}${s.type.slice(1)}` : "";
        const known = key ? t(key) : "";
        const typeLabel = known && known !== key ? known : s.type;
        row.innerHTML =
            `<span class="wengu-preview-no">${s.no}</span>` +
            (typeLabel ? `<span class="wengu-badge">${esc(typeLabel)}</span>` : "") +
            `<span class="wengu-preview-stem" title="${esc(s.stem)}">${esc(s.stem)}</span>`;
        box.appendChild(row);
    }
    box.scrollTop = box.scrollHeight;
}
