import { LETTERS } from "../../types";
import type { DraftUnit } from "./QuestionDraft";

/**
 * AI 生成选择题的选项洗牌（draft 层，20260902 随行协议重构从 kramdown
 * 字符串手术改为部件数组重排）：转换/生成 prompt 让模型「正确项写最前、
 * 再补干扰项」，渲染字母又按顺序自动编 → 不洗则正确项恒为 A。这里在
 * 渲染前做 Fisher-Yates 洗牌并同步改写答案字母，判分（按字母比对）与
 * 展示自然一致。
 *
 * 覆盖题型：single / multiple（顶层选项组）与 steps（每步选项组各自
 * 洗）；judge/fill/cloze/match/essay/trans 无字母重排语义，原样跳过。
 * 选项文本含位置敏感措辞（「以上都对」「A 和 B」一类）时跳过该组洗牌。
 */

/** 位置敏感措辞：洗牌会破坏指代关系，保留 AI 原序。 */
export const POSITION_SENSITIVE = /(以上|上述|都不|都是|全都|全部|均正确|均错误|\b[A-D]\b\s*(?:和|与|及))/;

/** 选项组：组内选项部件下标 + 对应答案部件下标（ans<0=无答案不洗）。 */
interface OptGroup {
    opts: number[];
    ans: number;
}

/** 收集单元的全部选项组（键 ""=顶层；step-k=多步题第 k 步）。 */
function collectGroups(d: DraftUnit): Map<string, OptGroup> {
    const g = new Map<string, OptGroup>();
    d.parts.forEach((p, i) => {
        const key = /^option/.test(p.name) ? "" : /^step-\d+-option/.exec(p.name)?.[0].replace(/-option.*$/, "");
        if (key !== undefined) {
            const cur = g.get(key) ?? { opts: [], ans: -1 };
            cur.opts.push(i);
            g.set(key, cur);
            return;
        }
        const am = /^answer$|^(step-\d+)-answer/.exec(p.name);
        if (!am) return;
        const ak = am[1] ?? "";
        const cur = g.get(ak) ?? { opts: [], ans: -1 };
        cur.ans = i;
        g.set(ak, cur);
    });
    return g;
}

/** 对一个选项组洗牌并重写答案字母；不可洗（太少/措辞敏感/答案非纯
 *  字母）时不动。字母映射：字母=渲染时按部件位置自动编（A=第 1 个），
 *  洗牌把原第 i 个部件的内容挪到第 j 位，答案字母随之 i→j 重编。 */
function shuffleGroup(d: DraftUnit, grp: OptGroup): void {
    const n = grp.opts.length;
    if (n < 2 || grp.ans < 0) return;
    const ansPart = d.parts[grp.ans];
    const oldRun = ansPart.text.trim();
    if (!/^[A-Ha-h]+$/.test(oldRun) || [...oldRun.toUpperCase()].some((ch) => LETTERS.indexOf(ch) >= n)) return;
    const oldSorted = [...oldRun.toUpperCase()].sort().join("");
    const texts = grp.opts.map((i) => d.parts[i].text);
    if (texts.some((t) => POSITION_SENSITIVE.test(t))) return;
    let order: number[] = [];
    let newRun = oldSorted;
    for (let tries = 0; tries < 10 && (order.length === 0 || newRun === oldSorted); tries++) {
        order = [...Array(n).keys()];
        for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        newRun = [...oldRun.toUpperCase()]
            .map((ch) => LETTERS[order.indexOf(LETTERS.indexOf(ch))])
            .sort()
            .join("");
    }
    if (order.length === 0 || newRun === oldSorted) return;
    for (let j = 0; j < n; j++) d.parts[grp.opts[j]].text = texts[order[j]];
    ansPart.text = newRun;
}

/** 拆行 unpack（20260905 真机数据踩坑）：AI 无视「每个选项一个 @@P opt」
 *  把全部选项一行一个塞进同一部件时，渲染只给首行编字母、其余行成
 *  续行——落库即「只剩正确选项」（正确项按协议写最前，恰在首行）。
 *  这里按行拆回独立选项（同名部件跟随，渲染按连续同名合并重编字母），
 *  并把答案重写为 A——协议保证首行=正确项；原答案字母口径不可信
 *  （混用原卷字母与重排字母，不重写会静默判错）。只拆单选语义组：
 *  multiple/steps 步组的正确集合规模推不出来，不拆（挤行形态可被
 *  题库体检入口检出）。 */
function unpackPackedSingle(d: DraftUnit): void {
    for (const [key, grp] of collectGroups(d)) {
        if (key !== "" || grp.opts.length !== 1) continue;
        const part = d.parts[grp.opts[0]];
        const lines = part.text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
        if (lines.length < 2) continue;
        const ansPart = grp.ans >= 0 ? d.parts[grp.ans] : null;
        d.parts.splice(grp.opts[0] + 1, 0, ...lines.slice(1).map((text) => ({ name: part.name, text })));
        part.text = lines[0];
        if (ansPart) ansPart.text = "A";
    }
}

/** 协议单元的选择题选项洗牌入口（渲染前调用，原位改动部件数组）。 */
export function shuffleDraftOptions(d: DraftUnit): void {
    const type = d.attrs.type ?? "";
    if (type !== "single" && type !== "multiple" && type !== "steps") return;
    if (type === "single") unpackPackedSingle(d);
    for (const [, grp] of collectGroups(d)) shuffleGroup(d, grp);
}
