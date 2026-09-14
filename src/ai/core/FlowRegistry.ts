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
 */

/** 横幅阶段：running=跑动中（出停止钮）；choice=待抉择（出保留/丢弃钮）。 */
export type AiFlowPhase = "running" | "choice";

/** 待抉择态的按钮（转换族专用载荷；六批流不用）。 */
export interface AiFlowChoice {
    /** 「保留已生成」。 */
    keep(): void;
    /** 「全部丢弃」。 */
    discard(): void;
}

/** 一条在途流的登记载荷。 */
export interface AiFlowEntry {
    /** 流标识（同 id 重复 begin 不覆盖在跑的流）。 */
    id: string;
    /** 流名（人读；i18n 已解析的成品文案，注册表不碰取词）。 */
    title: string;
    /** 进度摘要（流内既有 onStatus 文案透传；可空=只有流名）。 */
    progress?: string;
    /** 附加统计（可选；如批量队列六态计数，渲染侧决定怎么展示）。 */
    extra?: string;
    phase: AiFlowPhase;
    /** 待抉择按钮（phase=choice 时才有）。 */
    choice?: AiFlowChoice;
    /** 停止回调（既有的 AiAbort 句柄里那一层；缺省=该流不可停）。 */
    stop?: () => void;
}

/** 注册表的只读快照（渲染侧消费）。 */
export type AiFlowSnapshot = AiFlowEntry;

/** begin 的入参（id/title 必填，其余可选）。 */
export interface AiFlowBeginOptions {
    id: string;
    title: string;
    progress?: string;
    stop?: () => void;
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
        progress: opts.progress,
        phase: "running",
        stop: opts.stop,
    };
    notify();
    return true;
}

/** 推进进度摘要（摘要与 extra 各自可空；不在途的 id 静默忽略）。 */
export function progressAiFlow(id: string, progress?: string, extra?: string): void {
    if (!current || current.id !== id) return;
    current.progress = progress;
    current.extra = extra;
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
