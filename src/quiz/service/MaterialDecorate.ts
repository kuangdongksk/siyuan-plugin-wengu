import { renderMdHtml } from "../../ui/MdRender";
import { collectGlossMarks, planGlossLinks, splitGlossBlock } from "../../convert/service/gloss/GlossEntry";
import type { GlossEntry, GlossHit } from "../../convert/service/gloss/GlossEntry";
import { DEFAULT_CLUE_COLOR } from "../flow/ClueColor";
import { applyClueMarks } from "../flow/ClueMarkDom";
import { allTextNodes, buildCanon, canonMapOf, isCanonNode } from "./CanonDom";
import { canonRangeOf, remapCanon, type CanonRange } from "./ClueCanon";
import { applyClues, clearClueMarks, type ClueAnchor, type ClueResolved } from "./ClueDecorate";
import { dataGlossTableHtml } from "./GlossDom";

/**
 * **线索施工层的对外门面转出**（Issue #57 拆分为 `ClueDecorate` 压 500 行
 * 红线；调用侧只认本文件，零改动）。
 */
export { colorMapOf, isLiftSpan, planClueMarks, type CluePlanItem } from "./ClueDecorate";
export type { ClueAnchor, ClueResolved } from "./ClueDecorate";
export {
    allTextNodes,
    canonMapOf,
    LIFT_SELECTOR,
    NON_CANON_SELECTOR,
    NO_WRAP_SELECTOR,
    pickNodeIndexes,
} from "./CanonDom";

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
        // 遗留根兜底：文本匹配口径（#51 修复版）；颜色按 anchors 同下标
        // 平行数组传进去（Issue #57——兜底链也不许丢选色）
        applyClueMarks(
            root,
            anchors.map((a) => a.text),
            anchors.map((a) => a.color ?? DEFAULT_CLUE_COLOR)
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
