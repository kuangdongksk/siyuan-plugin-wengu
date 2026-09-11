import { renderMdHtml } from "../../ui/MdRender";
import { esc } from "../../ui/shared";
import { collectGlossMarks, planGlossLinks, splitGlossBlock } from "../../convert/service/gloss/GlossEntry";
import type { GlossEntry, GlossHit } from "../../convert/service/gloss/GlossEntry";

/**
 * 词表区渲染与正文词形联动（Issue #30 验收第 2 条），材料渲染的**后处理层**：
 *
 * - 材料正文里的 `@@G 词 | 音标 | 释义` 行 → 词表区 DOM（`ul.wengu-gloss`，
 *   词条下划线、音标弱化、释义常规）；
 * - 正文里与词表词形**精确匹配**的首次出现 → `<span class="wengu-gloss-link">`
 *   包一层 <u> + 序号上标（判定在 GlossEntry.planGlossLinks，本文件只做
 *   DOM 手术）。
 *
 * **与 #29 的线索 mark 后处理互不嵌套**（验收要求）：本层先摘掉自己的
 * 旧标记再重铺，且**不碰 `<mark class="wengu-clue-mark">` 内的文本**
 * ——线索高亮的文本不参与词形匹配，防嵌套手术。
 */

/** 词形联动标记的元素类（幂等重铺先摘）。 */
const LINK_CLASS = "wengu-gloss-link";
/** 线索高亮的标记元素跳过（#29 产物，不参与词形匹配）。 */
const SKIP_INNER = "mark.wengu-clue-mark, script, style, .wengu-gloss";

/** 词表区渲染：`@@G` 行的规范 DOM（`ul.wengu-gloss`）。 */
function glossTableHtml(entries: GlossEntry[]): string {
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

/**
 * 摘掉旧联动标记（还原纯文本节点）。`applyGloss` 自身靠整段重铺幂等，
 * 不依赖它；导出是给「已知根、不想重铺」的调用方（避免二次联动叠标记）。
 */
export function clearGlossLinks(root: HTMLElement): void {
    for (const span of Array.from(root.querySelectorAll<HTMLElement>(`.${LINK_CLASS}`))) {
        const parent = span.parentNode;
        if (!parent) continue;
        parent.replaceChild(document.createTextNode(span.textContent ?? ""), span);
        parent.normalize();
    }
}

/** 收集参与词形匹配的文本节点（跳过线索 mark/脚本/词表自身）。 */
function textNodesOf(root: HTMLElement): Text[] {
    const out: Text[] = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n: Node): number => {
            if (!n.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
            const parent = (n as Text).parentElement;
            if (!parent || parent.closest(SKIP_INNER)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text);
    return out;
}

/** 全根文本的拼接（与 textNodesOf 同口径），供偏移映射用。 */
function joinedText(nodes: Text[]): string {
    return nodes.map((n) => n.nodeValue ?? "").join("");
}

/** 把命中区间映射回「节点下标 + 节点内区间」，并包一层联动标记。 */
function wrapHit(nodes: Text[], nodeStarts: number[], hit: GlossHit): void {
    let idx = -1;
    for (let i = 0; i < nodes.length; i++) {
        const s = nodeStarts[i];
        const text = nodes[i].nodeValue ?? "";
        if (hit.start >= s && hit.end <= s + text.length) {
            idx = i;
            break;
        }
    }
    if (idx < 0) return; // 跨节点命中：放弃（宁缺勿错，与线索高亮同策略）
    const node = nodes[idx];
    if (!node.isConnected) return;
    const from = hit.start - nodeStarts[idx];
    const to = hit.end - nodeStarts[idx];
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
    // 序号上标（原文 `^{...}` 记号语义的等价呈现；有记号则带记号）
    const sup = document.createElement("sup");
    sup.className = "wengu-gloss-sup";
    sup.textContent = hit.mark ? `${hit.order}·${hit.mark}` : String(hit.order);
    span.appendChild(sup);
    target.parentNode?.replaceChild(span, target);
}

/**
 * 材料渲染的**唯一**词表后处理入口（幂等）：拆分正文/词表区 → 渲染词表 →
 * 正文词形联动。`materialMd` 是材料正文（含尾部词表行）。
 *
 * 幂等靠**整段重铺**（`root.innerHTML = renderMdHtml(...)`，与改造前的
 * `innerHTML = renderMdHtml(mat.bodyMd)` 同一条老路）：重复调用只会重建
 * 同一份产物，不叠加标记；`clearGlossLinks` 只是给「同根内二次联动的调用方」
 * 留的还原面（本函数自身重铺已足够，见 refreshClueMarkFor 的对应侧）。
 *
 * 无词表时零动作（存量材料渲染逐字节不变——验收第 4 条）。
 */
export function applyGloss(root: HTMLElement | undefined | null, materialMd: string | undefined): void {
    if (!root) return;
    const { body, entries } = splitGlossBlock(materialMd);
    if (entries.length === 0) {
        root.innerHTML = renderMdHtml(materialMd ?? "");
        return;
    }
    root.innerHTML = renderMdHtml(body) + glossTableHtml(entries);
    const nodes = textNodesOf(root);
    if (nodes.length === 0) return;
    const starts: number[] = [];
    let acc = 0;
    for (const n of nodes) {
        starts.push(acc);
        acc += (n.nodeValue ?? "").length;
    }
    for (const hit of planGlossLinks(joinedText(nodes), entries, true, collectGlossMarks(materialMd ?? "")))
        wrapHit(nodes, starts, hit);
}
