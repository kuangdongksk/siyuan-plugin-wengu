import { decorateMaterial, type ClueResolved } from "./MaterialDecorate";

/**
 * 词表区渲染与正文词形联动的**兼容转出面**（Issue #52 二期）。
 *
 * 二期把这条链就地迁进了**统一装饰出口** `quiz/service/MaterialDecorate`
 * （基础渲染 → 权威节点表 → 词形联动 → 轮间重算映射 → 线索 mark，见该
 * 文件头与 Issue #52 附录 D4）——词形联动不再是独立的后处理 owner，而是
 * 装饰编排里的第 ③ 步（权威坐标系的必然要求：施工必须发生在权威节点表
 * 收集之后、线索 mark 之前）。
 *
 * 本文件只剩**转出**（含既有单测与三期收尾前的零散调用点）：
 * `applyGloss` 走装饰出口，线索为空 ⇒ 产物与改造前逐字节同款（验收 5
 * 「无词表材料走原路」）。**不再自带第二份 SKIP 名单**——两处名单互抄正是
 * 本案（#51）的病根之一。
 *
 * 三期收尾：删本文件（挂载点已全部换 `decorateMaterial`）。
 */

export { assignHitsToNodes, clearGlossLinks, glossTableHtml } from "./MaterialDecorate";
export type { GlossSlot } from "./MaterialDecorate";

/**
 * 材料渲染入口（等价转出）：材料正文 → 基础渲染 + 词表区 + 正文词形联动。
 * `materialMd` 是材料正文（含尾部词表行）；无词表时产物与改造前逐字节
 * 一致（走基础渲染原路）。
 */
export function applyGloss(root: HTMLElement | undefined | null, materialMd: string | undefined): ClueResolved[] {
    return decorateMaterial(root, { md: materialMd ?? "" });
}
