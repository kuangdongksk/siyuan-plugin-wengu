import { baseQid, hasSlots, hasSteps, isBriefLike, LETTERS, QuestionType } from "../../types";
import type { WenguQuestion } from "../../types";
import type { WenguSession, WenguSessionResult } from "../../quiz/service/HistoryStore";
import type { MobileCell, MobileCellState } from "../types";

/**
 * 移动端刷题纯逻辑（带单测）：题头 meta 分类、题号抽屉格子、
 * 轮次报告统计。**不含任何 DOM/内核调用**——渲染层（components/）
 * 与编排层（MobileDrill.ts）都消费这里的结果，口径只有一份。
 */

/** 题头题型标签（设计稿屏 ②③⑤：多选题 / 判断题 / 材料组题 / 解答题）。 */
export function typeLabelKey(q: WenguQuestion): string {
    if (q.group) return "mobileTypeGroup";
    if (hasSteps(q)) return "mobileTypeSteps";
    switch (q.type) {
        case QuestionType.Multiple:
            return "mobileTypeMultiple";
        case QuestionType.Judge:
            return "mobileTypeJudge";
        case QuestionType.Essay:
            return "mobileTypeEssay";
        case QuestionType.Cloze:
            return "mobileTypeCloze";
        case QuestionType.Match:
            return "mobileTypeMatch";
        case QuestionType.Trans:
            return "mobileTypeTrans";
        default:
            return "mobileTypeSingle";
    }
}

/**
 * 移动端作答形态（设计稿屏 ②③④⑤⑥）：**渲染与提交共用的唯一判据**。
 *
 * - `choice`：有选项的选择题（单选/多选）——选项行多点齐亮；
 * - `judge`：判断题——横排两项，点选即答；
 * - `text`：文本作答（简答/作文/翻译，**以及多步引导题**——桌面
 *   `StepsFlow` 的逐步作答/申诉链是重型交互，小屏上无落脚点，移动端按
 *   **整题文本作答**处理，只改作答形态、不改记账：仍记在同一块 qid 上）；
 * - `fill`：填空题（单行输入，`gradeQuestion` 自动判分，设计稿屏 ④ 注）；
 * - `slots`：完形/新题型（逐空作答是桌面 `SlotFlow` 的重型交互，移动端
 *   本轮**不给作答位**——整题文本作答会把它记成一道题的答案，与逐空记账
 *   口径冲突；只渲染题干并明示需在桌面作答）；
 * - `plain`：无题型/无答案的兜底题——揭示后走自评。
 *
 * ⚠️ 这个函数是**唯一判据**：作答位渲染（`QuestionBody`）与提交分流
 * （`MobileAnswering.submit`）都取它。改造前两边各写一份派生判据，结果
 * 填空题（无 optionMd）落进「都不是」的空档——既无输入区也无选项，**整题
 * 不可作答**；配对题（题级候选池 optionMd）又被当成选择题渲染，点选的
 * 「候选」与 `gradeQuestion` 期望的槽位字母对不上，静默判错。
 */
export type MobileAnswerKind = "choice" | "judge" | "text" | "fill" | "slots" | "plain";

export function answerKindOf(q: WenguQuestion): MobileAnswerKind {
    // 优先序有讲究，三条都不能挪：
    // 1) 逐空题：题级 optionMd 是**候选池**（match）而非本题选项，落进
    //    choice 分支会被当成「一题的选项」误判；
    // 2) 多步题：桌面同款（hasSteps 先判，走 StepsFlow 而非选项行），
    //    移动端走文本作答——若排在 choice 后，恰好带 optionMd 的 steps 题
    //    会退化成选择题；
    // 3) 判断题：选项横排两项，不走通用选项行。
    if (hasSlots(q)) return "slots";
    if (hasSteps(q)) return "text";
    if (q.type === QuestionType.Judge) return "judge";
    if ((q.optionMd?.length ?? 0) > 0 && (q.type === QuestionType.Single || q.type === QuestionType.Multiple))
        return "choice";
    if (isBriefLike(q)) return "text";
    if (q.type === QuestionType.Fill) return "fill";
    return "plain";
}

/**
 * 移动端「文本作答」形态（多行输入区 + AI 判分）：简答/作文/翻译，
 * **以及多步引导题**。是否真的渲染文本区还要看 `answerKindOf`（逐空题
 * 优先落 slots）——单独用它判渲染会与 slots 分支冲突。
 */
export function isMobileText(q: WenguQuestion): boolean {
    return isBriefLike(q) || hasSteps(q);
}

/** 该题是否为多选（多选出现「确认答案」主按钮，设计稿屏 ②）。 */
export function isMultiSelect(q: WenguQuestion): boolean {
    return answerKindOf(q) === "choice" && q.type === QuestionType.Multiple;
}

/** 选项字母列表（chip 与选项行共用）。 */
export function lettersOf(q: WenguQuestion): string[] {
    return (q.optionMd ?? []).map((_, i) => LETTERS[i] ?? "");
}

/** 会话结果按整题聚合（多步题记的是 qid#k）。 */
function resultsByQid(s: WenguSession | undefined): Map<string, WenguSessionResult> {
    const out = new Map<string, WenguSessionResult>();
    for (const r of s?.results ?? []) {
        const base = baseQid(r.qid);
        const prev = out.get(base);
        // 多步/逐空题有多个 #k 条目：错任一即错，否则取最后一条
        if (!prev) out.set(base, r);
        else if (!r.ok) out.set(base, r);
    }
    return out;
}

/** 单格状态（题号抽屉四态）：未答 / 已答对 / 已答错 / 已答（收卷模式中性）。 */
function cellStateOf(r: WenguSessionResult | undefined, batch: boolean): MobileCellState {
    if (!r) return "none";
    if (batch) return "answered";
    return r.ok ? "ok" : "bad";
}

/**
 * 题号抽屉格子：**材料组整组合并成一格**（设计稿屏 ⑨「15–19 阅读 · 组题」），
 * 其余逐题一格。组格状态取组内最差（错 > 已答 > 未答 > 对）——与
 * 「轮次报告错题清单」口径一致，用户点进去就是那道没做对的题。
 */
export function drawerCells(
    list: WenguQuestion[],
    session: WenguSession | undefined,
    batch: boolean,
    typeLabel: (q: WenguQuestion) => string
): MobileCell[] {
    const byQid = resultsByQid(session);
    const cells: MobileCell[] = [];
    for (let i = 0; i < list.length; i++) {
        const q = list[i];
        if (!q.group) {
            cells.push({ idx: i, end: i, state: cellStateOf(byQid.get(q.id), batch) });
            continue;
        }
        const end = groupEndAt(list, i);
        cells.push({
            idx: i,
            end,
            state: groupState(list.slice(i, end + 1), byQid, batch),
            sub: typeLabel(q),
        });
        i = end;
    }
    return cells;
}

/** 同组题的末位下标（组按 list 连续排布）。 */
function groupEndAt(list: WenguQuestion[], from: number): number {
    const mid = list[from].group;
    let i = from;
    while (i + 1 < list.length && list[i + 1].group === mid) i++;
    return i;
}

/** 组格聚合：错 > 已答 > 未答 > 对（最差优先，点进去就是那道错的）。 */
function groupState(group: WenguQuestion[], byQid: Map<string, WenguSessionResult>, batch: boolean): MobileCellState {
    const states = group.map((q) => cellStateOf(byQid.get(q.id), batch));
    if (states.includes("bad")) return "bad";
    if (states.includes("answered")) return "answered";
    if (states.includes("none")) return "none";
    return "ok";
}

/** 轮次报告统计：答对 / 答错 / 未答 + 得分。 */
export interface MobileReportStats {
    total: number;
    right: number;
    wrong: number;
    none: number;
    /** 得分（百分制，答对 / 题数；未答 0 分）。 */
    score: number;
    /** 已答题数（收卷模式下「已答 N/M」）。 */
    answered: number;
}

export function reportStats(list: WenguQuestion[], session: WenguSession | undefined): MobileReportStats {
    const byQid = resultsByQid(session);
    let right = 0;
    let wrong = 0;
    let none = 0;
    for (const q of list) {
        const r = byQid.get(q.id);
        if (!r) none++;
        else if (r.ok) right++;
        else wrong++;
    }
    const total = list.length;
    return {
        total,
        right,
        wrong,
        none,
        answered: total - none,
        score: total > 0 ? Math.round((right / total) * 100) : 0,
    };
}

/** 错题清单行（报告屏）：题号 + 题型 + 题干摘要 + 你的答案/正解。 */
export interface MobileWrongRow {
    idx: number;
    qid: string;
    typeKey: string;
    title: string;
    detail: string;
}

export function wrongRows(
    list: WenguQuestion[],
    session: WenguSession | undefined,
    t: (k: string) => string
): MobileWrongRow[] {
    const byQid = resultsByQid(session);
    const rows: MobileWrongRow[] = [];
    list.forEach((q, i) => {
        const r = byQid.get(q.id);
        if (!r || r.ok) return;
        rows.push({
            idx: i,
            qid: q.id,
            typeKey: typeLabelKey(q),
            title: stemSummary(q),
            detail: wrongDetail(q, r, t),
        });
    });
    return rows;
}

/** 题干摘要（纯文本单行，报告行与题头共用）。 */
export function stemSummary(q: WenguQuestion): string {
    const text = (q.stemMd ?? "")
        .replace(/`{1,3}[^`]*`{1,3}/g, " ")
        .replace(/[#*_>~[\]()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > 48 ? `${text.slice(0, 48)}…` : text || q.id;
}

/** 错题行副文案：你的答案 → 正解（简答类给判分评语）。 */
function wrongDetail(q: WenguQuestion, r: WenguSessionResult, t: (k: string) => string): string {
    const mine = r.submitted ? displayAnswer(q, r.submitted) : t("mobileAnswerNone");
    const verdict = r.verdict ?? (r.ok ? "right" : "wrong");
    if (isBriefLike(q) || hasSteps(q)) {
        const tail = r.comment ? ` · ${r.comment}` : "";
        return verdict === "partial" ? `${t("verdictPartial")}${tail}` : `${mine}${tail}`;
    }
    const answer = q.answer ? displayAnswer(q, q.answer) : "";
    return answer ? `${mine} → ${answer}` : mine;
}

/** 答案展示：字母集合转「A、C」形态，其余原样。 */
function displayAnswer(q: WenguQuestion, raw: string): string {
    const letters = lettersOf(q);
    const s = raw.trim().toUpperCase();
    if (letters.length > 0 && s.length > 0 && s.split("").every((c) => letters.includes(c))) {
        return s.split("").join("、");
    }
    return raw.trim();
}

/** 本次题数候选（设计稿屏 ①：10 / 20 / 全部；不足则裁剪）。 */
export function countChoices(total: number): number[] {
    const out = [10, 20].filter((n) => n < total);
    out.push(0); // 0 = 全部
    return out;
}

/** 本次题数标签（0 =「N 题 · 全部」）。 */
export function countLabel(n: number, total: number, t: (k: string) => string): string {
    return n === 0 ? `${total} ${t("mobileCountSuffix")} · ${t("mobileCountAll")}` : `${n} ${t("mobileCountSuffix")}`;
}

/** 进度百分比（已答 / 题数）。 */
export function answeredPct(answered: number, total: number): number {
    if (total <= 0) return 0;
    return Math.min(100, Math.round((answered / total) * 100));
}

/** 开刷面板题集分组（设计稿屏 ①：按**源文档**分组，组头显「N 个题集」）。
 *  题集 id 即源文档 id（BankSets 口径），分组键取 hPath 的最后一段（文档
 *  名），hPath 缺失时回落题集标题/id——**纯展示分组，不改任何装载口径**。 */
export interface MobileSetGroup<T> {
    key: string;
    /** 组头文案（源文档名）。 */
    title: string;
    sets: T[];
}

export function groupSetsByDoc<T extends { id: string; title?: string; hPath?: string }>(
    sets: T[]
): MobileSetGroup<T>[] {
    const groups = new Map<string, MobileSetGroup<T>>();
    for (const s of sets) {
        const segs = (s.hPath ?? "").split("/").filter(Boolean);
        // 组键用**完整 hPath**（同名不同目录的源文档不能并成一组），
        // 组头取最后一段（文件名）；无 hPath 时整卷并一组用兜底标题
        const key = s.hPath || `#${s.id}`;
        let g = groups.get(key);
        if (!g) {
            g = { key, title: segs[segs.length - 1] ?? s.title ?? s.id, sets: [] };
            groups.set(key, g);
        }
        g.sets.push(s);
    }
    return [...groups.values()];
}
