/**
 * Jev 判定政策的**唯一阈值落点**（Issue #183）：noul 三档、choice/score
 * 低置信判据全部在这里，落点（后续各业务调用方）一律引本模块的 helper，
 * 不许各自写数字——阈值散落 = 同一个「不确定」在四处含义不同。
 *
 * 口径来自规划稿 `.agents/memory/../plan/20260921-jev-integration-plan.md`
 * §二 纪律 2：**低置信回落现状**（不确定档一律走现状路径，用户无感）。
 */

/** noul（是/否）三档阈值：≥0.8 明确是、≤0.2 明确否、其间不确定。 */
export const NOUL_YES = 0.8;
export const NOUL_NO = 0.2;

/** 低置信阈值：choice 概率/置信度 <0.5、score 置信度 <0.7 视为不可用。 */
export const CHOICE_LOW = 0.5;
export const SCORE_LOW = 0.7;

/** noul 三档判定结果。 */
export type NoulVerdict = "yes" | "no" | "unsure";

/** noul 三档：非有限数（NaN/undefined/越界）一律落「不确定」——概率缺失
 *  不可当成「明确否」（那会让模型故障变成静默拒绝）。 */
export function noulVerdict(p: number | undefined): NoulVerdict {
    if (typeof p !== "number" || !Number.isFinite(p)) return "unsure";
    if (p >= NOUL_YES) return "yes";
    if (p <= NOUL_NO) return "no";
    return "unsure";
}

/** noul 是否**明确**为是（≥0.8）。 */
export function noulClearlyYes(p: number | undefined): boolean {
    return noulVerdict(p) === "yes";
}

/** noul 是否**明确**为否（≤0.2）。 */
export function noulClearlyNo(p: number | undefined): boolean {
    return noulVerdict(p) === "no";
}

/** noul 是否不确定（0.2~0.8 或概率缺失）。 */
export function noulUnsure(p: number | undefined): boolean {
    return noulVerdict(p) === "unsure";
}

/** choice 低置信判据（<0.5；置信度缺失按低置信处置）。 */
export function choiceLowConfidence(confidence: number | undefined): boolean {
    return !(typeof confidence === "number" && Number.isFinite(confidence) && confidence >= CHOICE_LOW);
}

/** score 低置信判据（<0.7；置信度缺失按低置信处置）。 */
export function scoreLowConfidence(confidence: number | undefined): boolean {
    return !(typeof confidence === "number" && Number.isFinite(confidence) && confidence >= SCORE_LOW);
}

/* ── 落点专属口径（各落点常量集中在这里，见 Issue #188 / 规划稿 B2） ── */

/** 同义判定（B2，Issue #188）的三档选项。**与旧生成式 prompt 的判定标准逐字
 *  对齐**（规划稿 §三 B2：同义=同一概念，其余一律不落表），落点引用本表，
 *  不许各自写字符串。 */
export const SYN_VERDICTS = {
    /** 同一概念（旧口径：同义/简称全称/跨语言换写法）→ 落表规范词。 */
    same: "same",
    /** 相关但不是同一概念（父概念/子概念/相邻章节）。旧 prompt 只让写「同义」
     *  一项、其余写 `-`（不落表、下次重问）——**维持旧入表口径，不静默放宽**。 */
    related: "related",
    /** 无关（同样不落表）。 */
    different: "different",
} as const;

/** 同义判定选项（转给 Jev 的 choice 清单，顺序即选项顺序）。 */
export const SYN_OPTIONS: string[] = [SYN_VERDICTS.same, SYN_VERDICTS.related, SYN_VERDICTS.different];

/** 只有 `same` 才落表；`related` 与旧生成式通道的「非等同」同口径——不落表。 */
export function synVerdictEntersTable(verdict: string | undefined): boolean {
    return verdict === SYN_VERDICTS.same;
}

/* ── 落点专属口径（Issue #186 / 规划稿 A2·A3） ── */

/**
 * 切片预筛（A2）：**跳过**的门槛 —— 两个条件**同时**成立才跳。
 *
 * 「保守」是本落点的第一原则（规划稿 §三 A2 红线：误杀只是少出题，但要可控）：
 * - noul 必须**明确为否**（≤0.2，经 `noulClearlyNo`）——不确定档一律不跳；
 * - score 必须**明确低**（≤ {@link SCREEN_LOW_SCORE}）**且**置信度够
 *   （`scoreLowConfidence` 为假）——分值不可用时不跳。
 */
export const SCREEN_LOW_SCORE = 2;

/** 预筛「跳过」判据（唯一落点，调用方与单测都引这里）。 */
export function screenShouldSkip(
    noul: number | undefined,
    score: number | undefined,
    conf: number | undefined
): boolean {
    if (!noulClearlyNo(noul)) return false;
    if (scoreLowConfidence(conf)) return false;
    return typeof score === "number" && Number.isFinite(score) && score <= SCREEN_LOW_SCORE;
}

/**
 * 变更实质判定（A3）：口径与 A1/A2 **方向相反**——只有 noul **明确为否**
 * （≤0.2）才当「措辞级」（保留旧题）；不确定档、缺值、明确为是**一律当
 * 实质变化**（宁可多转不漏转，Issue #186 需求 2）。故本落点不提供
 * 「明确为是」的 helper（那会诱使调用方把不确定当措辞），判定由
 * `ai/jev/changeJudge.ts` 直接按 `noulVerdict(p) !== "no"` 收口。
 */
export function changeIsWordingLevel(noul: number | undefined): boolean {
    return noulClearlyNo(noul);
}
