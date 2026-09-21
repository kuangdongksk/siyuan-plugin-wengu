import { isJevEnabled, type JevSettingsLike } from "../../ai/jev/enabled";
import { judgeJev, type JudgeJevOpts } from "../../ai/jev/client";
import type { JevTrack } from "../../ai/jev/track";
import { tKey } from "../../ui/Notify";
import { aiTitle } from "../../ui/shared";
import { QuestionType } from "../../types";
import type { WenguQuestion } from "../../types";

/**
 * 填空题判分复核（Issue #187 / 规划稿 §三 B1）：字面比对失配时问 Jev 一次
 * 「用户答案与标准答案在题干语境下语义等价吗（等价数学形式也算）」，
 * **明确等价**才改判为对，其余一律维持现状。
 *
 * 三条硬口径（改这里前先读，别放宽）：
 *  - **主通道永远是确定性代码**：本层只在 `gradeQuestion` 判错之后跑，
 *    判对路径零调用零开销；`AUTO_GRADE_TYPES` 与判分函数本身一行不动。
 *  - **低置信回落现状**（规划稿 §二 纪律 2）：没 key、开关关、请求失败、
 *    超时、概率落不确定档、判定形状不符 —— 全部当「复核不出结论」，
 *    静默维持判错，不提示不弹窗不回头改判。
 *  - **只改本轮会话结果**（`ok` 与 `jevSame` 标记），不新增持久化字段、
 *    不写块属性（见 `applyJevSame`）。
 */

/** 本单阈值（Issue #187 需求 2）：≥0.9 判同、≤0.2 维持判错、中间维持判错。
 *  **刻意不复用** `ai/jev/policy` 的通用三档（0.8/0.2）——那里是「拦截」
 *  语义，这里要改分，误判同的代价高于漏判，门槛更高。 */
export const GAP_SAME_MIN = 0.9;

/** 判定结果：same=明确等价（改判）、no=明确不等价、unsure=不确定。
 *  后两者**行为相同**（维持判错），分开只为把阈值口径写在测试里。 */
export type GapVerdictState = "same" | "no" | "unsure";

/** 概率 → 三档（非有限数一律不确定：概率缺失不可当成「明确不等价」）。 */
export function gapVerdictOf(p: number | undefined): GapVerdictState {
    if (typeof p !== "number" || !Number.isFinite(p)) return "unsure";
    if (p >= GAP_SAME_MIN) return "same";
    if (p <= 0.2) return "no";
    return "unsure";
}

/** 交付给 Jev 的单题语境（题干必填；选项在有选项时一并给——填空可输字母）。 */
export interface GapJudgeInput {
    /** 题干 markdown（超长截断，见 `GAP_STEM_LIMIT`）。 */
    stem: string;
    /** 标准答案原文（多答案的 `a|b` 原样给，prompt 里说明任一命中即可）。 */
    answer: string;
    /** 用户作答原文。 */
    submitted: string;
    /** 选项原文（可空）。 */
    options: string[];
}

/** 题干进请求的上限（字符）：题干只是语境，超长部分对判等无增益。 */
const GAP_STEM_LIMIT = 1200;

/** 截断（题干/选项共用）。 */
const clip = (s: string): string => {
    const t = (s ?? "").trim();
    return t.length > GAP_STEM_LIMIT ? `${t.slice(0, GAP_STEM_LIMIT)}…` : t;
};

/** 题目 + 作答 → 复核输入。 */
export function gapInputOf(q: WenguQuestion, submitted: string): GapJudgeInput {
    return {
        stem: clip(q.stemMd ?? ""),
        answer: (q.answer ?? "").trim(),
        submitted: submitted.trim(),
        options: (q.optionMd ?? []).map((o) => clip(o)).filter(Boolean),
    };
}

/** 单题复核的判定材料（`judgeJev` 的 `state`：判定所依据的全部上下文）。 */
export function gapJudgeState(input: GapJudgeInput): string {
    const opts = input.options.length
        ? `可选项：${input.options.map((o, i) => `${i + 1}. ${o}`).join("   ")}（用户若填的是选项编号或字母，先代换成对应选项内容再比）\n`
        : "";
    return (
        "你在复核一道填空题的判分：用户作答与标准答案按字面比对不一致，判断二者在该题语境下是否【语义等价】。" +
        "同义表述、同义术语、等价数学形式（0.5 与 1/2、x^2 与 x²）都算等价；含义不同的判不等价。\n" +
        `题干：${input.stem || "(题干缺失)"}\n` +
        opts +
        `标准答案：${input.answer || "(缺失)"}${input.answer.includes("|") ? "（多个答案用 | 分隔，用户命中任一即可）" : ""}\n` +
        `用户作答：${input.submitted || "(空)"}`
    );
}

/** 判定函数（无 key / 失败 / 不确定一律 false＝维持判错）。 */
export type GapJudgeFn = (input: GapJudgeInput) => Promise<boolean>;

/** 判定链可注入的接缝（单测不碰真网络）。 */
export interface GapJudgeOpts {
    /** 传输注入（缺省走内核 forwardProxy）。 */
    transport?: JudgeJevOpts["transport"];
    /** 退避等待注入（单测避免真睡）。 */
    sleep?: JudgeJevOpts["sleep"];
    /** 请求超时（缺省 `JEV_TIMEOUT_MS.judge`）。 */
    timeout?: JudgeJevOpts["timeout"];
}

/** 判定登记的标题（Issue #201）：`Jev 判同 · 第 N 题`——判定的重来办法
 *  是「原动作重跑」（同一题再答一次重新问），故题号就是最有用的定位信息。 */
export function gapJudgeTrack(no: number): JevTrack {
    return { title: aiTitle(tKey, "aiTitleJevGap", { n: String(no) }) };
}

/** 组装判定函数：总闸关/无 key ⇒ undefined（调用方零调用开销）；
 *  有 key ⇒ 真请求，失败与不确定落 false。 */
export function makeGapVerdict(
    settings: JevSettingsLike | undefined,
    opts: GapJudgeOpts = {},
    /** 题号（1 起；只用于会话登记的标题，缺省 0 = 取不到题号）。
     *  ⚠️ 与本层其他注入面（transport/sleep/timeout）**分开传**：登记是
     *  面板可读性问题，不该混进「测试注入接缝」那个口子。 */
    no = 0
): GapJudgeFn | undefined {
    if (!isJevEnabled(settings)) return undefined;
    const apiKey = (settings.jevKey ?? "").trim();
    return async (input: GapJudgeInput): Promise<boolean> => {
        try {
            const answers = await judgeJev({
                // 单题单问（纪律 5「一次请求问完」的自然退化）；题干/答案/作答
                // 全在 state 里，问题只留一句判词，避免材料两处不一致。
                state: gapJudgeState(input),
                questions: [{ kind: "noul", question: "用户作答与标准答案在该题语境下是否语义等价？" }],
                apiKey,
                ...opts,
                // 登记（Issue #201）：逐题一次判定、各自一条记录（组机制不适合
                // 本题：一次作答动作只问一次，两题之间没有「同一次动作」关系）
                track: gapJudgeTrack(no),
            });
            const a = answers[0];
            return a?.kind === "noul" && gapVerdictOf(a.noul) === "same";
        } catch (_) {
            // 未配置/401/403/429/网络/协议错/超时：静默回落现状
            return false;
        }
    };
}

/** 判定链输入（组件事件与恢复重渲染两路同口径，纯函数便于单测）。 */
export interface GapJudgeCtx {
    /** 本地判分结论（`gradeQuestion` / `gradeSlot` 已算好）。 */
    ok: boolean;
    /** 题型闸：只复核填空（选择/判断的精确匹配即规格本身）。 */
    type: WenguQuestion["type"];
    /** 是否已问过（同一题同一答不重问，见 `gapAskedKey`）。 */
    asked?: (key: string) => boolean;
    /** 复核键。 */
    key: string;
    /** 复核输入。 */
    input: GapJudgeInput;
    /** 判定函数（无 key 时 undefined）。 */
    verdict?: GapJudgeFn;
}

/** 该键是否值得**发请求**（判对 / 非填空 / 无 key / 已问过：一律不问）。
 *
 *  ⚠️ `!c.verdict` 这一条是**验收 1 的守门人**：没配 key 时判定函数是
 *  undefined，本层必须彻底不参与——连「缓存回放」都不做（否则用户哪天
 *  清掉 key，旧判同缓存还能改分，「无 key 零行为变化」就破了）。 */
export function shouldReviewGap(c: GapJudgeCtx): boolean {
    if (c.ok || c.type !== QuestionType.Fill || !c.verdict) return false;
    return !(c.asked?.(c.key) ?? false);
}

/** 该键是否**已判同**（缓存命中 ⇒ 零请求直接回放「对」）。
 *
 *  ⚠️ 与 `shouldReviewGap` 是**两个问题**：那个答「要不要花钱问」，
 *  这个答「要不要照旧结论办」。混成一个谓词就是先前的缺陷形态——after
 *  模式用户改答再改回同一串时，只「不问」而不回放，结果被翻成判错，
 *  与前一秒界面上的「Jev 判同」自相矛盾。
 *
 *  同样钉死「无 key（`!c.verdict`）⇒ 不参与」，见上一条头注。 */
export function gapKnownSame(c: GapJudgeCtx): boolean {
    if (c.ok || c.type !== QuestionType.Fill || !c.verdict) return false;
    return c.asked?.(c.key) ?? false;
}

/* ── 判同标记与记账（只动本轮会话结果） ── */

/** 会话里一条作答结果的**判同标记**（`WenguSessionResult.jevSame`）。 */
export interface JevSameSink {
    correct: number;
    results: { qid: string; submitted: string; ok: boolean; jevSame?: boolean }[];
}

/** 判同后写会话：挂 `jevSame` 标记，并在「由错翻对」时微调本轮 `correct`。
 *  只在本轮结果里改（会话已换/该题不在本轮 ⇒ false，静默不改）。
 *
 *  ⚠️ **标记与翻对分开写**（20260921 复核修正）：调用方是「先 `recordAnswer`
 *  再标记」（记录不存在时标记无处可挂），故 `r.ok` 很可能已是 true——此时
 *  仍必须落 `jevSame`，否则界面的「Jev 判同」永远不出现；`correct` 只在
 *  真由错翻对时 +1（已是对 = 记账早就入过，不许重复涨）。
 *
 *  **不新增持久化字段之外的任何存储动作**：题块属性与题库统计维持首次
 *  作答的 `recordAnswer` 口径（复核只补「对」的事实，不重复记一次账）。 */
export function applyJevSame(session: JevSameSink | undefined, qid: string, submitted: string): boolean {
    const r = session?.results.find((x) => x.qid === qid);
    if (!session || !r) return false;
    r.jevSame = true;
    if (!r.ok) {
        r.ok = true;
        r.submitted = submitted;
        session.correct = Math.max(0, session.correct + 1);
    }
    return true;
}

/** 本轮该题是否 Jev 判同（结果行与恢复态读它）。 */
export function jevSameOf(results: { qid: string; jevSame?: boolean }[] | undefined, qid: string): boolean {
    return !!results?.find((r) => r.qid === qid)?.jevSame;
}

/** 去重键：题 id + 归一化作答（同题同答的重复提交不重问，
 *  一个缓存数组只存**已判同**的键 —— 判错/不确定不入表，重试才有意义）。 */
export function gapAskedKey(qid: string, submitted: string): string {
    return `${qid}\u0000${submitted.trim().toUpperCase().replace(/\s+/g, "")}`;
}

/** 已判同键的进程内单例（视图壳与恢复重渲染共用；`globalThis` 存取理由
 *  同 `CardRegistry`：模块级 Map 即可，跨 `mountApp` 重建不丢）。 */
const SAME = Symbol.for("wengu.jev.gapSame");

/** 已判同键表（读写同一份；测试用 `resetGapSameForTest` 清）。 */
export function gapSameKeys(): Set<string> {
    const g = globalThis as unknown as Record<symbol, Set<string> | undefined>;
    return (g[SAME] ??= new Set<string>());
}

/** 单测专用：清空判同表（避免用例互相污染）。 */
export function resetGapSameForTest(): void {
    gapSameKeys().clear();
}
