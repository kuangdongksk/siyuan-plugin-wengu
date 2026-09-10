/**
 * 逐段自推进原语（20260910 起整卷转换**不再预切块**）：源文档十几万字符、
 * 内核 AI 单次只吃得下约 6k 字符，于是改成「每次给一段窗口 → AI 出题并
 * 回报自己处理到哪 → 游标推进」的串行循环，**批边界由 AI 按题目边界决定**
 * （不再由标题链函数决定，因此不会把一道题拦腰切断）。
 *
 * 定位协议：AI 在回复末尾输出 `@@TO: <原文逐字片段>`（本批处理到的最后一
 * 行）或 `@@TO: END`（窗口内已处理完）。片段与原文做**去空白去标点的归一
 * 化匹配**（AI 抄错标点/空白不影响命中），命中后推进到该行**下一行行首**
 * ——行尾吸附保证下一批永远不落在行中间，不会重复读半行。
 *
 * 本模块纯函数（取窗 / 归一化定位 / 定位行解析），内核 IO 与业务在 ConvertBatch。
 */

/** 单批窗口字符上限（内核 AI 代理实测：约 6k 字符 22 秒稳定返回 12 题，
 *  12k 会超时空返回——与旧切块阈值同源，改名体现「窗口」语义）。 */
export const STEP_CHARS = 6000;

/** 归一化后允许参与匹配的最短片段（太短易误命中上游同名文本）。 */
const MIN_ANCHOR_CHARS = 8;

/** 一段窗口：[start, end) 是它在源文档里的原文区间。 */
export interface SourceWindow {
    text: string;
    start: number;
    end: number;
}

/**
 * 取窗口（确定性纯函数）：从 from 起最多 maxChars 字符，尽量收在空行边界
 * （至少推进半个窗口，避免窗口尾部切断整行）；已到末尾则 end = 文档长。
 * 窗口只是「本批给 AI 看多少」，**不是批边界**——批边界由 AI 的 @@TO 决定，
 * 窗口末尾的半道题由 AI 留着、下一批从那里接着读。
 *
 * limit = 分片并行（20260910）后的**片尾上限**：片内窗口不越过本片末尾，
 * 片与片因此互不重叠。limit 恒取片边界——切点只在题目边界上取（见
 * ShardPlan），窗口不会在题中间被截断。
 */
export function stepWindow(md: string, from: number, maxChars = STEP_CHARS, limit = md.length): SourceWindow {
    const upper = Math.max(0, Math.min(limit, md.length));
    const start = Math.max(0, Math.min(from, upper));
    let end = Math.min(start + maxChars, upper);
    if (end < upper) {
        const blank = md.lastIndexOf("\n\n", end);
        if (blank > start + Math.floor(maxChars / 2)) end = blank + 2;
    }
    return { text: md.slice(start, end), start, end };
}

/** 归一化索引：norm 串（原文去空白去标点）+ 每个 norm 字符对应的原文偏移。 */
export interface NormIndex {
    norm: string;
    /** map[i] = norm[i] 在原文中的下标（升序）。 */
    map: number[];
}

/** 归一化保留判据：字母/数字/汉字等实义字符留下，空白与标点符号丢弃。 */
const DROP_RE = /[\s\u3000]|[\p{P}\p{S}]/u;

/** 归一化：去空白与标点，只留实义字符（两侧用法必须一致才可能命中）。 */
export function normalizeKeep(s: string): string {
    let out = "";
    for (const c of s) {
        if (!DROP_RE.test(c)) out += c;
    }
    return out;
}

/** 建归一化索引（长文档 O(n) 一次，循环里复用同一份）。按码点遍历，
 *  map 记的仍是 UTF-16 码元偏移（与 slice 同口径）。 */
export function buildNormIndex(md: string): NormIndex {
    const chars: string[] = [];
    const map: number[] = [];
    for (let i = 0; i < md.length;) {
        const c = String.fromCodePoint(md.codePointAt(i)!);
        if (!DROP_RE.test(c)) {
            chars.push(c);
            map.push(i);
        }
        i += c.length;
    }
    return { norm: chars.join(""), map };
}

/** map 中第一个 ≥ offset 的下标（map 升序，二分）。 */
function lowerBound(map: number[], offset: number): number {
    let lo = 0;
    let hi = map.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (map[mid] < offset) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/** AI 的定位指令：END=窗口内处理完，anchor=处理到该片段所在行。 */
export type ToDirective = { kind: "end" } | { kind: "anchor"; text: string };

/** 从回复抽 `@@TO:` 行（中英文冒号、首尾引号都容忍）；没有该行返回
 *  undefined（调用方走保守兜底推进）。 */
export function parseToDirective(reply: string): ToDirective | undefined {
    const m = /^[ \t]*@@TO[ \t]*[:：][ \t]*(.+?)[ \t]*$/im.exec(reply);
    if (!m) return undefined;
    const v = m[1]
        .trim()
        .replace(/^["'「『]+|["'」』]+$/g, "")
        .trim();
    if (!v) return undefined;
    if (/^(end|done|none|无|结束|完毕|已完)$/i.test(v)) return { kind: "end" };
    return { kind: "anchor", text: v };
}

/** 剥掉 `@@TO:` 行（行协议解析前预处理，防它被当成题目正文行）。 */
export function stripToDirective(reply: string): string {
    return reply.replace(/^[ \t]*@@TO[ \t]*[:：].*$/gim, "");
}

/**
 * 定位推进：把 AI 报的片段还原成源文档偏移，返回**该片段所在行的下一行
 * 行首**（新游标）。片段归一化后短于阈值、或从 from 之后搜不到 → undefined
 * （调用方兜底）。命中位置取 from 之后的第一个（不会倒退）。
 */
export function locateToAnchor(md: string, from: number, anchor: string, idx?: NormIndex): number | undefined {
    const a = normalizeKeep(anchor);
    if (a.length < MIN_ANCHOR_CHARS) return undefined;
    const index = idx ?? buildNormIndex(md);
    const hit = index.norm.indexOf(a, lowerBound(index.map, Math.max(0, from)));
    if (hit < 0) return undefined;
    const pos = index.map[hit];
    const nl = md.indexOf("\n", pos);
    return nl < 0 ? md.length : nl + 1;
}

/** 兜底推进：AI 没给 @@TO 或定位失败时，把整段窗口视为已处理（保守，
 *  不卡死循环；代价是窗口末尾若真有半道题，该题会在下一批被跳过）。 */
export function fallbackCursor(win: SourceWindow): number {
    return win.end;
}

/** 推进结果：cursor=新游标；located=false 表示走了兜底（AI 没给 @@TO、
 *  定位失败、越出本窗口或没前进——调用方据此累计定位失败警告）。 */
export interface AdvanceResult {
    cursor: number;
    located: boolean;
}

/**
 * 由「本批窗口 + AI 的 @@TO」算出下一批游标（纯函数）：
 * - `@@TO: END` → 窗口末（本窗口处理完）；
 * - `@@TO: <片段>` → 片段所在行的下一行行首，但必须**落在本窗口内且严格
 *   前进**——越界或倒退说明 AI 抄的位置不可信，退回兜底；
 * - 走兜底时 located=false，且新游标恒大于推进前（不死循环）。
 */
export function advanceCursor(
    md: string,
    cursor: number,
    win: SourceWindow,
    to: ToDirective | undefined,
    idx?: NormIndex
): AdvanceResult {
    if (to?.kind === "end") return { cursor: Math.max(win.end, cursor), located: true };
    if (to?.kind === "anchor") {
        const hit = locateToAnchor(md, cursor, to.text, idx);
        if (hit !== undefined && hit > cursor && hit <= win.end) return { cursor: hit, located: true };
    }
    return { cursor: Math.max(fallbackCursor(win), cursor), located: false };
}
