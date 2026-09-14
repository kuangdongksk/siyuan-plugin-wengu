/**
 * 权威坐标系的 **DOM 观测层**（自 MaterialDecorate 拆出，Issue #57）：
 * 两套选择器口径（非权威区 / 落格守卫 / 抬升目标）+ 文本节点表收集
 * + 权威坐标系建立。
 *
 * 与 `ClueCanon`（纯逻辑，无 DOM）互补：那边算偏移/校验/换算，这边只
 * **从 DOM 观测**节点与名单。拆出后 `MaterialDecorate`（装饰编排）与
 * `ClueDecorate`（线索施工）都从这里取观测，两边不再互相 import
 * （避免循环依赖）。
 *
 * ⚠️ **三套名单别混**（原注释逐字保留，见各常量）：
 * `NON_CANON_SELECTOR` = 权威文本源、`NO_WRAP_SELECTOR` = 落格守卫、
 * `ClueMarkDom.SKIP_SELECTOR` = fallback 匹配源。多写/漏写一个类都是
 * 静默失效（权威串被挖掉几个字 / 坐标校验全量失配 / 高亮漏一段）。
 */
import { buildCanonMap, type CanonMap } from "./ClueCanon";
import { SKIP_SELECTOR as MATCH_SKIP_SELECTOR } from "../flow/ClueMarkDom";

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
export function isCanonNode(n: Text): boolean {
    if (!n.nodeValue?.trim()) return false;
    const parent = n.parentElement;
    return !!parent && !parent.closest(NON_CANON_SELECTOR);
}

/** 文本节点是否属**匹配源**（fallback 文本匹配口径，= `ClueMarkDom.SKIP_SELECTOR`
 *  的补集）。与权威口径**不是一回事**：上标要参与匹配（只在落格时挡）、
 *  既有 mark 要跳过。两套判定别混用，也别把两者合并成一个名单。 */
export function isMatchSourceNode(n: Text): boolean {
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
export function buildCanon(root: HTMLElement): CanonMap {
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
 *  **必须每次重算、不许缓存复用**：线索 mark 施工会 `splitText` 并插入
 *  新节点，任何「施工前算好存起来」的表，其 `nodeIndex` 在下一次操作时
 *  都已失效（表现为第二条线索坐标求错/求不出，静默降级）。重算是
 *  O(文本节点数) 的纯观测，只发生在用户动作上（新增线索/重铺高亮），
 *  高频渲染路径（decorate 内部）走的是当次算好的表。 */
export function canonMapOf(root: HTMLElement | undefined | null): CanonMap | undefined {
    return root ? buildCanon(root) : undefined;
}

/** 兼容别名（旧调用点语义同 canonMapOf：取该根的权威坐标系）。 */
export function ensureCanonMap(root: HTMLElement | undefined | null): CanonMap | undefined {
    return canonMapOf(root);
}
