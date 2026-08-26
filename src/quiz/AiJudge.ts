import { agentChat } from "../convert/AgentClient";
import type { WenguQuestion } from "../types";
import type { WenguStep } from "../types";
import { LETTERS, optionDisplayMd, QuestionType } from "../types";
import type { WeakCause } from "../bank/WeaknessStore";
import { normalizeCause } from "../bank/WeaknessStore";

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
    queue = run.then(
        (): void => undefined,
        (): void => undefined
    );
    return run;
}

/* ── brief 思路验证 ── */

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

/** 把用户的解题思路交给 AI 对照参考答案判定（串行）。
 *  thought 为「思路」折叠区里的推导备注（可选，判 partial 的素材）。
 *  essay/trans（英语）走各自的 rubric prompt（E3），SCORE 并入评语。 */
export function judgeBrief(q: WenguQuestion, mine: string, modelId: string, thought = ""): Promise<BriefVerdict> {
    return enqueue(async () => {
        const prompt =
            q.type === QuestionType.Essay
                ? buildEssayPrompt(q, mine)
                : q.type === QuestionType.Trans
                  ? buildTransPrompt(q, mine)
                  : buildBriefPrompt(q, mine, thought);
        const reply = await agentChat(prompt, modelId, JUDGE_TIMEOUT_MS);
        return parseBriefVerdict(reply);
    });
}

function buildBriefPrompt(q: WenguQuestion, mine: string, thought: string): string {
    const answer = [q.answer, q.solutionMd].filter(Boolean).join("\n\n") || "（无参考答案）";
    const thoughtBlock = thought ? `\n【学生思路备注】\n${thought}` : "";
    return `你是刷题判分助手。对照参考答案判断学生的作答与思路。
只看学科上的正确性：思路可行即 right；方向对但有明显缺口算 partial；方向错误算 wrong。
输出严格三行，格式之外不要输出任何文字：
VERDICT: right 或 partial 或 wrong
COMMENT: 一句话点评（对在哪/偏在哪，不超过 60 字）
CAUSE: 错因归类，只能从「概念不清/计算失误/方法选择错/公式记错/审题失误/其他」里选一个；verdict 为 right 时输出 无
【题目】
${q.stemMd ?? ""}
【参考答案】
${answer}
【学生作答】
${mine}${thoughtBlock}`;
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

/* ── 英语判卷（E3）：作文 rubric / 翻译采分点 ── */

function buildEssayPrompt(q: WenguQuestion, mine: string): string {
    const model = [q.solutionMd].filter(Boolean).join("\n\n") || "（无范文）";
    return `你是考研英语作文阅卷助手。按考试评分标准给这篇学生作文判分。
评分维度：内容是否切题、组织结构是否清晰、语言准确性与多样性、格式与语域是否得当。
输出严格三行，格式之外不要输出任何文字：
SCORE: 分数/满分（如 14/20；题目未标满分按 20 分制）
VERDICT: right（达到该题平均分以上）或 partial（基本成型但有明显缺陷）或 wrong（严重偏题/错误密集）
COMMENT: 两句以内点评（一个最突出的优点 + 一个最该改的问题）
【题目】
${q.stemMd ?? ""}
【范文】
${model}
【学生作文】
${mine}`;
}

function buildTransPrompt(q: WenguQuestion, mine: string): string {
    const ref = [q.answer, q.solutionMd].filter(Boolean).join("\n\n") || "（无参考译文）";
    return `你是考研英语翻译阅卷助手。对照参考译文与采分点给学生的译文判定。
关注：关键采分点（词组/从句结构）是否译出、有无漏译错译、汉语是否通顺；整体大意对但个别点缺失算 partial。
输出严格两行，格式之外不要输出任何文字：
VERDICT: right 或 partial 或 wrong
COMMENT: 一句话点评（缺失/译错的采分点，不超过 60 字）
【原文】
${q.stemMd ?? ""}
【参考译文与采分点】
${ref}
【学生译文】
${mine}`;
}

/* ── 线索复核（M5：定位能力训练）── */

/** 线索复核结论：hit=定位句；near=相关段落但非定位句；miss=无关。 */
export interface ClueVerdict {
    clue: "hit" | "near" | "miss";
    comment: string;
}

/** 复核学生为某题标注的线索段是否是该题的定位依据（串行）。 */
export function judgeClue(
    materialBody: string,
    q: WenguQuestion,
    submitted: string,
    clues: string[],
    modelId: string
): Promise<ClueVerdict> {
    return enqueue(async () => {
        const reply = await agentChat(buildCluePrompt(materialBody, q, submitted, clues), modelId, JUDGE_TIMEOUT_MS);
        const m = /CLUE\s*[:：]\s*(hit|near|miss|对|近似|错)/i.exec(reply);
        if (!m) throw new Error("AI 未按格式返回线索复核");
        const raw = m[1].toLowerCase();
        const clue = raw === "hit" || raw === "对" ? "hit" : raw === "near" || raw === "近似" ? "near" : "miss";
        const cm = /COMMENT\s*[:：]\s*([^\n]+)/i.exec(reply);
        return { clue, comment: (cm?.[1] ?? "").trim() };
    });
}

function buildCluePrompt(materialBody: string, q: WenguQuestion, submitted: string, clues: string[]): string {
    return `你是考研英语阅读的定位复核助手。学生在阅读文章后做题时，为该题标注了他认为的「定位线索」文段；请判断这些线索是否真的是该题答案的定位依据。
判定标准：hit=线索包含该题答案的出处句；near=线索落在相关段落但未覆盖定位句；miss=与该题无关。
输出严格两行，格式之外不要输出任何文字：
CLUE: hit 或 near 或 miss
COMMENT: 一句话点评（定位对在哪/错在哪，可指出正确定位应在的方向）
【文章】
${materialBody}
【题目】
${q.stemMd ?? ""}
【学生所选】
${submitted || "（未作答）"}
【学生标注的线索】
${clues.map((c, i) => `${i + 1}. ${c}`).join("\n")}`;
}

/* ── 客观错题批量归因（薄弱画像用，每轮至多一次调用） ── */

/** 归因输入：错题的判分原料（题干截断由调用方控制）。 */
export interface CauseItem {
    qid: string;
    stem: string;
    mine: string;
    answer: string;
}

/** 客观题答错后没有判分调用可搭车——收卷时把错题打包一次归因（串行）。 */
export function attributeWrongCauses(items: CauseItem[], modelId: string): Promise<Map<string, WeakCause>> {
    return enqueue(async () => {
        const lines = items
            .map((it, i) => `${i + 1}|${it.stem}|我的答案：${it.mine}|正确答案：${it.answer}`)
            .join("\n");
        const reply = await agentChat(
            `你是刷题错因分析器。下面是一轮刷题中答错的客观题（编号|题干|我的答案|正确答案）。逐题判断最可能的错因，只输出 JSON，格式之外不要输出任何文字：
{"1":"概念不清","3":"计算失误"}
错因只能从「概念不清/计算失误/方法选择错/公式记错/审题失误/其他」里选。
题目：
${lines}`,
            modelId,
            JUDGE_TIMEOUT_MS
        );
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
    });
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
    modelId: string
): Promise<MethodAppealVerdict> {
    return enqueue(async () => {
        const reply = await agentChat(buildAppealPrompt(q, step, chosen), modelId, JUDGE_TIMEOUT_MS);
        const m = /FEASIBLE\s*[:：]\s*(yes|no|true|false|是|否|可行|不可行)/i.exec(reply);
        if (!m) throw new Error("AI 未按格式返回复核");
        const v = m[1].toLowerCase();
        const feasible = v === "yes" || v === "true" || v === "是" || v === "可行";
        const cm = /COMMENT\s*[:：]\s*([^\n]+)/i.exec(reply);
        return { feasible, comment: (cm?.[1] ?? "").trim() };
    });
}

function buildAppealPrompt(q: WenguQuestion, step: WenguStep, chosen: string): string {
    const options = step.optionMd.map((md, i) => `${LETTERS[i]}. ${optionDisplayMd(md)}`).join("\n");
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
    modelId: string
): Promise<RealtimeStep> {
    return enqueue(async () => {
        const reply = await agentChat(buildRealtimePrompt(q, history), modelId, JUDGE_TIMEOUT_MS);
        return parseRealtimeStep(reply);
    });
}

function buildRealtimePrompt(q: WenguQuestion, history: RealtimeHistoryItem[]): string {
    const done =
        history.length === 0
            ? "（尚未开始，请先出第一步）"
            : history
                  .map(
                      (h, i) => `第${i + 1}步「${h.stem}」学生选 ${h.letter}. ${h.chosen}${h.ok ? "（对）" : "（错）"}`
                  )
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
