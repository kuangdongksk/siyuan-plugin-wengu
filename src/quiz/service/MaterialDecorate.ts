import { renderMdHtml } from "../../ui/MdRender";
import { esc } from "../../ui/shared";
import { collectGlossMarks, planGlossLinks, splitGlossBlock } from "../../convert/service/gloss/GlossEntry";
import type { GlossEntry, GlossHit } from "../../convert/service/gloss/GlossEntry";
import { markSlots, planMarks, type MarkPlan, type MarkSlot, type NodeRange } from "../flow/ClueMark";
import {
    buildCanonMap,
    canonRangeOf,
    canonSlots,
    canonSlotsComplete,
    remapCanon,
    type CanonMap,
    type CanonRange,
} from "./ClueCanon";

/**
 * 材料/题干挂载的**唯一装饰出口**（Issue #52 附录 D4）：基础渲染 → 权威
 * 节点表 → 词形联动施工 → 轮间重算映射 → 线索 mark 施工。
 *
 * 施工顺序为何这么定：
 * - 词形联动（`<u>词</u>` + 序号上标）与权威坐标系的关系在「收集时按非
 *   权威区剔除」：序号上标不进权威表，而词形 `<u>` 内的文本节点**是**
 *   权威（`<u>` 包的就是原文本身，Issue #51）——于是权威串与装饰前渲染
 *   产物的可见文本逐字相等（验收 5：无词表材料逐字节不回归）。
 * - 线索 mark 施工前过 `remapCanon`（第 ④ 步）：词表施工 `splitText` 过
 *   节点、又插入了 `<u>`/`<sup>` 文本节点，必须以权威坐标为中介重建节点
 *   表，mark 才能跨 `**加粗**`/`<u>` 落格（嵌套支持的关键，二期即支持）。
 * - 有坐标且 `权威切片 === text` 校验过 ⇒ 按坐标落格；无坐标/校验失败 ⇒
 *   现行文本匹配（#51 修复版口径，**fallback 地基不得删除**）当次求坐标
 *   再落格；再失败 ⇒ 只出 chip（宁缺勿错）。
 */

/** 词形联动标记的元素类（幂等重铺先摘）。 */
const LINK_CLASS = "wengu-gloss-link";

/** 非权威区（剔除出权威坐标系，D1 名单）：词表区、回答区之外的控件、
 *  选项区与答案解析区（与题干同容器）、公式占位。
 *
 *  ⚠️ **联动词形 `.wengu-gloss-link` 不在此表**（Issue #51）：它 `<u>` 包的
 *  就是原文本身，整片剔出会让「选段含联动词」整段锚点失败。
 *  ⚠️ 跳过口径 = 权威文本源口径：多写一个类 = 那几个字从权威串消失，
 *  存储坐标的校验随之失配——两侧（收集与落格）都别顺手加类。
 *  ⚠️ 词表联动**序号上标** `.wengu-gloss-sup` 不在收集跳表里：它在词表区
 *  内时已被整片排除，词表区外的同类上标由落格守卫 `NO_WRAP_SELECTOR` 挡
 *  （**落格守卫只管「谁不许被包」**，不进匹配源）。 */
export const NON_CANON_SELECTOR =
    "ul.wengu-gloss, .wengu-gloss, script, style, mark, button, .wengu-annobar, .wengu-clue-chip, .wengu-gclues, .wengu-opt-letter, .wengu-static-sol, .wengu-opts, .wengu-option-fallback, [data-type='inline-math'], [data-type='NodeMathBlock'], .render-node";

/** 落格守卫：序号上标与词表区——**不许被包 mark**（匹配源口径另见上）。 */
export const NO_WRAP_SELECTOR = ".wengu-gloss-sup, .wengu-gloss";

/** 词表区渲染：`@@G` 行的规范 DOM（`ul.wengu-gloss`）。 */
export function glossTableHtml(entries: GlossEntry[]): string {
    if (entries.length === 0) return "";
    const items = entries
        .map((e) => {
            const word = `<span class="wengu-gloss-word">${esc(e.word)}</span>`;
            const ph = e.phonetic ? `<span class="wengu-gloss-ph">${esc(e.phonetic)}</span>` : "";
            const mn = e.meaning ? `<span class="wengu-gloss-mn">${esc(e.meaning)}</span>` : "";
            return `<li class="wengu-gloss-item">${word}${ph}${mn}</li>`;
        })
        .join("");
    return `<ul class="wengu-gloss" data-gloss>${items}</ul>`;
}

/** 本模块持有的权威坐标系（按根元素；重铺时重建，见 decorateMaterial）。
 *  WeakMap：根元素被整壳重建后自然回收，不跨渲染残留。 */
const canonMaps = new WeakMap<HTMLElement, CanonMap>();

/** 取某根当前的权威坐标系（标注求锚点用；未装饰过则 undefined）。 */
export function canonMapOf(root: HTMLElement | undefined | null): CanonMap | undefined {
    return root ? canonMaps.get(root) : undefined;
}

/** 根内全部文本节点（按文档序）。 */
export function allTextNodes(root: HTMLElement): Text[] {
    const out: Text[] = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text);
    return out;
}

/** 某文本节点是否属权威（非空 + 祖先不命中非权威跳表）。 */
function isCanonNode(n: Text): boolean {
    if (!n.nodeValue?.trim()) return false;
    const parent = n.parentElement;
    return !!parent && !parent.closest(NON_CANON_SELECTOR);
}

/** 建立权威坐标系（第 ② 步）：文本节点表 + 权威串拼接。 */
function buildCanon(root: HTMLElement): { map: CanonMap; all: Text[] } {
    const all = allTextNodes(root);
    const index = new Map<Text, number>();
    all.forEach((n, i) => index.set(n, i));
    const picked = all.filter(isCanonNode);
    const map = buildCanonMap(
        picked.map((n) => n.nodeValue ?? ""),
        picked.map((n) => index.get(n) ?? -1)
    );
    return { map, all };
}

/* ── 词表区渲染与正文词形联动（自 GlossDom 迁入，二期收口） ── */

/** 摘掉旧联动标记（还原纯文本节点）。 */
export function clearGlossLinks(root: HTMLElement): void {
    for (const span of Array.from(root.querySelectorAll<HTMLElement>(`.${LINK_CLASS}`))) {
        const parent = span.parentNode;
        if (!parent) continue;
        parent.replaceChild(document.createTextNode(span.textContent ?? ""), span);
        parent.normalize();
    }
}

/** 把一处命中的词形包进联动标记。 */
export function wrapHit(node: Text, from: number, to: number, hit: GlossHit): void {
    if (!node.isConnected) return;
    const text = node.nodeValue ?? "";
    if (from < 0 || to > text.length || from >= to) return;
    const target = node.splitText(from);
    target.splitText(to - from);
    const span = document.createElement("span");
    span.className = LINK_CLASS;
    span.dataset.glossOrder = String(hit.order);
    const u = document.createElement("u");
    u.textContent = target.nodeValue ?? "";
    span.appendChild(u);
    // 序号上标（原文 `^{...}` 记号语义的等价呈现；有记号则带记号）。
    // `user-select:none` 见 english.scss（issue #52 验收：选区行为与口径一致）
    const sup = document.createElement("sup");
    sup.className = "wengu-gloss-sup";
    sup.textContent = hit.mark ? `${hit.order}·${hit.mark}` : String(hit.order);
    span.appendChild(sup);
    target.parentNode?.replaceChild(span, target);
}

/**
 * 词形联动施工（第 ③ 步，照搬 GlossDom 现行 planGlossLinks/assignHitsToNodes
 * 口径）：按「全部文本节点原文拼接」的偏移算命中，映射回节点内区间后
 * **倒序**施工——正向施工会把同一节点内的后一处命中推出已被截短的节点。
 */
export function applyGlossLinks(root: HTMLElement, materialMd: string): void {
    const entries = splitGlossBlock(materialMd).entries;
    if (entries.length === 0) return;
    const nodes = allTextNodes(root).filter((n) => {
        if (!n.nodeValue?.trim()) return false;
        const parent = n.parentElement;
        // 词形匹配源：跳过线索 mark / 脚本 / 词表自身（GlossDom 旧口径照搬）
        return !!parent && !parent.closest("mark.wengu-clue-mark, script, style, .wengu-gloss");
    });
    if (nodes.length === 0) return;
    const texts = nodes.map((n) => n.nodeValue ?? "");
    const starts: number[] = [];
    let acc = 0;
    for (const t of texts) {
        starts.push(acc);
        acc += t.length;
    }
    const hits = planGlossLinks(texts.join(""), entries, true, collectGlossMarks(materialMd));
    if (hits.length === 0) return;
    const slots = assignHitsToNodes(texts, starts, hits);
    for (let i = hits.length - 1; i >= 0; i--) {
        const slot = slots[i];
        if (slot.node < 0) continue; // 跨节点命中：放弃（宁缺勿错）
        wrapHit(nodes[slot.node], slot.from, slot.to, hits[i]);
    }
}

/** 命中 → 节点下标 + 节点内区间（自 GlossDom 迁入；纯函数口径不变）。 */
export interface GlossSlot {
    node: number;
    from: number;
    to: number;
}

export function assignHitsToNodes(nodeTexts: string[], nodeStarts: number[], hits: GlossHit[]): GlossSlot[] {
    return hits.map((hit) => {
        for (let i = 0; i < nodeTexts.length; i++) {
            const s = nodeStarts[i];
            const text = nodeTexts[i] ?? "";
            if (hit.start >= s && hit.end <= s + text.length) {
                return { node: i, from: hit.start - s, to: hit.end - s };
            }
        }
        return { node: -1, from: 0, to: 0 };
    });
}

/* ── 线索 mark 施工（按坐标优先，降级文本匹配） ── */

/** 一条线索的施工输入：存储文本 + 可选坐标（`clueRanges` 平行字段）。 */
export interface ClueAnchor {
    text: string;
    range?: CanonRange;
}

/** 施工结果：本帧每条线索实际解析出的坐标（惰性升格用；渲染不回写）。 */
export interface ClueResolved {
    text: string;
    range?: CanonRange;
}

/** 权威表 → 当前节点表文本数组（fallback 文本匹配源按节点下标对齐）。 */
function nodeTextsOf(all: Text[]): string[] {
    return all.map((n) => n.nodeValue ?? "");
}

/** 文本匹配命中的节点区间 → 权威坐标（求不到即 undefined，仍按文本落格）。 */
function hitsToRange(map: CanonMap, hits: NodeRange[]): CanonRange | undefined {
    if (hits.length === 0) return undefined;
    const first = hits[0];
    const last = hits[hits.length - 1];
    const s = canonOffset(map, first.node, first.start);
    const e = canonOffset(map, last.node, last.end);
    if (s === null || e === null || e <= s) return undefined;
    return { s, e };
}

function canonOffset(map: CanonMap, node: number, inNode: number): number | null {
    const at = map.nodeIndex.indexOf(node);
    const n = at >= 0 ? map.nodes[at] : undefined;
    return n ? n.start + inNode : null;
}

/** 逐条算施工计划（坐标优先 → 文本匹配 → 只出 chip）。 */
export function planClueMarks(
    map: CanonMap,
    all: string[],
    anchors: ClueAnchor[]
): { plan: MarkPlan[]; resolved: ClueResolved[] } {
    const texts = all;
    const plan: MarkPlan[] = [];
    const resolved: ClueResolved[] = [];
    const seen = new Set<string>();
    for (const a of anchors) {
        const text = (a.text ?? "").trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        if (a.range && canonSlotsComplete(map, a.range) && map.text.slice(a.range.s, a.range.e) === text) {
            // 主路径：坐标校验通过 ⇒ 按坐标落格（D5）
            const hits = canonSlots(map, a.range).map((s) => ({ node: s.node, start: s.from, end: s.to }));
            plan.push({ text, hits });
            resolved.push({ text, range: { s: a.range.s, e: a.range.e } });
            continue;
        }
        // 降级（D6.2/6.3）：文本匹配（#51 修复版）当次求坐标，用完即弃
        const hits = planMarks(texts, [text])[0]?.hits ?? [];
        plan.push({ text, hits });
        const range = hitsToRange(map, hits);
        resolved.push(range ? { text, range } : { text });
    }
    return { plan, resolved };
}

/** 落格（施工序由 markSlots 给出：节点升序 + 节点内起点降序）。 */
function applySlots(all: Text[], slots: MarkSlot[]): void {
    for (const slot of slots) {
        const node = all[slot.node];
        if (!node?.isConnected) continue;
        if (node.parentElement?.closest(NO_WRAP_SELECTOR)) continue; // 落格守卫
        wrapRange(node, slot.start, slot.end);
    }
}

/** 把一段文本节点区间包进 mark（先切后包，区间越界即跳过）。 */
function wrapRange(node: Text, start: number, end: number): void {
    const text = node.nodeValue ?? "";
    if (start < 0 || end > text.length || start >= end) return;
    const target = node.splitText(start);
    target.splitText(end - start);
    const mark = document.createElement("mark");
    mark.className = "wengu-clue-mark";
    target.parentNode?.replaceChild(mark, target);
    mark.appendChild(target);
}

/** 摘掉某根内全部高亮 mark（还原原文本节点；幂等重铺先摘）。 */
export function clearClueMarks(root: HTMLElement): void {
    for (const m of Array.from(root.querySelectorAll<HTMLElement>("mark.wengu-clue-mark"))) {
        const parent = m.parentNode;
        if (!parent) continue;
        parent.replaceChild(document.createTextNode(m.textContent ?? ""), m);
        parent.normalize();
    }
}

/**
 * 装饰出口（材料/题干挂载**唯一**入口）：① 基础渲染 → ② 权威节点表 →
 * ③ 词形联动 → ④ 轮间重算映射 → ⑤ 线索 mark 按坐标施工。
 *
 * 输入 `clues`（存储锚点：文本 + 可选权威坐标）**一次性走完 ⑤**——组题
 * 材料面板的「重开页签/组内切题回来」据此一步到位；只重铺高亮（不动正文）
 * 的场景走 `redecorateClues`（同一条施工链，禁复制第二份）。
 * 幂等（整段重铺 + 先摘旧 mark）。返回本帧解析出的坐标（惰性升格用；
 * **渲染不回写**，D3）。
 */
export function decorateMaterial(
    root: HTMLElement | undefined | null,
    opts: { md?: string; gloss?: boolean; clues?: ClueAnchor[] }
): ClueResolved[] {
    if (!root) return [];
    const md = opts.md ?? "";
    const { body, entries } = splitGlossBlock(md);
    // ① 基础渲染（现状 renderMdHtml 同款）+ 词表区
    root.innerHTML = renderMdHtml(body) + (opts.gloss === false ? "" : glossTableHtml(entries));
    // ② 权威节点表（装饰施工前口径）
    const canon = buildCanon(root);
    // ③ 词形联动施工（材料；题干无词表）
    if (entries.length > 0 && opts.gloss !== false) applyGlossLinks(root, md);
    // ④ 轮间重算映射：词表施工已改变节点表，以权威坐标为中介重建
    const all = allTextNodes(root);
    const map = remapCanon(canon.map, nodeTextsOf(all), all.map(isCanonNode));
    canonMaps.set(root, map);
    // ⑤ 线索 mark 施工（幂等：先摘旧 mark 再重铺）
    clearClueMarks(root);
    const anchors = opts.clues ?? [];
    if (anchors.length === 0) return [];
    const nodes = allTextNodes(root);
    const { plan, resolved } = planClueMarks(map, nodeTextsOf(nodes), anchors);
    applySlots(nodes, markSlots(plan));
    return resolved;
}

/** 只重铺高亮（不改材料正文）：chips 删除/新增线索后调用，幂等。 */
export function redecorateClues(root: HTMLElement | undefined | null, anchors: ClueAnchor[]): ClueResolved[] {
    if (!root) return [];
    const map = canonMaps.get(root);
    clearClueMarks(root);
    if (!map || anchors.length === 0) return [];
    const nodes = allTextNodes(root);
    const { plan, resolved } = planClueMarks(map, nodeTextsOf(nodes), anchors);
    applySlots(nodes, markSlots(plan));
    return resolved;
}

/**
 * 选段 → 权威坐标（D2 主路径，浮条 pointerdown 时 Range 还活着）。把
 * Range 两端按根内**当前**文本节点表换算：端点在表内取精确偏移，落在
 * 非权威区（词表区/上标/选项/解析/公式占位）钳到最近权威边界，钳不出
 * （无表/区间退化）返回 undefined ⇒ 调用侧只存文本（降级链 D6）。
 */
export function resolveRangeAnchor(root: HTMLElement | undefined | null, range: Range): CanonRange | undefined {
    const map = ensureCanonMap(root);
    if (!map || !root) return undefined;
    const nodes = allTextNodes(root);
    const pick = (node: Node | null, offset: number): { nodeIndex: number; offset: number } | undefined => {
        const i = node instanceof Text ? nodes.indexOf(node) : -1;
        return i < 0 ? undefined : { nodeIndex: i, offset };
    };
    const a = pick(range.startContainer, range.startOffset);
    const b = pick(range.endContainer, range.endOffset);
    if (!a || !b) return undefined;
    return canonRangeOf(map, a, b) ?? undefined;
}

/** 未装饰过的根（如从外部挂载的题干）：现场建表（坐标口径与 decorate 同）。 */
export function ensureCanonMap(root: HTMLElement | undefined | null): CanonMap | undefined {
    if (!root) return undefined;
    const hit = canonMaps.get(root);
    if (hit) return hit;
    const canon = buildCanon(root);
    const all = allTextNodes(root);
    const map = remapCanon(canon.map, nodeTextsOf(all), all.map(isCanonNode));
    canonMaps.set(root, map);
    return map;
}
