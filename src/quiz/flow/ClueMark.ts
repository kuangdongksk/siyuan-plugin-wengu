/**
 * 线索标注的纯逻辑层（Issue #28 滑选标注重设计）：选段定位 → 原文高亮
 * 包装、跨标签边界降级匹配、chips 两击删除状态机。全部与 DOM 无关的
 * 判定收在这（单测覆盖），DOM 手术在 ClueMarkDom.ts，编排在 ClueFlow。
 *
 * 「选段」= 用户在材料/题干里拖选得到的纯文本（会话 clues 存的锚点）；
 * 「高亮」= 渲染后把该文本在原 DOM 里定位并包一层 mark——文本与 DOM
 * 之间没有 id 级的对应关系（只读静态渲染、不写块），只能做文本匹配，
 * 因此**宁缺勿错**：定位不到就只留 chip，不报错也不乱高亮。
 */

/** 选段在文本节点里的定位结果：节点下标 + 命中区间。 */
export interface TextHit {
    /** 文本节点在传入数组里的下标。 */
    node: number;
    /** 起始偏移（含）。 */
    start: number;
    /** 结束偏移（不含）。 */
    end: number;
}

/** 匹配用的归一化：空白折叠 + 去首尾。选段跨行/跨段时 DOM 文本节点的
 *  换行与源文本不一致（材料 md 的软换行渲染成空格、段落间是块边界），
 *  空白差异必须忽略，否则长选段永远定位不到。 */
export function normForMatch(s: string): string {
    return s.replace(/\s+/g, " ").trim();
}

/** 归一化后每个字符回指原串下标（折叠空白时丢弃的字符记到下一个保留
 *  字符上）——把「归一坐标」还原成「节点内真实偏移」用。 */
function indexMap(s: string): number[] {
    const map: number[] = [];
    let pending = -1;
    for (let i = 0; i < s.length; i++) {
        if (/\s/.test(s[i])) {
            if (pending < 0) pending = i;
            continue;
        }
        if (map.length === 0) {
            // 首个保留字符：把它前面被折叠的空白一并算进起点
            map.push(pending >= 0 ? pending : i);
        } else {
            map.push(i);
        }
        pending = -1;
    }
    return map;
}

/** 在单个文本里找 needle（空白不敏感）；返回原串坐标区间，未命中 null。
 *  同一个 needle 取**首个**命中（宁缺勿错：首个包含完整文本处即锚点）。 */
export function findInText(haystack: string, needle: string): { start: number; end: number } | null {
    const h = normForMatch(haystack);
    const n = normForMatch(needle);
    if (!n || n.length > h.length) return null;
    const at = h.indexOf(n);
    if (at < 0) return null;
    const hMap = indexMap(haystack);
    const start = hMap[at] ?? 0;
    const lastN = n.length - 1;
    const endIdx = hMap[at + lastN] ?? haystack.length - 1;
    return { start, end: endIdx + 1 };
}

/**
 * 单节点级定位（降级路径）：选段跨标签边界（跨 `<strong>`/`<em>`/公式
 * 占位等）时，多节点拼接匹配会横跨元素——包装 mark 就得切 DOM 边界，
 * 风险高。按需求「宁缺勿错」，降级为**按文本节点级子串匹配**：返回
 * 首个包含该段完整文本的节点（单节点内含全部选段文本才命中），完全
 * 不命中返回 null（调用方只留 chip，不高亮、不报错）。
 */
export function locateInNodes(nodes: string[], needle: string): TextHit | null {
    for (let i = 0; i < nodes.length; i++) {
        const hit = findInText(nodes[i], needle);
        if (hit) return { node: i, start: hit.start, end: hit.end };
    }
    return null;
}

/** 一条线索在当前题/材料里的高亮计划：命中哪个节点、区间多少。 */
export interface MarkPlan {
    /** 线索原文（chips 用同一份）。 */
    text: string;
    /** 命中区间；null=定位不到（只留 chip，不高亮）。 */
    hit: TextHit | null;
}

/**
 * 为多条线索算出高亮计划（一次遍历各文本节点，逐条独立匹配——
 * 线索之间不互相避让：重叠高亮由 DOM 包装顺序自然嵌套，视觉可接受，
 * 强行拆分反而易错）。节点列表由 DOM 侧按标记元素收集（跳过既有
 * mark/脚本/不可见节点）。
 */
export function planMarks(nodes: string[], clues: string[]): MarkPlan[] {
    const seen = new Set<string>();
    const out: MarkPlan[] = [];
    for (const raw of clues) {
        const text = raw.trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push({ text, hit: locateInNodes(nodes, text) });
    }
    return out;
}

/* ── chips 两击删除状态机 ── */

/** chips 删除的两击确认态：armed=待确认的 chip 下标（undefined=未 arm）。 */
export interface ClueDeleteState {
    armed: number | undefined;
}

/** 新建删除状态机（每张卡/每个 chips 槽一份）。 */
export function newClueDeleteState(): ClueDeleteState {
    return { armed: undefined };
}

/** 一次 chip 点击的判定结果：first=进入待确认（高亮警示）、second=确认删除。 */
export type ClueClickVerdict = "first" | "second";

/**
 * 点击第 i 个 chip：首次=进入待确认（3s 复位由 DOM 侧计时器管，复位时
 * 调 disarm 清态），再点同一个=确认删除（调用方据此删线索并摘 mark）；
 * 点别的 chip 则把待确认挪过去（对齐 AiSessions 两击惯例）。
 */
export function clickClueChip(state: ClueDeleteState, i: number): ClueClickVerdict {
    if (state.armed === i) {
        state.armed = undefined;
        return "second";
    }
    state.armed = i;
    return "first";
}

/** 复位待确认态（超时/重渲染/删除完成后调）。 */
export function disarmClueChip(state: ClueDeleteState): void {
    state.armed = undefined;
}

/** 两击确认窗口（ms，对齐 AiSessions 的 Armed 默认值）。 */
export const CLUE_ARM_MS = 3000;

/* ── chip 归属题反查 ── */

/** chip 所在的 DOM 归属信息（由 DOM 侧读出，纯函数只做判定）。 */
export interface ClueOwnerPick {
    /** 最近的 .wengu-card 上的 data-qid（组题行在 .wengu-gunit 里，无卡=undefined）。 */
    cardQid: string | undefined;
    /** 视图当前题 qid（组题行只渲染组内当前题，拿到空时回落它）。 */
    currentQid: string | undefined;
}

/**
 * 被点 chip 的归属题 qid（长卷边界，Issue #28 复审）：本插件长卷是
 * **全卡常驻渲染**（题号栏滚跳的前提），非当前题卡上的 chip 也点得到——
 * 归属只能从被点行反查，按「当前题」删会删错题的线索并在错题上重铺
 * mark/chips。组题行在 .wengu-gunit 里、行内只渲染当前题，无卡 qid 可查，
 * 此时回落当前题。
 */
export function clueOwnerQid(pick: ClueOwnerPick): string | undefined {
    return pick.cardQid ?? pick.currentQid;
}
