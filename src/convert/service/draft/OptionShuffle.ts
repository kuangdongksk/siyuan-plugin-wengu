import { LETTERS } from "../../../types";
import type { DraftUnit } from "../draft/QuestionDraft";

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
 *
 * **解析里的字母引用同步改写**（Issue #123，20260915）：生成协议让 AI
 * 按「正确项在最前」写 **解析**（「A 正确，B 错误」），洗牌只重写答案
 * 字母的话解析字母会全部失配（指到别的选项上）。故洗牌时按同一条字母
 * 映射（旧字母 → 新字母）改写解析文本里的**独立裸字母词符**（A–H 单字母
 * 词符，带边界）。口径与边界：
 *   - 只认 `\b[A-H]\b`（且字母确为该组真实存在的选项）；CJK 相邻时
 *     `\b` 依赖字符类边界，中文「选项 A 正确」这类仍能命中；
 *   - **排除**行内/围栏代码（`` ` ``）、数学区间（`$...$` / `$$...$$`、
 *     `\(...\)` / `\[...\]`）——公式里的 A 不是选项字母，改了就是
 *     静默毁公式（与 gloss 域 `^{}` 的 protectedSpans 同款纪律）；
 *   - 撇号前缀（英语 `students' A` 一类所有格）不认，避免误伤；
 *   - 位置敏感措辞组本就跳过洗牌，「A 和 B」类解析天然不失配。
 *
 *  ⚠️ **映射的语义前提**（20260915 实测厘清，别想当然）：这条改写假定
 *  「解析里的字母 = **本组选项的序位字母**」，这正是「正确项写最前」协议
 *  的含义（AI 写解析时看到的顺序就是它自己输出的顺序）。重生成链已改
 *  走 keep 序（选项按原题顺序、字母随顺序对应），此时映射是恒等、改写
 *  是零动作——**若 keep 序下解析仍写旧字母（AI 想指原题第 2 项），那是
 *  语义错误、位置映射救不了**，由 RegenDialog 的答案核查（reseatAnswer
 *  + verifyPrompt 自检）兜底，不在本层处理。
 */

/** 位置敏感措辞：洗牌会破坏指代关系，保留 AI 原序。 */
export const POSITION_SENSITIVE = /(以上|上述|都不|都是|全都|全部|均正确|均错误|\b[A-D]\b\s*(?:和|与|及))/;

/** 选项组：组内选项部件下标 + 对应答案部件下标（ans<0=无答案不洗）。 */
interface OptGroup {
    opts: number[];
    ans: number;
}

/** 解析里可安全改写字母的词符：独立 A–H 单字母（词边界）、排除
 *  `'A`（所有格前缀）。**改写前一律先剥受保护区**（见 protectedMask）。 */
const LETTER_TOKEN = /(?<![A-Za-z])[A-H](?![A-Za-z])/g;
/** 所有格前缀形态（`students' A`）——词符整体跳过，不当作选项字母引用。 */
const POSSESSIVE_BEFORE = /['\u2019][ \t]?$/;

/** 需要排除改写的区间：行内代码、围栏代码、数学（$…$ / $$…$$ /
 *  \(…\) / \[…\]）——公式里的字母不是选项字母。 */
function protectionMask(text: string): boolean[] {
    const n = text.length;
    const inMath = new Array<boolean>(n).fill(false);
    const spans: [number, number][] = [];
    const push = (re: RegExp, flags = "g"): void => {
        for (const m of text.matchAll(new RegExp(re.source, flags))) spans.push([m.index, m.index + m[0].length]);
    };
    push(/`[^`\n]*`/);
    push(/```[\s\S]*?```/);
    push(/\$\$[\s\S]*?\$\$/);
    push(/\$[^$\n]*\$/);
    push(/\\\([\s\S]*?\\\)/);
    push(/\\\[[\s\S]*?\\\]/);
    for (const [a, b] of spans) for (let i = a; i < b && i < n; i++) inMath[i] = true;
    return inMath;
}

/** 按字母映射改写一段文本里的独立字母词符（受保护区/已映射外的不动）。 */
export function rewriteLetters(text: string, map: (ch: string) => string): string {
    if (!text) return text;
    const mask = protectionMask(text);
    let out = "";
    let last = 0;
    let changed = false;
    for (const m of text.matchAll(LETTER_TOKEN)) {
        const at = m.index;
        // 跳过的命中（受保护区/所有格前缀/映射不变）必须原样补回来，否则被吞
        const skip = mask[at] || POSSESSIVE_BEFORE.test(text.slice(0, at));
        const to = skip ? m[0] : map(m[0]);
        out += text.slice(last, at) + to;
        last = at + m[0].length;
        if (to !== m[0]) changed = true;
    }
    if (!changed) return text;
    return out + text.slice(last);
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
    // 旧字母 → 新字母：原第 i 位的选项内容洗到 order[j]=i 的第 j 位，
    // 字母随之 i→j（与上面的 newRun 计算同一套 order，禁分头重算）。
    const toIdx = new Map<number, number>();
    for (let j = 0; j < n; j++) toIdx.set(order[j], j);
    const map = (ch: string): string => {
        const i = LETTERS.indexOf(ch);
        const j = toIdx.get(i);
        return j === undefined ? ch : LETTERS[j];
    };
    for (let j = 0; j < n; j++) d.parts[grp.opts[j]].text = texts[order[j]];
    ansPart.text = newRun;
    rewriteSolutionLetters(d, map);
}

/** 按字母映射改写解析文本里的独立字母词符（Issue #123 的解析失配补偿）。
 *  只改**解析类部件**：顶层 solution、多步题的整题解析、逐空/逐步的
 *  solution（顶层与嵌套组都覆盖——组内解析同受洗牌影响）。题干/材料
 *  正文不动（那不是选项字母的引用面，误改风险大于收益）。 */
function rewriteSolutionLetters(d: DraftUnit, map: (ch: string) => string): void {
    for (const p of d.parts) {
        if (!/^(?:solution|.*-solution)$/.test(p.name)) continue;
        p.text = rewriteLetters(p.text, map);
    }
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
