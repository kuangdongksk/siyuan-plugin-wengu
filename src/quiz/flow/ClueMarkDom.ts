import { CLUE_ARM_MS, clickClueChip, locateInNodes, newClueDeleteState, type ClueDeleteState } from "./ClueMark";

/**
 * 线索标注的 DOM 手术层（Issue #28）：原文高亮包装（mark 元素）与
 * chips 行的两击删除接线。纯判定在 ClueMark.ts，本文件只碰 DOM——
 * 但**不持有跨渲染状态**，删除态挂在 chips 行元素上（行随 chips 槽
 * 重建，态自然复位）。
 *
 * 高亮后处理 `applyClueMarks` 是**唯一**写 mark 的入口（材料填充后 /
 * 题干挂载后 / 会话恢复后三处都过它，禁复制第二份）；幂等：先摘旧
 * mark 再按当前线索重铺，重复调用零副作用。
 */

/** chips 行里 chip 的选中类（待确认高亮警示，scss 里配红边框）。 */
export const CLUE_ARM_CLASS = "wengu-clue-chip-armed";

/** 跳过高亮的标记元素：既有 mark（幂等重铺先摘，这里防我们自己的产物
 *  被当成文本源）、脚本/样式、交互控件（按钮里的字母/选项文本不是原文
 *  ——标记它毫无意义且会打乱控件）、以及**答案解析区与选项区**（与题干
 *  同容器；解析在揭示前不可见，把 mark 埋进去会在收卷后显出一段莫名的
 *  高亮，且解析文本本就不是「原文」）。
 *
 *  **词表区与词形联动标记也跳过**（Issue #30）：词表行不是原文正文、
 *  联动标记里的文本已由 GlossDom 包过一层（再包 mark 就是嵌套手术，
 *  且会打乱序号上标）——两条后处理互不嵌套（#29/#30 的接口约定）。 */
const SKIP_SELECTOR =
    "script, style, mark, button, .wengu-clue-chip, .wengu-gclues, .wengu-annobar, .wengu-opt-letter, .wengu-static-sol, .wengu-opts, .wengu-gloss, .wengu-gloss-link";

/** 收集某标记元素下的文本节点（跳过 SKIP_SELECTOR 子树）。 */
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

/** 把一段文本节点区间包进 mark（自后向前切分，避免偏移失效）。 */
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
 * 高亮后处理（唯一入口，幂等）：先摘旧 mark，再把每条线索按
 * 「文本节点级子串匹配」定位并包装。定位不到的线索只留 chip，不报错
 * （跨标签边界按降级策略处理，见 ClueMark.locateInNodes）。
 */
export function applyClueMarks(root: HTMLElement | undefined | null, clues: string[]): void {
    if (!root) return;
    clearClueMarks(root);
    if (clues.length === 0) return;
    // 逐个线索重扫文本节点：包装 mark 后节点列表变了，用**当前**节点表
    // 重新定位（线索少、节点少，成本可忽略；一次算好再批量包会因偏移
    // 漂移错位）
    for (const raw of clues) {
        const text = raw.trim();
        if (!text) continue;
        const nodes = textNodesOf(root);
        const hit = locateInNodes(
            nodes.map((n) => n.nodeValue ?? ""),
            text
        );
        if (!hit) continue;
        const node = nodes[hit.node];
        if (!node?.isConnected) continue;
        wrapRange(node, hit.start, hit.end);
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
