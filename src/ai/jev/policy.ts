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
