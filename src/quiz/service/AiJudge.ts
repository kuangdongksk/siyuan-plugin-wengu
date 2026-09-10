import { agentChatOnce } from "../../ai/client";
import { AI_TIMEOUT } from "../../ai/timeouts";
import {
    buildAppealPrompt,
    buildBriefPrompt,
    buildCluePrompt,
    buildEssayPrompt,
    buildRealtimePrompt,
    buildTransPrompt,
    wrongCausesPrompt,
} from "../../ai/prompts/judge";
import type { WenguQuestion } from "../../types";
import type { WenguStep } from "../../types";
import { optionDisplayMd, QuestionType } from "../../types";
import type { WeakCause } from "../../bank/data/WeaknessStore";
import { normalizeCause } from "../../bank/data/WeaknessStore";

/**
 * AI 判分与实时引导（brief 思路验证 + steps 实时模式）。
 *
 * 全部走 ai/client 的 agentChatOnce 一次性独立会话（20260830 起，
 * 原共享 "" 会话 + enqueueAi 串行队列已退役）——独立 sessionID
 * 天然并发，连续判分/跨域调用互不阻塞。
 */

/* ── brief 思路验证 ── */

/** 会话登记标题：动作 · 题干前 16 字（AI 会话面板列表识别用）。 */
const trackTitle = (label: string, q: WenguQuestion): string =>
    `${label} · ${(q.stemMd ?? "").replace(/\s+/g, " ").trim().slice(0, 16)}`;

/** brief 判分三态：partial=方向对但有缺口（统计记错，展示单列）。 */
export type BriefVerdictState = "right" | "partial" | "wrong";

/** AI 判分结论：ok 为统计口径（partial 记错），verdict 保留三态展示。 */
export interface BriefVerdict {
    verdict: BriefVerdictState;
    ok: boolean;
    /** 一句话点评（判分后展示，提示用户可改判）。 */
    comment: string;
    /** 错因规范键（weakness 画像用；答对时无）。 */
    cause?: WeakCause;
}

/** 把用户的解题思路交给 AI 对照参考答案判定。
 *  thought 为「思路」折叠区里的推导备注（可选，判 partial 的素材）。
 *  essay/trans（英语）走各自的 rubric prompt（E3），SCORE 并入评语。 */
export async function judgeBrief(q: WenguQuestion, mine: string, modelId: string, thought = ""): Promise<BriefVerdict> {
    const prompt =
        q.type === QuestionType.Essay
            ? buildEssayPrompt(q, mine)
            : q.type === QuestionType.Trans
              ? buildTransPrompt(q, mine)
              : buildBriefPrompt(q, mine, thought);
    const reply = await agentChatOnce(prompt, modelId, AI_TIMEOUT.quick, undefined, {
        kind: "judge",
        title: trackTitle("判题", q),
    });
    return parseBriefVerdict(reply);
}

function parseBriefVerdict(reply: string): BriefVerdict {
    const m = /VERDICT\s*[:：]\s*(right|partial|wrong|对|半对|部分对|错|错误)/i.exec(reply);
    if (!m) throw new Error("AI 未按格式返回判定");
    const raw = m[1].toLowerCase();
    const verdict: BriefVerdictState =
        raw === "right" || raw === "对"
            ? "right"
            : raw === "partial" || raw === "半对" || raw === "部分对"
              ? "partial"
              : "wrong";
    const cm = /COMMENT\s*[:：]\s*([^\n]+)/i.exec(reply);
    let comment = (cm?.[1] ?? "").trim();
    // 作文判卷带 SCORE 行：并入评语展示（如「12/20 — 论证充分…」）
    const sm = /SCORE\s*[:：]\s*([^\n]+)/i.exec(reply);
    if (sm) comment = `${sm[1].trim()} — ${comment}`;
    // brief 判分自带 CAUSE 行：错因零额外调用沉淀进薄弱画像
    const cam = /CAUSE\s*[:：]\s*([^\n]+)/i.exec(reply);
    const causeText = (cam?.[1] ?? "").trim();
    return {
        verdict,
        ok: verdict === "right",
        comment,
        ...(verdict !== "right" && causeText && causeText !== "无" ? { cause: normalizeCause(causeText) } : {}),
    };
}

/* ── 英语判卷（E3）：作文 rubric / 翻译采分点（prompt 在 ai/prompts/judge）── */

/* ── 线索复核（M5：定位能力训练）── */

/** 线索复核结论：hit=定位句；near=相关段落但非定位句；miss=无关。 */
export interface ClueVerdict {
    clue: "hit" | "near" | "miss";
    comment: string;
}

/** 复核学生为某题标注的线索段是否是该题的定位依据。 */
export async function judgeClue(
    materialBody: string,
    q: WenguQuestion,
    submitted: string,
    clues: string[],
    modelId: string
): Promise<ClueVerdict> {
    const reply = await agentChatOnce(
        buildCluePrompt(materialBody, q, submitted, clues),
        modelId,
        AI_TIMEOUT.quick,
        undefined,
        {
            kind: "judge",
            title: trackTitle("线索复核", q),
        }
    );
    const m = /CLUE\s*[:：]\s*(hit|near|miss|对|近似|错)/i.exec(reply);
    if (!m) throw new Error("AI 未按格式返回线索复核");
    const raw = m[1].toLowerCase();
    const clue = raw === "hit" || raw === "对" ? "hit" : raw === "near" || raw === "近似" ? "near" : "miss";
    const cm = /COMMENT\s*[:：]\s*([^\n]+)/i.exec(reply);
    return { clue, comment: (cm?.[1] ?? "").trim() };
}

/* ── 客观错题批量归因（薄弱画像用，每轮至多一次调用） ── */

/** 归因输入：错题的判分原料（题干截断由调用方控制）。 */
export interface CauseItem {
    qid: string;
    stem: string;
    mine: string;
    answer: string;
}

/** 客观题答错后没有判分调用可搭车——收卷时把错题打包一次归因。 */
export async function attributeWrongCauses(items: CauseItem[], modelId: string): Promise<Map<string, WeakCause>> {
    const lines = items.map((it, i) => `${i + 1}|${it.stem}|我的答案：${it.mine}|正确答案：${it.answer}`).join("\n");
    const reply = await agentChatOnce(wrongCausesPrompt(lines), modelId, AI_TIMEOUT.quick, undefined, {
        kind: "judge",
        title: `错因归因 · ${items.length} 题`,
    });
    const out = new Map<string, WeakCause>();
    const jm = /\{[\s\S]*\}/.exec(reply);
    let pairs: [string, string][] = [];
    if (jm) {
        try {
            pairs = Object.entries(JSON.parse(jm[0]) as Record<string, string>);
        } catch (_) {
            pairs = [];
        }
    }
    if (pairs.length === 0) {
        pairs = [...reply.matchAll(/"?\s*(\d+)\s*"?\s*[:：]\s*"([^"]+)"/g)].map((m) => [m[1], m[2]]);
    }
    for (const [no, cause] of pairs) {
        const it = items[Number(no) - 1];
        if (it && cause && cause !== "无") out.set(it.qid, normalizeCause(cause));
    }
    return out;
}

/* ── steps 方法步申诉 ── */

/** 方法步申诉结论：出题时标注的可行集合可能标漏，AI 独立复核。 */
export interface MethodAppealVerdict {
    feasible: boolean;
    comment: string;
}

/** 方法步答错后的 AI 复核：学生所选方法对该题是否实际可行。 */
export async function appealMethodStep(
    q: WenguQuestion,
    step: WenguStep,
    chosen: string,
    modelId: string
): Promise<MethodAppealVerdict> {
    const reply = await agentChatOnce(buildAppealPrompt(q, step, chosen), modelId, AI_TIMEOUT.quick, undefined, {
        kind: "judge",
        title: trackTitle("方法申诉", q),
    });
    const m = /FEASIBLE\s*[:：]\s*(yes|no|true|false|是|否|可行|不可行)/i.exec(reply);
    if (!m) throw new Error("AI 未按格式返回复核");
    const v = m[1].toLowerCase();
    const feasible = v === "yes" || v === "true" || v === "是" || v === "可行";
    const cm = /COMMENT\s*[:：]\s*([^\n]+)/i.exec(reply);
    return { feasible, comment: (cm?.[1] ?? "").trim() };
}

/* ── steps 实时引导 ── */

/** 已完成实时步骤的记录（作为下一步生成的上下文）。 */
export interface RealtimeHistoryItem {
    /** 该步引导语。 */
    stem: string;
    /** 学生所选字母。 */
    letter: string;
    /** 所选项文本（方法名/中间结果，给 AI 看选择内容）。 */
    chosen: string;
    ok: boolean;
}

/** 实时引导返回：done=true 表示解答走完，step 为下一步。 */
export interface RealtimeStep {
    done: boolean;
    step?: WenguStep;
}

/** 向 AI 要多步引导的「下一步」（跟随学生已选的方法）。 */
export async function nextRealtimeStep(
    q: WenguQuestion,
    history: RealtimeHistoryItem[],
    modelId: string
): Promise<RealtimeStep> {
    const reply = await agentChatOnce(buildRealtimePrompt(q, history), modelId, AI_TIMEOUT.quick, undefined, {
        kind: "judge",
        title: trackTitle("实时引导", q),
    });
    return parseRealtimeStep(reply);
}

/** 解析实时步骤（TYPE/PROMPT/OPTIONS/ANSWER 或 DONE），容错字母标签。 */
function parseRealtimeStep(reply: string): RealtimeStep {
    const text = reply.trim();
    if (/DONE\s*[:：]\s*(yes|true|是)/i.test(text)) return { done: true };
    const typeM = /TYPE\s*[:：]\s*(method|result|方法|结果)/i.exec(text);
    const promptM = /PROMPT\s*[:：]\s*([^\n]+)/i.exec(text);
    const answerM = /ANSWER\s*[:：]\s*([^\n]+)/i.exec(text);
    const optIdx = text.search(/OPTIONS\s*[:：]/i);
    if (!typeM || !promptM || !answerM || optIdx < 0 || (answerM.index ?? 0) <= optIdx) {
        throw new Error("AI 未按格式返回步骤");
    }
    const kind = typeM[1].toLowerCase() === "method" || typeM[1] === "方法" ? "method" : "result";
    const optBody = text.slice(optIdx, answerM.index);
    const options = optBody
        .split(/\r?\n/)
        .filter((line) => /^\s*[-*+]\s/.test(line))
        .map((line) => optionDisplayMd(line));
    if (options.length < 2) throw new Error("AI 返回的选项不足");
    return {
        done: false,
        step: {
            kind,
            stemMd: promptM[1].trim(),
            optionMd: options,
            answer: answerM[1].trim(),
        },
    };
}
