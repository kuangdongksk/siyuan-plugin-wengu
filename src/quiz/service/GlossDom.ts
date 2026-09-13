import { renderMdHtml } from "../../ui/MdRender";
import { collectGlossMarks, planGlossLinks, splitGlossBlock } from "../../convert/service/gloss/GlossEntry";
import {
    allTextNodes,
    assignHitsToNodes,
    clearGlossLinks,
    glossTableHtml,
    wrapHit,
    type GlossSlot,
} from "./MaterialDecorate";

/**
 * 词表区渲染与正文词形联动的**兼容转出面**（Issue #52 二期）。
 *
 * 二期把这条链就地迁进了**统一装饰出口** `quiz/service/MaterialDecorate`
 * （基础渲染 → 权威节点表 → 词形联动 → 轮间重算映射 → 线索 mark，见该
 * 文件头与 Issue #52 附录 D4）——词形联动不再是独立的后处理 owner，而是
 * 装饰编排里的第 ③ 步（权威坐标系的必然要求：施工必须发生在权威节点表
 * 收集之后、线索 mark 之前）。
 *
 * 本文件保留三件事，供**尚未收拢的调用方与既有单测**使用：
 * - `applyGloss`：等价入口（走装饰出口，线索为空 ⇒ 产物与改造前逐字节
 *   同款，见验收 5「无词表材料走原路」）；
 * - `assignHitsToNodes` / `GlossSlot`：落格映射纯口径（单测锁死）；
 * - `clearGlossLinks`：摘旧标记的还原面。
 *
 * 三期收尾：挂载点全部换 `decorateMaterial`、删本文件的转出与 `GlossDom`
 * 相关的 SKIP 名单协调（Issue #52 附录分期表）。
 */

export { assignHitsToNodes, clearGlossLinks };
export type { GlossSlot };

/**
 * 材料渲染入口（等价转出）：材料正文 → 基础渲染 + 词表区 + 正文词形联动。
 * `materialMd` 是材料正文（含尾部词表行）；无词表时产物与改造前逐字节
 * 一致（走基础渲染原路）。
 */
export function applyGloss(root: HTMLElement | undefined | null, materialMd: string | undefined): void {
    if (!root) return;
    const md = materialMd ?? "";
    const { body, entries } = splitGlossBlock(md);
    if (entries.length === 0) {
        root.innerHTML = renderMdHtml(md);
        return;
    }
    root.innerHTML = renderMdHtml(body) + glossTableHtml(entries);
    const nodes = allTextNodes(root).filter((n) => {
        if (!n.nodeValue?.trim()) return false;
        const parent = n.parentElement;
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
    const hits = planGlossLinks(texts.join(""), entries, true, collectGlossMarks(md));
    if (hits.length === 0) return;
    const slots = assignHitsToNodes(texts, starts, hits);
    for (let i = hits.length - 1; i >= 0; i--) {
        const slot = slots[i];
        if (slot.node < 0) continue; // 跨节点命中：放弃（宁缺勿错）
        wrapHit(nodes[slot.node], slot.from, slot.to, hits[i]);
    }
}
