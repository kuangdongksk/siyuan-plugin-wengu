/**
 * 「运行中的 AI 流」注册表（Issue #77）：**多调用流的流级停止面**。
 *
 * 背景：单条 AI 调用（agentChatOnce）的停止入口原先落在 AI 会话面板的
 * **记录详情**里——但一条记录只是一次调用，而用户想停的是一整条业务流
 * （整卷转换/六批流/增量补生成/AI 索引）。故把「整批停止」提到流级：
 * 面板顶部渲染一条**流级横幅**（流名 + 进度摘要 + 停止钮），记录详情
 * 一律不再出现停止钮（换归属说明行）。
 *
 * 本模块是**通用注册表而不是转换专属**——ai 域提供机制，任何多调用流
 * （转换族的四个入口 + 六个批流）经 begin/progress/end 登记即可，不为
 * 任何业务域开特例分支。
 *
 * 三条硬口径：
 *  1. **同时只有一条**（单条横幅约束）：转换有 active 单例、六批流有
 *     aiFlowBegin 单飞闸，天然不叠加；真叠了则后来者不覆盖前者（先到
 *     先得，防误伤在跑的流）。
 *  2. **end 必达**（finally 语义）：流的收口段一律把 end 放 finally——
 *     漏调一次横幅就永久挂着，停止钮指向已结束的流。
 *  3. **停止句柄复用既有中止通道**（client 的 aiAbort/aiStopHandle），
 *     不新造第二套；横幅只负责「调一下」。
 *
 * 待抉择态（可选）：转换流停止后不立刻消失，而是转 `choice` 阶段——
 * 横幅上直接给「保留已生成 / 全部丢弃」钮（接 ConvertRun 的导出函数），
 * 抉择落定才 end。停止与收口都在面板完成，不强制跳回页签。
 *
 * **结构化载荷（Issue #85）**：横幅按设计稿还原成「两行标题 + 构成条 +
 * 富统计 + 六态计数 + 分篇清单」。注册表仍是**通用**的——它只认
 * `state/name/note/metric` 这组通用形态，**不 import 任何 convert 类型**；
 * 业务域（ConvertFlow）负责把自己的快照折算成这套通用结构。
 */

/** 横幅阶段：running=跑动中（出停止钮）；choice=待抉择（出保留/丢弃钮）。 */
export type AiFlowPhase = "running" | "choice";

/** 分篇行的状态（通用形态，非 convert 类型）：六态 + 单流态占位。 */
export type AiFlowItemState = "queued" | "running" | "done" | "skipped" | "stopped" | "failed" | "cancelled";

/** 分篇清单的一行（**通用形态**，Issue #85）：业务域自己把快照折成它，
 *  ai 域不认任何业务字段——`metric` 是「题数」还是「已读 62%」由业务域定。 */
export interface AiFlowEntryItem {
    /** 序号（1 起，渲染侧补零）。 */
    index: number;
    /** 篇名。 */
    name: string;
    state: AiFlowItemState;
    /** 状态后缀（如「失败 · 模型返回超时」的原因部分；缺省=只出状态词）。 */
    reason?: string;
    /** 备注（11.5px 弱化色那一列，可空）。 */
    note?: string;
    /** 右对齐 mono 指标列（「46 题」/「已读 62%」，可空）。 */
    metric?: string;
}

/** 六态计数（通用形态；零值照常在场，压暗由渲染侧样式承担）。 */
export interface AiFlowCounts {
    done: number;
    skipped: number;
    running: number;
    failed: number;
    cancelled: number;
    queued: number;
    /** 停止态的那一篇（running 位置改出「停止 · 待抉择」）；单流恒 0。 */
    stopped?: number;
}

/** 队列维度（批量流才有；单流态整块缺省 ⇒ 无 seg / 无 counts / 无清单）。 */
export interface AiFlowQueue {
    /** 队列标题（副标题「批量队列 ·《卷名》」的卷名部分）。 */
    title?: string;
    /** 总篇数。 */
    total: number;
    /** 当前/停止所在篇号（1 起；0=未知）。 */
    current?: number;
    /** 六态计数。 */
    counts: AiFlowCounts;
    /** 分篇清单（全量；截断与窗口标注由渲染侧纯逻辑决定）。 */
    items: AiFlowEntryItem[];
}

/** 进度摘要的**结构化**形态（Issue #85 富统计行）：数字单独拎出来，渲染
 *  侧才能把它们用等宽加粗强调（设计稿 fb-stats 的 `<b>`）。文案本身仍由
 *  业务域取词组装（`text` 是成品串，注册表不碰 i18n）。 */
export interface AiFlowStats {
    /** 计数型字段（hint=数字前的说明词、value=数字本身）。 */
    fields: AiFlowStatField[];
}

/** 富统计的一个字段：`hint` 是已取词的说明词（「本篇已读」），`value` 是
 *  **数字本身**（「62%」「12/24」）——渲染侧出 `hint <b>value</b>`。
 *  `tail` 是数字后的**字面后缀**（设计稿「第 <b>12</b>/24 篇」的「/24 篇」、
 *  「累计 <b>148</b> 题」的「 题」）——它是数字的计量单位、不进加粗，
 *  故必须与 `value` 分开传（塞进 value 会把单位一起加粗，与设计稿不符）。
 *  ⚠️ **间距由 tail 自带**：设计稿里「/24 篇」的斜杠紧贴数字、「 题」前有
 *  空格——两种间距不一致，渲染侧统一补空格会做错其中一种，故登记侧把
 *  该有的空格写进 tail。 */
export interface AiFlowStatField {
    hint: string;
    value: string;
    tail?: string;
}

/** 单流态的进度条（0~100；缺省=不出条）。 */
export interface AiFlowBar {
    /** 已读百分比（0~100，登记侧已 clamp）。 */
    pct: number;
    /** aria-label 用的成品文案（已取词）。 */
    label: string;
}

/** 一条在途流的登记载荷。 */
export interface AiFlowEntry {
    /** 流标识（同 id 重复 begin 不覆盖在跑的流）。 */
    id: string;
    /** 主标题（人读、已取词的成品文案，如「转换运行中」）。 */
    title: string;
    /** 副标题（范围说明，如「批量队列 ·《卷名》」；可空=只出主标题）。 */
    subtitle?: string;
    /** 流名/进度摘要（旧口径保留：无 structured 数据时的单行文案）。 */
    progress?: string;
    /** 附加统计（旧口径保留；Issue #85 起批量流改走 queue/stats）。 */
    extra?: string;
    /** 富统计行（数字可强调；可空）。 */
    stats?: AiFlowStats;
    /** 单流态进度条（queue 在场时不渲染）。 */
    bar?: AiFlowBar;
    /** 队列维度（批量流才带；在场 ⇒ 出构成条/计数行/分篇清单）。 */
    queue?: AiFlowQueue;
    /** 停止态（点击停止后、抉择之前；也用于 stopped 计数行分色）。 */
    stopped?: boolean;
    phase: AiFlowPhase;
    /** 待抉择按钮（phase=choice 时才有）。 */
    choice?: AiFlowChoice;
    /** 停止回调（既有的 AiAbort 句柄里那一层；缺省=该流不可停）。 */
    stop?: () => void;
    /** 停止钮文案键（**动作名即范围**，设计稿 Q4：批量「停止整批转换」/
     *  单篇「停止转换」；缺省=通用「停止」）。由业务域在 begin 时给，
     *  横幅不猜——按「有没有队列维度」猜会把六批流错判成「转换」。 */
    stopKey?: string;
}

/** 注册表的只读快照（渲染侧消费）。 */
export type AiFlowSnapshot = AiFlowEntry;

/** begin 的入参（id/title 必填，其余可选）。 */
export interface AiFlowBeginOptions {
    id: string;
    title: string;
    subtitle?: string;
    progress?: string;
    stop?: () => void;
    /** 停止钮文案键（同 AiFlowEntry.stopKey）。 */
    stopKey?: string;
}

/** 待抉择态的按钮（转换族专用载荷；六批流不用）。 */
export interface AiFlowChoice {
    /** 「保留已生成」。 */
    keep(): void;
    /** 「全部丢弃」。 */
    discard(): void;
}

let current: AiFlowEntry | undefined;
const listeners = new Set<() => void>();

/** 变更订阅（面板据此重渲横幅）；返回退订。 */
export function subscribeAiFlow(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function notify(): void {
    for (const fn of [...listeners]) fn();
}

/**
 * 起一条流。**已在跑时不覆盖**（先到先得；返回 false 表示本次未登记，
 * 调用方照常跑业务，只是横幅仍显示先前那条——防后来者把在跑的流的
 * 停止钮顶掉）。同 id 重复 begin 视为刷新（幂等，进度可随 begin 带）。
 */
export function beginAiFlow(opts: AiFlowBeginOptions): boolean {
    if (current && current.id !== opts.id) return false;
    current = {
        id: opts.id,
        title: opts.title,
        subtitle: opts.subtitle,
        progress: opts.progress,
        phase: "running",
        stop: opts.stop,
        stopKey: opts.stopKey,
    };
    notify();
    return true;
}

/**
 * 推进横幅载荷（Issue #85 起收结构化字段；**只覆盖本次传了的键**：undefined
 * 一律保留原值，免得某次推进漏传一个键就把构成条/统计整块擦掉）。
 * 不在途的 id 静默忽略。extra/progress 保留旧口径（六批流仍用纯文本）。
 */
export function progressAiFlow(
    id: string,
    progress?: string,
    extra?: string,
    payload?: {
        subtitle?: string;
        stats?: AiFlowStats;
        bar?: AiFlowBar;
        queue?: AiFlowQueue;
        stopped?: boolean;
    }
): void {
    if (!current || current.id !== id) return;
    current.progress = progress ?? current.progress;
    current.extra = extra ?? current.extra;
    if (!payload) {
        notify();
        return;
    }
    if (payload.subtitle !== undefined) current.subtitle = payload.subtitle;
    if (payload.stats !== undefined) current.stats = payload.stats;
    if (payload.bar !== undefined) current.bar = payload.bar;
    if (payload.queue !== undefined) current.queue = payload.queue;
    if (payload.stopped !== undefined) current.stopped = payload.stopped;
    notify();
}

/** 停止回调随流刷新（晚期接线：句柄在业务体里才拿得到时补挂）。 */
export function setAiFlowStop(id: string, stop: () => void): void {
    if (!current || current.id !== id) return;
    current.stop = stop;
    notify();
}

/** 转待抉择态（停止后不消失，改为出保留/丢弃钮）。 */
export function chooseAiFlow(id: string, progress: string | undefined, choice: AiFlowChoice): void {
    if (!current || current.id !== id) return;
    current.phase = "choice";
    current.progress = progress;
    current.stop = undefined;
    current.choice = choice;
    notify();
}

/**
 * 收口一条流（**收口段放 finally**，见文件头「end 必达」）。不在途的 id
 * 静默忽略（幂等——重复 end 无副作用，异常路径各自兜底不会互踩）。
 */
export function endAiFlow(id: string): void {
    if (!current || current.id !== id) return;
    current = undefined;
    notify();
}

/** 当前在途流快照（无则 undefined）。 */
export function aiFlowSnapshot(): AiFlowSnapshot | undefined {
    return current ? { ...current } : undefined;
}

/** 触发横幅「停止」。返回 false=无在途流/该流不可停（调用方无动作）。 */
export function stopAiFlow(): boolean {
    const stop = current?.stop;
    if (!stop) return false;
    stop();
    return true;
}

/** 测试/异常路径用：清空注册表（不通知；面板卸载后调）。 */
export function resetAiFlow(): void {
    current = undefined;
}
