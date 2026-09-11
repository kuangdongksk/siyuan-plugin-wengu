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
    return normWithMap(s).text.trim();
}

/** 归一化 + 坐标回映射（一次扫描同时产出）：空白段折叠成一个空格
 *  （坐标记到该段起点），其余字符原样。**归一串与映射必须同源产出**——
 *  旧实现只返回归一串、另建「第 k 个非空白字符」的下标表，而归一串里
 *  还留着折叠出来的空格，两套坐标错位：命中的区间整段偏移（多词选段
 *  的高亮首尾都错，见单测「返回原串坐标」组）。 */
function normWithMap(s: string): { text: string; map: number[] } {
    let text = "";
    const map: number[] = [];
    let i = 0;
    while (i < s.length) {
        if (/\s/.test(s[i])) {
            const start = i;
            while (i < s.length && /\s/.test(s[i])) i++;
            text += " ";
            map.push(start);
        } else {
            text += s[i];
            map.push(i);
            i++;
        }
    }
    return { text, map };
}

/** 在单个文本里找 needle（空白不敏感）；返回原串坐标区间，未命中 null。
 *  同一个 needle 取**首个**命中（宁缺勿错：首个包含完整文本处即锚点）。 */
export function findInText(haystack: string, needle: string): { start: number; end: number } | null {
    const h = normWithMap(haystack);
    const n = normForMatch(needle);
    if (!n) return null;
    const at = h.text.indexOf(n); // needle 已去首尾空白 ⇒ 命中点必落在非空字符上
    if (at < 0) return null;
    const start = h.map[at] ?? 0;
    const last = h.map[at + n.length - 1] ?? haystack.length - 1;
    return { start, end: last + 1 };
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

/* ── 组内共享槽的刷新归属 ── */

/** 判断「该题是否组内当前题」所需的观测（DOM 侧读出，纯函数只做判定）。 */
export interface GroupCurrentPick {
    /** 是否组题：非组题卡各自独占槽位，恒可刷。 */
    grouped: boolean;
    /** 该题的卡当前是否可见（DOM 权威；undefined=卡未渲染，无从判断）。 */
    visible: boolean | undefined;
    /** 组运行态当前题下标（组内切题后先更新它，DOM 的 hidden 要等一拍）。 */
    groupQi: number | undefined;
    /** 该题在组内的下标。 */
    myQi: number | undefined;
}

/**
 * 组题的材料面板与底部 chips 槽是**组内共享**的（组内一次只显示一题），
 * 只有当前显示的那题能刷——非当前题刷会覆盖当前题的 chips 与 mark
 * （整壳全量补齐按题表遍历，最后一道有线索的组内题会赢）。判据四级：
 * ① DOM 明确可见 ⇒ 放行（短路掉边角形态的误拦）；② 组运行态下标比对
 * （同步更新，判定组内切题同一拍的情形）；③ 无运行态而 DOM 明确隐藏
 * ⇒ 拦；④ 两侧都读不到 ⇒ 不拦（宁可不拦，别把正常刷新掐掉）。
 */
export function isGroupCurrentPick(p: GroupCurrentPick): boolean {
    if (!p.grouped) return true;
    // ① 它自己就是可见的那张卡 ⇒ 一定是当前题（**先给放行**：中段那份
    //    「运行态比对」在材料 id 复用等边角形态下可能算出不同下标，放行
    //    短路保证那些形态不被误拦）
    if (p.visible === true) return true;
    // ② 组运行态与「该显示哪张卡」同源且**同步**更新（组内切题先改 qi、
    //    再走 onActive），而 DOM 的 hidden 要等组件重渲染一拍才落——同一
    //    拍内只能靠它判
    if (p.groupQi !== undefined && p.myQi !== undefined) return p.groupQi === p.myQi;
    // ③ 无运行态记录（从未切过题）而 DOM 明确说它隐藏 ⇒ 非当前题
    if (p.visible === false) return false;
    return true; // ④ 两侧都读不到：宁可不拦，别把正常刷新掐掉
}
