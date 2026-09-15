import { LETTERS, optionComparable, QuestionType } from "../../types";
import type { WenguQuestion } from "../../types";
import type { DraftUnit } from "../../convert/service/draft/QuestionDraft";

/**
 * 重新生成（regen）的**答案核查**纯逻辑（Issue #123，20260915 真机实录）：
 *
 * 三个事实叠加会静默落盘坏答案——
 *   1. 共享行协议要求「**正确项写在最前**」（字母由渲染按序自动编），
 *      同时又要求 `@@P ans` 写字母；修复重生成时 AI 会按协议重排选项、
 *      却把**原题的旧答案字母照抄**进 ans（实录：原题 ans=B，输出顺序
 *      已把正确项挪到首位，ans 仍是 B）；
 *   2. OptionShuffle 信任 ans 字母定位正确项并随洗牌重写字母——于是把
 *      原干扰项当成正确项洗进落盘；
 *   3. runRegen 链（parseDrafts → shuffle → renderUnit → 落盘）**全程
 *      无核查**（薄弱加练链 GenQuestion 有 verifyPrompt 自检，这条链没有）。
 * 解析文本里的「B 正确」同样是旧字母引用，三处互相矛盾。
 *
 * 本模块只出**判定**（不碰 AI、不碰库），两条动作：
 *   - `reseatAnswer`: 原序输出（regen 已改「选项沿用原题顺序」协议）时，
 *     原题正确项文本在新选项里定位 → 把 ans 改写为该选项的渲染字母
 *     （折行/标签/全角空白差异全部走既有的 optionComparable 归一）；
 *   - `pickDraft` 的 `mismatch`：定位不到正确项文本（选项被 AI 改写）→
 *     调用方走 `verifyPrompt` AI 自检兜底，no 则整题放弃、不落盘。
 */

/** 核查结论：ok=字母已校正（或无需校正）；mismatch=需 AI 自检兜底；
 *  skip=非核查范围（判断题走 √/× 比对，主观题等只走结构校验）。 */
export type RegenVerdict =
    { kind: "ok"; answer?: string } | { kind: "mismatch"; reason: "letters-not-found" } | { kind: "skip" };

/** 参与字母比对的客观题型（cloze/match 的答案在 slot/候选池里，不在
 *  顶层 ans，不参与——它们无顶层选项组，AI 也重排不了）。 */
const LETTER_TYPES: readonly QuestionType[] = [QuestionType.Single, QuestionType.Multiple];

/** 顶层答案部件。 */
const TOP_ANSWER = /^answer$/;

/** 顶层解析部件（择一）。 */
const TOP_SOLUTION = /^solution$/;

/** 判断题答案归一到 √/×（与 QuestionGrading 同口径，改这一份就是改全仓）。 */
const JUDGE_MAP: Record<string, string> = {
    "√": "√",
    对: "√",
    T: "√",
    TRUE: "√",
    X: "×",
    x: "×",
    错: "×",
    F: "×",
    FALSE: "×",
    "×": "×",
};

function judgeNorm(s: string): string {
    const n = s.trim().toUpperCase();
    return JUDGE_MAP[n] ?? n;
}

/** 草稿的全部顶层选项文本（按渲染序＝字母序）。 */
function optionTexts(d: DraftUnit): string[] {
    return d.parts.filter((p) => /^option/.test(p.name)).map((p) => p.text);
}

/**
 * 原序输出的答案字母校正：在新草稿选项里定位**原题正确项文本**，命中则
 * 把 ans 部件改写成该选项的字母。`q` 的原题视图（answer/optionMd）为空
 * （parse-fail 记录退化）时返回 skip（无基准可校，维持现状）。
 */
export function reseatAnswer(draft: DraftUnit, q: WenguQuestion): RegenVerdict {
    const type = (draft.attrs.type ?? q.type) as QuestionType | undefined;
    if (type === QuestionType.Judge) return judgeVerdict(draft, q);
    if (!type || !LETTER_TYPES.includes(type)) return { kind: "skip" };
    const origAns = (q.answer ?? "").trim().toUpperCase();
    if (!/^[A-Z]+$/.test(origAns)) return { kind: "skip" }; // 答案非字母：内容比对不在本口径
    const origOpts = q.optionMd ?? [];
    const wantTexts = [...origAns].map((ch) => origOpts[LETTERS.indexOf(ch)]);
    if (wantTexts.some((t) => t === undefined)) return { kind: "skip" }; // 原题选项缺失：无基准
    const opts = optionTexts(draft);
    const want = new Set(wantTexts.map((t) => optionComparable(t ?? "")));
    const hit = opts.map((t, i) => ({ i, key: optionComparable(t) })).filter((x) => want.has(x.key));
    // 正确集合规模必须对得上：改写后字母数 = 原题正确项数（多选题少一项就是错）
    if (hit.length !== want.size || want.size === 0) return { kind: "mismatch", reason: "letters-not-found" };
    const answer = hit
        .map((x) => LETTERS[x.i])
        .sort()
        .join("");
    setTopAnswer(draft, answer);
    return { kind: "ok", answer };
}

/** 判断题：√/× 文本比对（改了就是改了，不落盘）。 */
function judgeVerdict(draft: DraftUnit, q: WenguQuestion): RegenVerdict {
    const orig = (q.answer ?? "").trim();
    if (!orig) return { kind: "skip" };
    const now = draft.parts.find((p) => TOP_ANSWER.test(p.name))?.text.trim();
    if (!now) return { kind: "mismatch", reason: "letters-not-found" };
    return judgeNorm(now) === judgeNorm(orig) ? { kind: "ok" } : { kind: "mismatch", reason: "letters-not-found" };
}

/** 覆盖草稿的顶层答案部件（缺失时新建——解析把空答案部件丢掉了）。 */
function setTopAnswer(draft: DraftUnit, answer: string): void {
    const part = draft.parts.find((p) => TOP_ANSWER.test(p.name));
    if (part) part.text = answer;
    else {
        const at = draft.parts.findIndex((p) => TOP_SOLUTION.test(p.name));
        draft.parts.splice(at < 0 ? draft.parts.length : at, 0, { name: "answer", text: answer });
    }
}
