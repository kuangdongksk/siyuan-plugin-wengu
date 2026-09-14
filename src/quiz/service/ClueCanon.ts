/**
 * 线索锚点二期的**权威坐标系**（Issue #52 附录 D1/D3/D5）：纯逻辑层，
 * 无内核 IO、无 DOM 副作用——文本节点表与 Range 由调用侧（MaterialDecorate）
 * 观测后喂进来，本文件只做判定与换算，全部带单测。
 *
 * 核心口径（设计稿附录逐字）：
 * - **权威原文** := 基础渲染（`renderMdHtml(body)`）后、任何装饰施工前的
 *   **拼接可见文本**（文本节点序）；坐标 = 该文本的字符偏移 `[start,end)`。
 *   不用 md 源串偏移：md 语法字符与可见文本非一一对应，映射回源偏移需要
 *   逐字 source map（markdown-it 无现成机制）。
 * - **非权威区**（剔除出坐标系、不可锚定）：词表区 `ul.wengu-gloss`、
 *   词表联动上标 `.wengu-gloss-sup`、按钮/选项/解析区（沿用现行消费侧
 *   施工名单）。选项区等本来就不出浮条，剔出只为防御。
 * - **公式区**（inline-math / NodeMathBlock 占位）：按非权威处理（文本形态
 *   复杂，跨公式选段走降级链），数学卷现状能用的行为不回归。
 * - **装饰不改变权威文本**（D5 的关键性质）：词表 wrap（`<u>词</u>` + 序号
 *   上标）与线索 mark 都只是在权威文本节点之间**插入**非权威文本，权威
 *   文本节点自身的 nodeValue 逐字不变 ⇒ 权威串 `S` 跨装饰恒定，坐标可用
 *   权威切片 `S.slice(s,e)` 直接校验、渲染不回写。
 *
 * 与词表联动的**单向嵌套**（Issue #51 语义保留）：线索 mark 在外层包住
 * 联动 `<u>`（mark=用户语义层，span=内容层）；词表区永不包 mark。
 */

/** 一个权威文本节点（观测侧收集：节点引用 + 节点内起始偏移）。 */
export interface CanonNode {
    /** 该节点在权威串里的起始偏移（含）。 */
    start: number;
    /** 该节点在权威串里的结束偏移（不含）。 */
    end: number;
}

/** 权威坐标系：权威串 + 节点表。节点表下标与观测侧传入的数组严格对齐
 *  （`nodeIndex` 由调用方在收集时赋好，见 MaterialDecorate）。 */
export interface CanonMap {
    /** 权威原文（装饰注入前的可见文本拼接）。 */
    text: string;
    /** 权威节点表（偏移按权威串口径）。 */
    nodes: CanonNode[];
    /** 每个权威节点在调用侧文本节点数组里的下标（与 nodes 同序）。 */
    nodeIndex: number[];
}

/** 从「节点文本 + 节点下标」建权威坐标系（**装饰施工前**调用）。 */
export function buildCanonMap(texts: string[], nodeIndex: number[]): CanonMap {
    const nodes: CanonNode[] = [];
    let at = 0;
    for (const t of texts) {
        nodes.push({ start: at, end: at + t.length });
        at += t.length;
    }
    return { text: texts.join(""), nodes, nodeIndex: [...nodeIndex] };
}

/** 权威串里的一个区间（`end` 不含）。 */
export interface CanonRange {
    s: number;
    e: number;
}

/** 把「调用侧文本节点 + 节点内偏移」换算成权威坐标；节点不在表里返回 null。 */
export function canonOffsetOf(map: CanonMap, nodeIndex: number, inNode: number): number | null {
    const at = map.nodeIndex.indexOf(nodeIndex);
    if (at < 0) return null;
    const node = map.nodes[at];
    if (!node) return null;
    const off = node.start + inNode;
    return off >= node.start && off <= node.end ? off : null;
}

/**
 * 把一处选区（起点/终点各为「文本节点下标 + 节点内偏移」）换算成权威坐标。
 *
 * 非权威区（词表区/上标/按钮/选项/解析区）的文本节点**不在**表里，落在
 * 那里的端点经 `nearestCanonOffset` 钳到最近权威边界；钳不出来（全表为空）
 * 返回 null ⇒ 调用侧走降级链（D6）。
 *
 * 起止**各自独立**换算：跨段选段的起点在上一段末尾、终点在下一段开头，
 * 两者之间隔着非权威节点，逐点钳比整段求交更稳（宁缺勿错）。
 */
export function rangeToCanon(
    map: CanonMap,
    start: { nodeIndex: number; offset: number },
    end: { nodeIndex: number; offset: number }
): CanonRange | null {
    const s = nearestCanonOffset(map, start);
    const e = nearestCanonOffset(map, end);
    if (s === null || e === null || e <= s) return null;
    return { s, e };
}

/**
 * 找一个「文本节点 + 节点内偏移」最近邻的权威偏移：在表里按节点顺序
 * 回退（节点在起点之前 ⇒ 取该权威节点末尾）/ 前进（节点在终点之后 ⇒
 * 取该权威节点起点），对应区间端点分别用 `prefer="end" | "start"`。
 */
function nearestCanonOffset(
    map: CanonMap,
    pick: { nodeIndex: number; offset: number },
    prefer: "start" | "end" = "start"
): number | null {
    const at = canonOffsetOf(map, pick.nodeIndex, pick.offset);
    if (at !== null) return at;
    if (map.nodes.length === 0 || map.nodeIndex.length === 0) return null;
    // 找最近的权威节点：节点下标比表里任一权威节点都小 ⇒ 取首个；都比它大
    // ⇒ 取末个；落在中间 ⇒ 取靠后的那个边界（在它之前、最近的权威节点末尾）。
    let prev = -1;
    let next = -1;
    for (let i = 0; i < map.nodeIndex.length; i++) {
        if (map.nodeIndex[i] < pick.nodeIndex) prev = i;
        else if (map.nodeIndex[i] > pick.nodeIndex) {
            next = i;
            break;
        }
    }
    if (prefer === "end") {
        if (prev >= 0) return map.nodes[prev].end;
        return next >= 0 ? map.nodes[next].start : null;
    }
    if (next >= 0) return map.nodes[next].start;
    return prev >= 0 ? map.nodes[prev].end : null;
}

/**
 * 选区端点换算（Range→权威坐标，D2 主路径）：**按 DOM 顺序取权威外壳**——
 * start 用「向前不超出选区的最近权威位置」（节点在权威表里就取该偏移，
 * 否则钳到其前一个权威节点末尾）、end 同理取其后的最近权威位置。选段
 * 端点落在非权威区（词表区/上标/按钮/选项/解析区/公式占位）时被钳到
 * 最近权威边界，钳不出（表为空）返回 null ⇒ 降级链（D6）。
 */
export function canonRangeOf(
    map: CanonMap,
    start: { nodeIndex: number; offset: number },
    end: { nodeIndex: number; offset: number }
): CanonRange | null {
    const s = shellOffset(map, start, "end");
    const e = shellOffset(map, end, "start");
    const { s: lo, e: hi } = s !== null && e !== null && e < s ? { s: e, e: s } : { s, e };
    if (lo === null || hi === null || hi <= lo) return null;
    return { s: lo, e: hi };
}

/** 权威外壳：节点在权威表里 ⇒ 直接用其偏移；否则按方向钳到最近边界。 */
function shellOffset(map: CanonMap, pick: { nodeIndex: number; offset: number }, dir: "start" | "end"): number | null {
    const at = canonOffsetOf(map, pick.nodeIndex, pick.offset);
    if (at !== null) return at;
    return nearestCanonOffset(map, pick, dir);
}

/** 权威切片（chips 显示文本 = 它；上标噪音天然不含）。 */
export function canonSlice(map: CanonMap, r: CanonRange): string {
    return map.text.slice(r.s, r.e);
}

/**
 * 施工前坐标校验（D5 防漂移自愈）：`权威切片 === 存储 text` 才按坐标施工。
 * 不等（材料被增量重转 / 数据错位）⇒ 调用侧降级文本匹配，再不行只出 chip。
 * **坐标漂移从静默错误变成自愈降级**：宁可不出，不亮错位置。
 */
export function verifyCanonSlice(map: CanonMap, r: CanonRange, text: string): boolean {
    if (r.s < 0 || r.e > map.text.length || r.e <= r.s) return false;
    return canonSlice(map, r) === text;
}

/**
 * 轮间重算映射（D4 第 ④ 步，嵌套得以支持的关键）：装饰施工会 `splitText`
 * 截短节点、并在权威节点之间插入非权威节点（`<u>`/`<sup>` 的文本）——
 * 施工后的节点表不再与权威表一一对应。以**权威坐标**为中介重建：
 * 对每个仍属权威的节点按「它承载的权威区间」重新求 `[start,end)`；新插入
 * 的非权威节点（其文本不在权威串里、或落在权威节点区间之外）**不进表**，
 * 于是后续施工（mark 按坐标落格）只会落在权威文本上。
 *
 * 入参：`texts` = 施工后全部节点的原文，`isCanon` = 各节点在本轮是否权威
 * （调用侧按其祖先是否命中非权威选择器判定），`map` = 装饰前的权威表。
 * 返回新的权威表（节点下标换成施工后节点表的下标）。
 */
export function remapCanon(map: CanonMap, texts: string[], isCanon: boolean[]): CanonMap {
    const nodes: CanonNode[] = [];
    const nodeIndex: number[] = [];
    // 权威节点在装饰后仍按序拼接出**同一个权威串**（装饰只改变节点边界与
    // 插入非权威节点、不改字符），故逐个节点从 `at` 起在权威串里定位即可；
    // 定位不到 ⇒ 跳过（不进表），绝不回退到 `at` 之前——表单调递增是
    // canonSlots 的前提。
    let at = 0;
    for (let i = 0; i < texts.length; i++) {
        const t = texts[i] ?? "";
        if (!isCanon[i] || t.length === 0) continue;
        const start = map.text.startsWith(t, at) ? at : map.text.indexOf(t, at);
        if (start < 0) continue; // 该节点文本不在权威串里：不进表（不可锚定）
        nodes.push({ start, end: start + t.length });
        nodeIndex.push(i);
        at = start + t.length;
    }
    return { text: map.text, nodes, nodeIndex };
}

/* ── 坐标 → 节点内区间（施工用） ── */

/** 一处待落格的坐标段：节点下标（**施工后节点表**）+ 节点内区间。 */
export interface CanonSlot {
    node: number;
    from: number;
    to: number;
}

/**
 * 权威坐标 → 「节点下标 + 节点内区间」（纯函数，单测覆盖）。
 *
 * `map` 必须是**当前 DOM 节点表**口径的权威表（装饰完成后由 remapCanon
 * 重建），施工前算好全部计划、再由 markSlots 排序统一落格——`splitText`
 * 会截短节点，同一节点内靠后的段必须先切（与 MaterialDecorate.assignHitsToNodes
 * 同款口径，Issue #36）。
 *
 * 一条坐标段**跨多个节点**时逐节点取交集展开成多段（表内节点均属权威，
 * 故展开天然不会碰到非权威节点）。命中不完整（两端不全在表里）返回空
 * 数组 ⇒ 调用侧降级（D5/D6）。
 */
export function canonSlots(map: CanonMap, r: CanonRange): CanonSlot[] {
    const out: CanonSlot[] = [];
    if (r.e <= r.s) return out;
    for (let i = 0; i < map.nodes.length; i++) {
        const n = map.nodes[i];
        const start = Math.max(r.s, n.start);
        const end = Math.min(r.e, n.end);
        if (start >= end) continue;
        out.push({ node: map.nodeIndex[i], from: start - n.start, to: end - n.start });
    }
    return out;
}

/** 坐标段是否**完整**落在权威表内（跨节点也算完整）——用于校验后可施工判定。 */
export function canonSlotsComplete(map: CanonMap, r: CanonRange): boolean {
    let covered = 0;
    for (const slot of canonSlots(map, r)) covered += slot.to - slot.from;
    return covered === r.e - r.s && covered > 0;
}

/* ── clueRanges 对齐维护（D3：下标与 clues 严格对齐） ── */

/** 一题的线索坐标数组（下标与 `clues[qid]` 严格对齐；缺省=未升格）。 */
export type ClueRangeList = (CanonRange | undefined)[];

/**
 * 追加一条线索（文本数组与坐标数组**同下标**推进）。
 *
 * 存量线索未升格时把坐标数组补齐（补 `undefined` 占位）——**惰性升格**
 * （D3：仅用户再次操作该题线索时才持久化坐标）：新线索有坐标，旧线索位
 * 保持空，两者下标继续严格对齐。`ranges === undefined`（该题从未升格）
 * 表示调用方不落库坐标，只推进文本数组。
 */
export function pushClueRange(
    texts: string[],
    ranges: ClueRangeList | undefined,
    text: string,
    r: CanonRange | undefined
): void {
    if (ranges) while (ranges.length < texts.length) ranges.push(undefined);
    texts.push(text);
    if (ranges) ranges.push(r ? { s: r.s, e: r.e } : undefined);
}

/** 删除第 i 条：两数组同下标同步删（坐标缺失也不影响文本侧删除）。 */
export function removeClueRange(texts: string[], ranges: ClueRangeList | undefined, i: number): void {
    texts.splice(i, 1);
    if (!ranges) return;
    if (i >= 0 && i < ranges.length) ranges.splice(i, 1);
}
