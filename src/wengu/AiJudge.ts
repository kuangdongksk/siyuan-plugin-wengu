import {agentChat} from "./AgentClient";
import type {WenguQuestion} from "./types";
import type {WenguStep} from "./types";
import {
    LETTERS,
    optionDisplayMd,
} from "./types";

/**
 * AI 判分与实时引导（brief 思路验证 + steps 实时模式）。
 *
 * 走 AgentClient 同一智能体端点；判分/引导调用一律过串行队列——
 * 内核侧并发请求会互相吞响应（同 fetchSyncPost 的真机坑）。
 */

/** 单次判分/引导调用的超时（毫秒）。 */
const JUDGE_TIMEOUT_MS = 120_000;

/** 串行队列：同一时刻只放一个 AI 调用进内核。 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.then((): void => undefined, (): void => undefined);
    return run;
}

/* ── brief 思路验证 ── */

/** AI 判分结论：ok 已按 right|partial|wrong 折算（partial 记错）。 */
export interface BriefVerdict {
    ok: boolean;
    /** 一句话点评（判分后展示，提示用户可改判）。 */
    comment: string;
}

/** 把用户的解题思路交给 AI 对照参考答案判定（串行）。 */
export function judgeBrief(q: WenguQuestion, mine: string, modelId: string): Promise<BriefVerdict> {
    return enqueue(async () => {
        const reply = await agentChat(buildBriefPrompt(q, mine), modelId, JUDGE_TIMEOUT_MS);
        return parseBriefVerdict(reply);
    });
}

function buildBriefPrompt(q: WenguQuestion, mine: string): string {
    const answer = [q.answer, q.solutionMd].filter(Boolean).join("\n\n") || "（无参考答案）";
    return `你是刷题判分助手。对照参考答案判断学生的解题思路。
只看学科上的正确性：思路可行即 right；方向对但有明显缺口算 partial；方向错误算 wrong。
输出严格两行，格式之外不要输出任何文字：
VERDICT: right 或 partial 或 wrong
COMMENT: 一句话点评（对在哪/偏在哪，不超过 60 字）
【题目】
${q.stemMd ?? ""}
【参考答案】
${answer}
【学生思路】
${mine}`;
}

function parseBriefVerdict(reply: string): BriefVerdict {
    const m = /VERDICT\s*[:：]\s*(right|partial|wrong|对|半对|部分对|错|错误)/i.exec(reply);
    if (!m) throw new Error("AI 未按格式返回判定");
    const v = m[1].toLowerCase();
    const ok = v === "right" || v === "对";
    const cm = /COMMENT\s*[:：]\s*([^\n]+)/i.exec(reply);
    return {ok, comment: (cm?.[1] ?? "").trim()};
}

/* ── steps 方法步申诉 ── */

/** 方法步申诉结论：出题时标注的可行集合可能标漏，AI 独立复核。 */
export interface MethodAppealVerdict {
    feasible: boolean;
    comment: string;
}

/** 方法步答错后的 AI 复核：学生所选方法对该题是否实际可行（串行）。 */
export function appealMethodStep(
    q: WenguQuestion,
    step: WenguStep,
    chosen: string,
    modelId: string,
): Promise<MethodAppealVerdict> {
    return enqueue(async () => {
        const reply = await agentChat(buildAppealPrompt(q, step, chosen), modelId, JUDGE_TIMEOUT_MS);
        const m = /FEASIBLE\s*[:：]\s*(yes|no|true|false|是|否|可行|不可行)/i.exec(reply);
        if (!m) throw new Error("AI 未按格式返回复核");
        const v = m[1].toLowerCase();
        const feasible = v === "yes" || v === "true" || v === "是" || v === "可行";
        const cm = /COMMENT\s*[:：]\s*([^\n]+)/i.exec(reply);
        return {feasible, comment: (cm?.[1] ?? "").trim()};
    });
}

function buildAppealPrompt(q: WenguQuestion, step: WenguStep, chosen: string): string {
    const options = step.optionMd
        .map((md, i) => `${LETTERS[i]}. ${optionDisplayMd(md)}`)
        .join("\n");
    const answer = [q.answer, q.solutionMd].filter(Boolean).join("\n\n") || "（无参考解答）";
    return `你是解题方法复核助手。一道多步引导题的「选方法」步骤，出题时标注的可行方法集合可能标漏；学生认为自己所选的方法其实可行，请你独立判断。
只依据学科正确性：该方法能走通本题（即使比参考路径更绕）即可行。
输出严格两行，格式之外不要输出任何文字：
FEASIBLE: yes 或 no
COMMENT: 一句话理由（可行时说明如何走通；不可行时指出问题所在）
【题目】
${q.stemMd ?? ""}
【参考解答】
${answer}
【该步候选方法】
${options}
【出题时标注的可行集合】
${step.answer}
【学生所选方法】
${chosen}`;
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

/** 向 AI 要多步引导的「下一步」（跟随学生已选的方法，串行）。 */
export function nextRealtimeStep(
    q: WenguQuestion,
    history: RealtimeHistoryItem[],
    modelId: string,
): Promise<RealtimeStep> {
    return enqueue(async () => {
        const reply = await agentChat(buildRealtimePrompt(q, history), modelId, JUDGE_TIMEOUT_MS);
        return parseRealtimeStep(reply);
    });
}

function buildRealtimePrompt(q: WenguQuestion, history: RealtimeHistoryItem[]): string {
    const done = history.length === 0 ?
        "（尚未开始，请先出第一步）" :
        history
            .map((h, i) => `第${i + 1}步「${h.stem}」学生选 ${h.letter}. ${h.chosen}${h.ok ? "（对）" : "（错）"}`)
            .join("；");
    const answer = [q.answer, q.solutionMd].filter(Boolean).join("\n\n") || "（无参考解答）";
    return `你是解题引导助手。根据题目与参考解答，生成多步引导作答的「下一步」：学生逐步选择方法与中间结果，你为每一步出选择题。
规则：
- 尚未开始时，第一步通常是 method 步（选方法）：选项为候选方法，ANSWER 列出**全部可行方法**的字母（如 AB）；学生任选可行方法都算对。
- 之后是 result 步：按学生实际选择的方法出该步的中间结果，ANSWER 是唯一正确字母，干扰项来自常见计算错误。
- 学生选了非参考路径的可行方法时，后续 result 步改按该方法出中间结果。
- 参考解答已走完（或只剩最终结论已被作答）时只输出一行 DONE: yes。
输出严格格式（格式之外不要输出任何文字）：
TYPE: method 或 result
PROMPT: 本步引导语（如「第 2 步 · 等价无穷小代换：本步化简得（ ）」）
OPTIONS:
- A. 选项一
- B. 选项二
- C. 选项三
- D. 选项四
ANSWER: 可行字母集合（method 步，如 AB）或唯一字母（result 步，如 C）
【题目】
${q.stemMd ?? ""}
【参考解答】
${answer}
【已完成步骤】
${done}`;
}

/** 解析实时步骤（TYPE/PROMPT/OPTIONS/ANSWER 或 DONE），容错字母标签。 */
function parseRealtimeStep(reply: string): RealtimeStep {
    const text = reply.trim();
    if (/DONE\s*[:：]\s*(yes|true|是)/i.test(text)) return {done: true};
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
