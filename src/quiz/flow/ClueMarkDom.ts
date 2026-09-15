import {
    CLUE_ARM_MS,
    clickClueChip,
    markSlots,
    mergeMarkSlots,
    newClueDeleteState,
    planMarks,
    type ClueDeleteState,
} from "./ClueMark";
import { clueColorStyle } from "./ClueColor";

/**
 * 线索标注的 DOM 手术层（Issue #28）：原文高亮包装（mark 元素）与
 * chips 行的两击删除接线。纯判定在 ClueMark.ts，本文件只碰 DOM——
 * 但**不持有跨渲染状态**，删除态挂在 chips 行元素上（行随 chips 槽
 * 重建，态自然复位）。
 *
 * ⚠️ **Issue #52 二期起，写 mark 的常规入口是 `MaterialDecorate`**：
 * 装饰出口在做完基础渲染/词形联动后按**权威坐标**施工（有坐标优先，
 * 无坐标/校验失败才落到本文件的文本匹配口径）；线索的**文本匹配**
 * 判定（`ClueMark.planMarks`/`markSlots`）与两条选择器口径原样保留，
 * 它们是「坐标缺失/漂移」时的**降级地基**（#51 的修复正是它的正确性
 * 基础，**不得删除**）。
 *
 * 因此本文件的 `applyClueMarks` 退居**遗留根**的兜底入口（尚无权威
 * 坐标系的根——如外部挂载的旧壳），新挂载点一律走 `MaterialDecorate.decorateMaterialEntry`。
 *
 * 与词形联动的**单向嵌套**口径（Issue #51 定语义、Issue #53 三期起由装饰
 * 出口 `MaterialDecorate` 一次施工保证，本文件只留 fallback 侧名单）：
 * - 联动词形标记 `.wengu-gloss-link` 里的 `<u>` **包的就是原文本身**，
 *   其文本**参与**线索匹配、允许被包 mark（跳过它会让「选段含联动词」
 *   整段定位失败）；
 * - 词表区 `.wengu-gloss`（词条/音标/释义）**不是原文**，整片跳过；
 * - 序号上标 `.wengu-gloss-sup` **要参与匹配**（用户拖选得到的选段带
 *   「N·记号」字符，两边对得上才匹配得上）却**不许被包**——它在词表区
 *   内时已被整片排除，词表区之外的同类上标由落格守卫单独挡。
 * 即 **mark 可以进 `<u>`、词表永不包 mark**，嵌套只单向发生。
 */

/** chips 行里 chip 的选中类（待确认高亮警示，scss 里配红边框）。 */
export const CLUE_ARM_CLASS = "wengu-clue-chip-armed";

/** 跳过高亮的标记元素：既有 mark（幂等重铺先摘，这里防我们自己的产物
 *  被当成文本源）、脚本/样式、交互控件（按钮里的字母/选项文本不是原文
 *  ——标记它毫无意义且会打乱控件）、以及**答案解析区与选项区**（与题干
 *  同容器；解析在揭示前不可见，把 mark 埋进去会在收卷后显出一段莫名的
 *  高亮，且解析文本本就不是「原文」）。
 *
 *  **词表区**（`.wengu-gloss`）跳过：词表行是插件按 `@@G` 行渲染出来的
 *  展示件，不是原文正文。
 *
 *  词形联动的两类标记**必须分开处置**（Issue #51）：
 *  - `.wengu-gloss-link`（正文里的联动词形，内容 `<u>词</u><sup>序号</sup>`）
 *    **不跳过**——`<u>` 包的就是原文本身，把它排除在匹配文本源之外，
 *    「选段含联动词」就整段定位失败（真机即此现象），故它的文本参与
 *    匹配、允许被包 mark；
 *  - `.wengu-gloss-sup`（序号上标）**也不进**本表：它要参与匹配，只在
 *    落格时挡（见 SUP_SELECTOR）。 */
export const SKIP_SELECTOR =
    "script, style, mark, button, .wengu-clue-chip, .wengu-gclues, .wengu-annobar, .wengu-opt-letter, .wengu-static-sol, .wengu-opts, .wengu-gloss";

/** 落格守卫：序号上标 `.wengu-gloss-sup`——**参与匹配但不许被包**。
 *  与 SKIP_SELECTOR 分开是因为两者管的事不同：前者决定「谁是匹配文本
 *  源」，后者只决定「谁不许被包 mark」。词表区内的上标已由 SKIP_SELECTOR
 *  整片排除，这里管的是词表区之外的同名上标（宁缺勿错）。 */
export const SUP_SELECTOR = ".wengu-gloss-sup";

/** 收集某标记元素下的文本节点（跳过 SKIP_SELECTOR 子树）。
 *
 *  ⚠️ **跳过口径直接决定匹配文本源**（Issue #51 真根因）：SKIP_SELECTOR
 *  命中即整片退出匹配文本源——多排除一个类 = 该类文本从 haystack 消失，
 *  含它的选段子串匹配必败、静默降级只留 chip。本次缺陷即
 *  `.wengu-gloss-link` 混进跳表（`<u>` 包的就是原文本身），故修法是把
 *  它移出 SKIP_SELECTOR；`SUP_SELECTOR` 是**落格守卫**，只挡「不许被包
 *  mark」、不挡匹配（见 applyClueMarks 的落格循环）。
 *
 *  REJECT→SKIP 的保留只是**防御性口径**：与 SKIP 语义等价（文本节点无
 *  子树），防未来 whatToShow 放宽或对元素判定时误用 REJECT 连子树一起拒。 */
function textNodesOf(root: HTMLElement): Text[] {
    const out: Text[] = [];
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n: Node): number => {
            if (!n.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
            const parent = (n as Text).parentElement;
            if (!parent || parent.closest(SKIP_SELECTOR)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text);
    return out;
}

/** 摘掉某根内全部高亮 mark（还原原文本节点；元素本身若变空则一并删）。 */
export function clearClueMarks(root: HTMLElement): void {
    const marks = Array.from(root.querySelectorAll<HTMLElement>("mark.wengu-clue-mark"));
    for (const m of marks) {
        const parent = m.parentNode;
        if (!parent) continue;
        parent.replaceChild(document.createTextNode(m.textContent ?? ""), m);
        parent.normalize();
    }
}

/** 把一段文本节点区间包进 mark（自后向前切分，避免偏移失效）。
 *  唯一实现——`service/ClueDecorate` 的坐标施工链共用（Issue #114）。 */
export function wrapRange(node: Text, start: number, end: number, style?: string): void {
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
 * 高亮后处理（唯一入口，幂等）：先摘旧 mark，再把每条线索按
 * 「全部文本节点原文拼接 + 归一匹配」定位并包装。定位不到的线索只留
 * chip，不报错（归一匹配不上按降级策略处理，见 ClueMark.locateAcrossNodes）。
 *
 * ⚠️ **遗留兜底入口**（无权威坐标系时的文本匹配施工；新挂载点走
 * `MaterialDecorate` 的装饰出口）。
 *
 * ⚠️ **落格映射一次性算好，施工按 `markSlots` 的全局序**（与
 * CanonDom 词形联动的 assignHitsToNodes（装饰出口 ③）同款口径，Issue #36）：
 * 偏移是**全部文本节点
 * 原文的拼接**口径，而 `splitText` 会截短节点——同一节点内的段必须
 * **自后向前**切。故先按**未改动**的节点表算出全部计划（`planMarks`），
 * 再由 `markSlots` 统一排序施工（节点升序 + 节点内起点降序）。
 * 按线索逐条施工是错的：第二条线索落在同一节点时区间越界，静默不落格。
 *
 * ⚠️ **排序前必过 `ClueMark.mergeMarkSlots` 合并**（Issue #56）：逐条独立
 * 匹配（线索间不做避让）+ 同起点两条以插入序稳定排序 ⇒ 先落格那条切完
 * 节点、后一条越界被保护性跳过，静默不出 mark（「同段文字反复微调标注」
 * 必然踩中）。合并取并集（长覆盖短/部分重叠成一段/相接成一段），合并后
 * 互不相交 ⇒ 施工不再触发守卫。**装饰出口的坐标路径同样过这一步**——
 * 两条链都不许静默丢 mark，只修 fallback 等于用户主路径带病。
 */
export function applyClueMarks(
    root: HTMLElement | undefined | null,
    clues: string[],
    colors?: readonly number[]
): void {
    if (!root) return;
    clearClueMarks(root);
    if (clues.length === 0) return;
    const nodes = textNodesOf(root);
    const plan = planMarks(
        nodes.map((n) => n.nodeValue ?? ""),
        clues
    );
    // 施工序列由 ClueMark.markSlots 给出（节点升序 + 节点内起点降序）：
    // 同一节点里靠后的段先切，前段偏移才不被 splitText 截短——按线索
    // 逐条施工会让**第二条线索在同一节点内静默不落格**。
    // 排序前合并同节点内重叠/相接的区间（Issue #56）：相交的两条不合并
    // 就是「先切的那条截短节点、后一条越界静默丢 mark」。
    for (const slot of mergeMarkSlots(markSlots(plan))) {
        const node = nodes[slot.node];
        if (!node?.isConnected) continue;
        // 落格守卫（Issue #51）：序号上标参与匹配但**不许被包**——mark 套在
        // 上标上只会让高亮里冒出一个莫名的数字；上标命中的那一段跳过，
        // 词本身（<u> 内的文本节点）照常出 mark。
        if (node.parentElement?.closest(SUP_SELECTOR)) continue;
        // 选色（Issue #57）：按 slot 的线索引（合并后 = 最长那条）查色号，
        // 无索引/越界 ⇒ 默认黄（与装饰出口同口径）
        const style = clueColorStyle(slot.clue === undefined ? undefined : colors?.[slot.clue]);
        wrapRange(node, slot.start, slot.end, style);
    }
}

/* ── chips 行：两击删除 ── */

/** 行上的删除态寄存器（WeakMap：行元素被 innerHTML 覆写后自然回收）。 */
const armStates = new WeakMap<HTMLElement, ClueDeleteState>();
const armTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** 取（或建）某 chips 行的删除态机。 */
export function clueDeleteStateOf(row: HTMLElement): ClueDeleteState {
    let st = armStates.get(row);
    if (!st) {
        st = newClueDeleteState();
        armStates.set(row, st);
    }
    return st;
}

/** 复位某行的待确认态（超时/确认删除后调用）。 */
export function disarmClueChip(row: HTMLElement): void {
    const st = clueDeleteStateOf(row);
    st.armed = undefined;
    const timer = armTimers.get(row);
    if (timer !== undefined) clearTimeout(timer);
    armTimers.delete(row);
    for (const chip of Array.from(row.querySelectorAll<HTMLElement>(".wengu-clue-chip"))) {
        chip.classList.remove(CLUE_ARM_CLASS);
    }
}

/**
 * 点击第 i 个 chip：首击=进入待确认（chip 加警示类 + 3s 定时复位），
 * 再击同一个=返回 true（调用方删线索并重铺 chips/高亮）。返回 false
 * 表示仅 arm（调用方只需把警示类刷上）。
 */
export function clickChipForDelete(row: HTMLElement, i: number): boolean {
    const st = clueDeleteStateOf(row);
    const verdict = clickClueChip(st, i);
    const timer = armTimers.get(row);
    if (timer !== undefined) clearTimeout(timer);
    armTimers.delete(row);
    if (verdict === "second") return true;
    const armed = st.armed;
    for (const chip of Array.from(row.querySelectorAll<HTMLElement>(".wengu-clue-chip"))) {
        chip.classList.toggle(CLUE_ARM_CLASS, chip.dataset.clue === String(armed));
    }
    armTimers.set(
        row,
        setTimeout((): void => disarmClueChip(row), CLUE_ARM_MS)
    );
    return false;
}

/** 把当前删除态刷进 DOM（chips 行重铺后调用：重铺丢类，态仍在）。 */
export function syncChipArmState(row: HTMLElement): void {
    const armed = clueDeleteStateOf(row).armed;
    if (armed === undefined) return;
    for (const chip of Array.from(row.querySelectorAll<HTMLElement>(".wengu-clue-chip"))) {
        chip.classList.toggle(CLUE_ARM_CLASS, chip.dataset.clue === String(armed));
    }
}
