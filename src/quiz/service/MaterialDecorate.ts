import { renderMdHtml } from "../../ui/MdRender";
import { collectGlossMarks, planGlossLinks, splitGlossBlock } from "../../convert/service/gloss/GlossEntry";
import type { GlossEntry, GlossHit } from "../../convert/service/gloss/GlossEntry";
import { markSlots, planMarks, type MarkPlan, type MarkSlot, type NodeRange } from "../flow/ClueMark";
import { SKIP_SELECTOR as MATCH_SKIP_SELECTOR, applyClueMarks } from "../flow/ClueMarkDom";
import {
    buildCanonMap,
    canonOffsetOf,
    canonRangeOf,
    canonSlots,
    remapCanon,
    verifyCanonSlice,
    type CanonMap,
    type CanonRange,
} from "./ClueCanon";
import { dataGlossTableHtml } from "./GlossDom";

/**
 * 材料/题干挂载的**唯一装饰出口**（Issue #52 附录 D4，三期收尾 Issue #53）：
 * 基础渲染 → 权威节点表 → 词形联动施工 → 轮间重算映射 → 线索 mark 施工。
 *
 * 施工顺序为何这么定（三期起是**实现保证**，不再是跨调用点的约定）：
 * - 词形联动（`<u>词</u>` + 序号上标）与权威坐标系的关系在「收集时按非
 *   权威区剔除」：序号上标不进权威表，而词形 `<u>` 内的文本节点**是**
 *   权威（`<u>` 包的就是原文本身，Issue #51）——于是权威串与装饰前渲染
 *   产物的可见文本逐字相等（验收：无词表材料逐字节不回归）。
 * - 线索 mark 施工前过 `remapCanon`（第 ④ 步）：词表施工 `splitText` 过
 *   节点、又插入了 `<u>`/`<sup>` 文本节点，必须以权威坐标为中介重建节点
 *   表，mark 才能跨 `**加粗**`/`<u>` 落格（嵌套支持的关键）。
 * - 有坐标且 `权威切片 === text` 校验过 ⇒ 按坐标落格；无坐标/校验失败 ⇒
 *   现行文本匹配（#51 修复版口径，**fallback 地基不得删除**）当次求坐标
 *   再落格；再失败 ⇒ 只出 chip（宁缺勿错）。
 *
 * **mark 对权威串是「透明」的**（关键不变量，别顺手改）：`mark.wengu-clue-mark`
 * 只是把既有正文包了一层、不注入任何字符，故它**不在**非权威表里；权威串
 * 因而跨「词表施工」与「线索施工」两轮恒定，坐标可反复用权威切片校验。
 * 把它误放进非权威表 ⇒ 被标过的字符从权威串消失 ⇒ 存量坐标校验必然失配
 * （静默全量降级）且坐标→节点映射整体错位（亮错位置）。
 *
 * **三期收拢产物（Issue #53）**：本文件只剩 ① 一次基础渲染（词表区 HTML
 * 与正文合成同一次 `innerHTML`）与 ②③④⑤ 四步施工。词表区的**数据**
 * （`@@G` 行 → 词条）在 `convert/service/gloss/GlossEntry`、**DOM 契约**
 * 在 `quiz/service/GlossDom`——本文件不再自带词表解析与 HTML 生成。
 */

/** 词形联动标记的元素类（幂等重铺先摘）。 */
const LINK_CLASS = "wengu-gloss-link";

/** 非权威区（剔除出权威坐标系，D1 名单）：词表区、词表联动上标、控件、
 *  选项区与答案解析区（与题干同容器）、公式占位。
 *
 *  ⚠️ **联动词形 `.wengu-gloss-link` 不在此表**（Issue #51）：它 `<u>` 包的
 *  就是原文本身，整片剔出会让「选段含联动词」整段锚点失败。
 *  ⚠️ 跳过口径 = 权威文本源口径：多写一个类 = 那几个字从权威串消失，
 *  存储坐标的校验随之失配——两侧（收集与落格）都别顺手加类。
 *  ⚠️ **线索 mark 不入本表**（它是既有正文的透明包装，见文件头）——
 *  这一条同时是「上标不包 mark」的结构保证之外的兜底：mark 进了权威表，
 *  重铺时它包住的字符坐标才对得上。
 *  ⚠️ 词表联动**序号上标**必须在此（D1 明列的「词表联动上标」）：它插在
 *  正文节点**之间**、内容又是原文没有的合成字符（`1·补`），留在权威串里
 *  会让「权威串 = 装饰前的可见文本」失真、坐标校验随之失配。 */
export const NON_CANON_SELECTOR =
    "ul.wengu-gloss, .wengu-gloss, .wengu-gloss-sup, script, style, button, .wengu-annobar, .wengu-clue-chip, .wengu-gclues, .wengu-opt-letter, .wengu-static-sol, .wengu-opts, .wengu-option-fallback, [data-type='inline-math'], [data-type='NodeMathBlock'], .render-node";

/** 落格守卫：序号上标与词表区——**不许被包 mark**（匹配源口径另见上）。 */
export const NO_WRAP_SELECTOR = ".wengu-gloss-sup, .wengu-gloss";

/** 嵌套抬升的目标：正文里联动词形的 `<u>`（D4「mark 在外层包住联动
 *  `<u>`」的施工对象）。 */
export const LIFT_SELECTOR = ".wengu-gloss-link > u";

/** 根内全部文本节点（按文档序）。 */
export function allTextNodes(root: HTMLElement): Text[] {
    const out: Text[] = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text);
    return out;
}

/** 文本节点是否属**权威**（非空 + 祖先不命中非权威跳表）。 */
function isCanonNode(n: Text): boolean {
    if (!n.nodeValue?.trim()) return false;
    const parent = n.parentElement;
    return !!parent && !parent.closest(NON_CANON_SELECTOR);
}

/** 文本节点是否属**匹配源**（fallback 文本匹配口径，= `ClueMarkDom.SKIP_SELECTOR`
 *  的补集）。与权威口径**不是一回事**：上标要参与匹配（只在落格时挡）、
 *  既有 mark 要跳过。两套判定别混用，也别把两者合并成一个名单。 */
function isMatchSourceNode(n: Text): boolean {
    if (!n.nodeValue?.trim()) return false;
    const parent = n.parentElement;
    return !!parent && !parent.closest(MATCH_SKIP_SELECTOR);
}

/** 按判定从文本节点表里挑下标（保序；单测覆盖）。 */
export function pickNodeIndexes(isKeep: boolean[]): number[] {
    const out: number[] = [];
    for (let i = 0; i < isKeep.length; i++) if (isKeep[i]) out.push(i);
    return out;
}

/** 建立权威坐标系（第 ② 步）：权威文本节点表 + 权威串拼接。 */
function buildCanon(root: HTMLElement): CanonMap {
    const all = allTextNodes(root);
    const picked = all.filter(isCanonNode);
    const index = new Map<Text, number>();
    all.forEach((n, i) => index.set(n, i));
    return buildCanonMap(
        picked.map((n) => n.nodeValue ?? ""),
        picked.map((n) => index.get(n) ?? -1)
    );
}

/** 从**当前** DOM 现场重算权威坐标系（口径与 decorate 第 ②/④ 步一致）。
 *
 *  **必须每次重算、不许缓存复用**：线索 mark 施工会 `splitText` 并插入
 *  新节点，任何「施工前算好存起来」的表，其 `nodeIndex` 在下一次操作时
 *  都已失效（表现为第二条线索坐标求错/求不出，静默降级）。重算是
 *  O(文本节点数) 的纯观测，只发生在用户动作上（新增线索/重铺高亮），
 *  高频渲染路径（decorate 内部）走的是当次算好的表。 */
export function canonMapOf(root: HTMLElement | undefined | null): CanonMap | undefined {
    return root ? buildCanon(root) : undefined;
}

/* ── 词表区渲染与正文词形联动（自 GlossDom 迁入，二期收口） ── */

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
    // `user-select:none` 见 english.scss（Issue #52 验收：选区行为与口径一致）
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
 *
 * Issue #53 起入参改为**已解析的词条表 + 记号表**（数据层由调用侧在装饰
 * 出口里一次性解析）——本文件不再自带 `@@G` 解析，`planGlossLinks` 的
 * 「偏移 → 节点内区间 → 倒序施工」口径逐字不变（行为零变化）。
 */
export function applyGlossLinks(root: HTMLElement, entries: GlossEntry[], marks: Map<string, string>): void {
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
    const hits = planGlossLinks(texts.join(""), entries, true, marks);
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
    for (const a of anchors) {
        const text = (a.text ?? "").trim();
        if (!text || seen.has(text)) {
            resolved.push({ text }); // 占位（下标对齐 anchors）
            continue;
        }
        seen.add(text);
        if (a.range && verifyCanonSlice(map, a.range, text)) {
            // 主路径：坐标校验通过 ⇒ 按坐标落格（D5）
            const hits = canonSlots(map, a.range).map((s) => ({ node: s.node, start: s.from, end: s.to }));
            plan.push({ text, hits, range: { s: a.range.s, e: a.range.e } });
            resolved.push({ text, range: { s: a.range.s, e: a.range.e } });
            continue;
        }
        // 降级（D6.2/6.3）：文本匹配（#51 修复版）当次求坐标，用完即弃
        const hits = toGlobal(planMarks(srcTexts, [text])[0]?.hits ?? []);
        const range = hitsToRange(map, hits);
        plan.push(range ? { text, hits, range } : { text, hits });
        resolved.push(range ? { text, range } : { text });
    }
    return { plan, resolved };
}

/**
 * 落格（施工序由 markSlots 给出：节点升序 + 节点内起点降序）。
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
 */
function applySlots(all: Text[], slots: MarkSlot[]): void {
    for (const slot of slots) {
        const node = all[slot.node];
        if (!node?.isConnected) continue;
        if (node.parentElement?.closest(NO_WRAP_SELECTOR)) continue; // 落格守卫
        const u = liftTarget(node, slot.start, slot.end);
        if (u) wrapElement(u);
        else wrapRange(node, slot.start, slot.end);
    }
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
function wrapElement(el: HTMLElement): void {
    if (el.closest("mark.wengu-clue-mark")) return; // 已包过（幂等）
    const parent = el.parentNode;
    if (!parent) return;
    const mark = document.createElement("mark");
    mark.className = "wengu-clue-mark";
    parent.replaceChild(mark, el);
    mark.appendChild(el);
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
function applyClues(root: HTMLElement, map: CanonMap, anchors: ClueAnchor[]): ClueResolved[] {
    const { all, srcIndexes, texts } = observe(root);
    if (anchors.length === 0) return [];
    const { plan, resolved } = planClueMarks(map, texts, anchors, srcIndexes);
    applySlots(all, markSlots(plan));
    return resolved;
}

/**
 * 装饰出口（材料/题干挂载**唯一**入口，Issue #53 起**只认数据**）：
 * ① 基础渲染 → ② 权威节点表 → ③ 词形联动 → ④ 轮间重算映射 → ⑤ 线索
 * mark 按坐标施工。
 *
 * 入参口径（三期收敛）：
 * - `md` 是**材料正文原文**（含尾部 `@@G` 词表行）——本出口自己按契约拆
 *   正文/词表、自己渲染词表区（`dataGlossTableHtml`），消费侧不再需要
 *   先铺一遍词表区（两段调用已成一段）；
 * - `gloss: false` = 题干通道（正文不含词表，也**不做**词形联动）；
 * - `clues`（存储锚点：文本 + 可选权威坐标）**一次性走完 ⑤**——组题材料
 *   面板的「重开页签/组内切题回来」据此一步到位。
 *
 * 渲染**顺序是这里的实现保证**（不再是「材料填充后」「词表后处理 → 线索
 * 后处理」的跨调用点约定）：词表区与词形联动必在 ② 之后、⑤ 之前。
 * 幂等（整段重铺 + 先摘旧 mark）。返回本帧解析出的坐标（惰性升格用；
 * **渲染不回写**，D3）。
 */
export function decorate(
    root: HTMLElement | undefined | null,
    data: { md?: string; gloss?: boolean; clues?: ClueAnchor[] }
): ClueResolved[] {
    if (!root) return [];
    const { body, entries } = splitGlossBlock(data.md ?? "");
    const withGloss = entries.length > 0 && data.gloss !== false;
    // ① 基础渲染（现状 renderMdHtml 同款）+ 词表区（非权威，不进权威表）
    //    ——词表区与正文合成**一次** innerHTML，产物与「先渲染正文、再补
    //    词表区」逐字节一致（后者是本出口改造前的两步写法）
    root.innerHTML = renderMdHtml(body) + (withGloss ? dataGlossTableHtml(entries) : "");
    // ② 权威节点表（装饰施工前口径）
    const pre = buildCanon(root);
    // ③ 词形联动施工（材料；题干无词表）——记号表随之一次性采集
    if (withGloss) applyGlossLinks(root, entries, collectGlossMarks(data.md ?? ""));
    // ④ 轮间重算映射：词表施工已 splitText/插入过节点，以权威坐标为中介
    //    重建节点表（⇒ ⑤ 的坐标施工只落在权威文本上、mark 可跨 <u>）
    const nodes = allTextNodes(root);
    const map = remapCanon(
        pre,
        nodes.map((n) => n.nodeValue ?? ""),
        nodes.map(isCanonNode)
    );
    // ⑤ 线索 mark 施工（刚 innerHTML 过、本无旧 mark；摘一次作幂等保险）
    clearClueMarks(root);
    return applyClues(root, map, data.clues ?? []);
}

/** 只重铺高亮（不改材料正文）：chips 删除/新增线索后调用，幂等。
 *
 *  ⚠️ **顺序不可换**：先`clearClueMarks`再建表——摘旧 mark 会还原/合并
 *  文本节点，先建的表其 `nodeIndex` 当场作废（换错位 = 亮错位置）。
 *
 *  **降级链**（D6）：无权威坐标系的**遗留根**（外部挂载的旧壳）退回
 *  `ClueMarkDom.applyClueMarks` 的文本匹配口径——#51 修复版是
 *  「坐标缺失/漂移」时的地基，**不得删除**。 */
export function redecorateCluesPath(root: HTMLElement | undefined | null, anchors: ClueAnchor[]): ClueResolved[] {
    if (!root) return [];
    clearClueMarks(root);
    const map = canonMapOf(root);
    if (!map) {
        applyClueMarks(
            root,
            anchors.map((a) => a.text)
        );
        return [];
    }
    return applyClues(root, map, anchors);
}

/**
 * 选段 → 权威坐标（D2 主路径，浮条 pointerdown 时 Range 还活着）。把
 * Range 两端按根内**当前**文本节点表换算：端点在表内取精确偏移，落在
 * 非权威区（词表区/上标/选项/解析/公式占位）钳到最近权威边界，钳不出
 * （无表/区间退化）返回 undefined ⇒ 调用侧只存文本（降级链 D6）。
 */
export function resolveRangeAnchor(root: HTMLElement | undefined | null, range: Range): CanonRange | undefined {
    if (!root) return undefined;
    const map = canonMapOf(root);
    if (!map) return undefined;
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

/* ── 对外数据层入口（Issue #53 三期收拢：消费侧只喂数据、不碰 DOM 步骤） ── */

/**
 * 装饰出口（**数据层入口**，业务侧一律走它）：入参是材料正文原文（含
 * `@@G` 词表行）与线索锚点，模块内部按 ①~⑤ 编排——词表解析、词表区渲染、
 * 词形联动、轮间重算映射、线索坐标施工全部收口，**挂载顺序从调用侧约定
 * 变成实现保证**（材料填充 + 线索刷新两段调用已成一段）。
 *
 * 实现是同文件的 `decorate`（施工编排）；本函数是它**加名**的数据层
 * 门面——业务侧只认「喂材料正文 + 线索」这一件事。
 */
export function decorateMaterialEntry(
    root: HTMLElement | undefined | null,
    data: { md?: string; gloss?: boolean; clues?: ClueAnchor[] }
): ClueResolved[] {
    return decorate(root, data);
}

/** 只重铺高亮（不改材料正文）的数据层入口：chips 删除/新增线索后调用。 */
export function redecorateClues(root: HTMLElement | undefined | null, anchors: ClueAnchor[]): ClueResolved[] {
    return redecorateCluesPath(root, anchors);
}
