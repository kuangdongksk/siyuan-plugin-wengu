/**
 * 线索 mark 的**施工层**（自 MaterialDecorate 拆出压 500 行红线，
 * Issue #57）：施工计划（坐标优先 → 文本匹配 → 只出 chip）、落格
 * （含嵌套抬升与选色内联样式）、摘 mark。
 *
 * `MaterialDecorate` 是**调用方**（装饰出口 ①~⑤ 编排里 ⑤ 就调这里），
 * 本文件不做渲染/词表/坐标系的建立——那些各归其位（`decorate` 与
 * `ClueCanon`）。拆出的只是「拿现成的权威坐标系 + 锚点 → 落 mark」。
 *
 * 口径与拆分前逐字一致（对外门面经 MaterialDecorate 转出，调用侧零改动）：
 * 观测（节点表/名单）走 `CanonDom`，不反向 import 装饰编排层（防循环）：
 * - `wrapRange` / `wrapElement` 的越界守卫、抬升目标、落格守卫全保留；
 * - `mergeMarkSlots` 合并后再施工（Issue #56）——只修 fallback 等于
 *   用户主路径带病，两条链都过这一步；
 * - 选色（Issue #57）：按 slot 的线索引查色号写**内联** style（主题
 *   卡片色变量），无索引/越界 ⇒ 默认黄；主题变量不可用 ⇒ 不写 style
 *   （落回 scss 默认，见 `ClueColor.clueColorStyle`）。
 */
import { markSlots, mergeMarkSlots, planMarks, type MarkPlan, type MarkSlot, type NodeRange } from "../flow/ClueMark";
import { clueColorStyle, DEFAULT_CLUE_COLOR } from "../flow/ClueColor";
import { canonOffsetOf, canonSlots, verifyCanonSlice, type CanonMap, type CanonRange } from "./ClueCanon";
import { allTextNodes, isMatchSourceNode, LIFT_SELECTOR, NO_WRAP_SELECTOR, pickNodeIndexes } from "./CanonDom";

/** 一条线索的施工输入：存储文本 + 可选坐标（`clueRanges` 平行字段）
 *  + 可选色号（`clueColors` 平行字段，Issue #57：`-1`/缺省 = 默认黄）。 */
export interface ClueAnchor {
    text: string;
    range?: CanonRange;
    /** 该条线索的色号（`ClueColor` 值域；缺省/越界 ⇒ 默认黄）。 */
    color?: number;
}

/** 施工结果：本帧每条线索实际解析出的坐标（与入参 `anchors` 逐位对齐；
 *  惰性升格按 `clues` 下标写回用，**渲染自身不回写**，D3）。 */
export interface ClueResolved {
    text: string;
    range?: CanonRange;
}

/** 文本匹配命中的节点区间 → 权威坐标（求不到即 undefined，仍按文本落格）。 */
function hitsToRange(map: CanonMap, hits: NodeRange[]): CanonRange | undefined {
    if (hits.length === 0) return undefined;
    const first = hits[0];
    const last = hits[hits.length - 1];
    const s = canonOffsetOf(map, first.node, first.start);
    const e = canonOffsetOf(map, last.node, last.end);
    if (s === null || e === null || e <= s) return undefined;
    return { s, e };
}

/** 一条线索的施工计划（`hits` 的节点下标是**全局**口径，与 `all` 对齐）。 */
export interface CluePlanItem extends MarkPlan {
    /** 本帧解析出的权威坐标（无 = 只出 chip）。 */
    range?: CanonRange;
    /** 该条线索的色号（Issue #57；缺省 = 默认黄）。 */
    color?: number;
}

/**
 * 逐条算施工计划（坐标优先 → 文本匹配 → 只出 chip）。
 *
 * 参数 `all` = **全部**文本节点原文（构造施工用），`srcIndexes` = 这些
 * 节点里**属匹配源**的下标（升序，可选；缺省=全部节点都算匹配源）。
 * 分开是因为两条通道口径本就不同（权威表剔除上标、匹配源保留上标），
 * 且 fallback 命中必须能换回**全局**下标才能同时喂给「构造施工」与
 * 「坐标回算」——`hitsToRange` 查的是 `map.nodeIndex`（全局口径）。
 *
 * 两个返回值**下标语义不同，别混用**：
 * - `plan` 只含真需施工的条目（去重/空文本跳过）——同一线索文本重复出现
 *   时重复落格会把 mark 嵌套进 mark；
 * - `resolved` 与入参 `anchors` **逐位对齐**（跳过的位也占空）——惰性
 *   升格要按 `clues` 的下标写回坐标，错位即写错线索。
 */
export function planClueMarks(
    map: CanonMap,
    all: string[],
    anchors: ClueAnchor[],
    srcIndexes?: number[]
): { plan: CluePlanItem[]; resolved: ClueResolved[] } {
    const src = srcIndexes ?? all.map((_, i) => i);
    const srcTexts = src.map((i) => all[i] ?? "");
    // fallback 命中（局部下标）→ 全局下标：planMarks 与 applySlots 共用一份
    const toGlobal = (hits: NodeRange[]): NodeRange[] =>
        hits.map((h) => ({ node: src[h.node] ?? -1, start: h.start, end: h.end }));
    const plan: CluePlanItem[] = [];
    const resolved: ClueResolved[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        const text = (a.text ?? "").trim();
        const color = a.color ?? DEFAULT_CLUE_COLOR;
        if (!text || seen.has(text)) {
            resolved.push({ text }); // 占位（下标对齐 anchors）
            continue;
        }
        seen.add(text);
        // `clue` 记**锚点数组下标**（选色归属按它查 `clueColors`，不能按
        // `text` 反查——同一文本可能在数组里出现多次）
        if (a.range && verifyCanonSlice(map, a.range, text)) {
            // 主路径：坐标校验通过 ⇒ 按坐标落格（D5）
            const hits = canonSlots(map, a.range).map((s) => ({ node: s.node, start: s.from, end: s.to }));
            plan.push({ text, hits, range: { s: a.range.s, e: a.range.e }, clue: i, color });
            resolved.push({ text, range: { s: a.range.s, e: a.range.e } });
            continue;
        }
        // 降级（D6.2/6.3）：文本匹配（#51 修复版）当次求坐标，用完即弃
        const hits = toGlobal(planMarks(srcTexts, [text])[0]?.hits ?? []);
        const range = hitsToRange(map, hits);
        plan.push(range ? { text, hits, range, clue: i, color } : { text, hits, clue: i, color });
        resolved.push(range ? { text, range } : { text });
    }
    return { plan, resolved };
}

/**
 * 落格（施工序由 `markSlots` 给出：节点升序 + 节点内起点降序；排序前过
 * `mergeMarkSlots` 合并重叠区间，Issue #56）。
 *
 * **嵌套抬升**（D4 显式定义）：当一处坐标**恰好完整覆盖**某个联动词形的
 * `<u>` 时，mark 包 **`<u>` 元素本身**（mark=用户语义层在外、`<u>`=内容层
 * 在内），而不是 `<u>` 里的文本节点——序号上标是 `<u>` 的**兄弟且属非
 * 权威区**（权威表里没有它），于是「mark 包住联动 `<u>`、上标不包 mark」
 * （验收 1）在结构上同时成立。
 *
 * 抬升必须配 `clearClueMarks` 的**无损还原**（那里按子节点搬出、而非用
 * `textContent` 重建）——否则重铺时被抬升的 `<u>` 会被拍平成纯文本，
 * 词形联动标记永久丢失。
 *
 * **选色（Issue #57）**：每个 slot 按 `clue` 线索引查 `colors` 拿到色号，
 * 写**内联** `style="background-color:var(--b3-card-*);color:var(--b3-card-*-color)"`
 * ——色值一律走主题变量，明暗/第三方主题实时适配。段无归属索引（缺省
 * `-1`）或色号越界 ⇒ 默认黄；合并段已由 `mergeMarkSlots` 取「最长那条」
 * 的索引，故颜色与 chips 视觉主从一致。
 */
function applySlots(all: Text[], slots: MarkSlot[], colors?: ReadonlyMap<number, number>): void {
    for (const slot of slots) {
        const node = all[slot.node];
        if (!node?.isConnected) continue;
        if (node.parentElement?.closest(NO_WRAP_SELECTOR)) continue; // 落格守卫
        const style = clueColorStyle(slot.clue === undefined ? undefined : colors?.get(slot.clue));
        const u = liftTarget(node, slot.start, slot.end);
        if (u) wrapElement(u, style);
        else wrapRange(node, slot.start, slot.end, style);
    }
}

/** 线索引 → 色号表（选色归属的查表口径：仅在场线索建表，缺位即默认黄）。 */
export function colorMapOf(plan: readonly CluePlanItem[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const p of plan) {
        if (p.clue !== undefined && p.clue >= 0) out.set(p.clue, p.color ?? DEFAULT_CLUE_COLOR);
    }
    return out;
}

/** 该区间是否「完整覆盖一个联动词形 `<u>`」（纯判定，单测覆盖）。 */
export function isLiftSpan(coversWholeNode: boolean, isGlossU: boolean): boolean {
    return coversWholeNode && isGlossU;
}

/** 抬升目标：区间覆盖整个节点、且该节点的父元素正是联动词形 `<u>`。 */
function liftTarget(node: Text, start: number, end: number): HTMLElement | null {
    const text = node.nodeValue ?? "";
    const parent = node.parentElement;
    return isLiftSpan(start === 0 && end === text.length, !!parent?.matches(LIFT_SELECTOR)) ? parent : null;
}

/** 把元素包进 mark（抬升路径：mark 在外层，见 LIFT_SELECTOR）。 */
function wrapElement(el: HTMLElement, style?: string): void {
    if (el.closest("mark.wengu-clue-mark")) return; // 已包过（幂等）
    const parent = el.parentNode;
    if (!parent) return;
    const mark = document.createElement("mark");
    mark.className = "wengu-clue-mark";
    if (style) mark.setAttribute("style", style);
    parent.replaceChild(mark, el);
    mark.appendChild(el);
}

/** 把一段文本节点区间包进 mark（先切后包，区间越界即跳过）。 */
function wrapRange(node: Text, start: number, end: number, style?: string): void {
    const text = node.nodeValue ?? "";
    if (start < 0 || end > text.length || start >= end) return;
    const target = node.splitText(start);
    target.splitText(end - start);
    const mark = document.createElement("mark");
    mark.className = "wengu-clue-mark";
    if (style) mark.setAttribute("style", style);
    target.parentNode?.replaceChild(mark, target);
    mark.appendChild(target);
}

/**
 * 摘掉某根内全部高亮 mark（幂等重铺先摘）。
 *
 * **按子节点原样搬出、不用 `textContent` 重建**（无损还原）：mark 里可能
 * 包着的是**元素**（抬升路径的联动词形 `<u>`，见 LIFT_SELECTOR），用
 * textContent 重建会把它拍平成纯文本、词形联动标记永久丢失。纯文本 mark
 * 走同一条路也没问题——搬出的文本节点由末尾 `normalize()` 合并回原状。
 */
export function clearClueMarks(root: HTMLElement): void {
    for (const m of Array.from(root.querySelectorAll<HTMLElement>("mark.wengu-clue-mark"))) {
        m.replaceWith(...Array.from(m.childNodes));
    }
    root.normalize();
}

/** 当前 DOM 口径的两套节点表（全局文本节点 + 匹配源下标）。 */
function observe(root: HTMLElement): { all: Text[]; srcIndexes: number[]; texts: string[] } {
    const all = allTextNodes(root);
    const srcIndexes = pickNodeIndexes(all.map(isMatchSourceNode));
    return { all, srcIndexes, texts: all.map((n) => n.nodeValue ?? "") };
}

/**
 * 施工线索 mark（**调用侧保证**：旧 mark 已摘、`map` 与当前节点表同口径）。
 *
 * ⚠️ `map` 的 `nodeIndex` 必须与刚观测出的 `all` 对齐——线索 mark 会
 * `splitText` 并插节点，任何**跨操作复用**的旧表都已失效（`canonMapOf`
 * 因此每次现场重算）。
 */
export function applyClues(root: HTMLElement, map: CanonMap, anchors: ClueAnchor[]): ClueResolved[] {
    const { all, srcIndexes, texts } = observe(root);
    if (anchors.length === 0) return [];
    const { plan, resolved } = planClueMarks(map, texts, anchors, srcIndexes);
    applySlots(all, mergeMarkSlots(markSlots(plan)), colorMapOf(plan));
    return resolved;
}
