<script lang="ts">
    /**
     * 题号导航栏（组件半；渲染+状态在此，滚动跟踪/追赶滚动等行为仍在
     * render/NumRail.ts 的 bindNumRail——实测调优的行为代码不随迁）。
     * **三写收敛（批次6 路线图痛点）**：初始态（numState，历史对错）/
     * 判分描色/已答态原本散在 renderNumsHtml、FlowDom.markNum、
     * AnswerFlow.markNumAnswered 三处直改 DOM，现统一为 marks 响应态，
     * 三路写入都经实例导出（setActive/markAnswered/markResult），
     * 高亮随 active 响应（旧 setActive 的 activeBtn 差分手写退役）。
     * 点击事件仍由 bindNumRail 绑定（需 scroller/chase 等视图级行为）。
     *
     * 题集分组（20260903 多集合刷）：组间渲染横线分隔行（data-start=组首
     * 题整卷下标，点击滚到该套首题，行为在 bindNumRail 绑）；横线常态
     * 短线、hover 伸展变长，套标题走原生 title（栏容器 overflow-y:auto
     * 会裁切行内浮层，原生提示不受裁）。
     */
    import type { SetGroup } from "../render/DrillUnits";

    let {
        initialStates,
        title,
        setGroups = [],
    }: {
        /** 每题初始态类名后缀（"" | wengu-num-right | wengu-num-wrong）。 */
        initialStates: string[];
        title: string;
        /** 题集分组（多集合刷；单题集一组=不出横线）。 */
        setGroups?: SetGroup[];
    } = $props();

    let active = $state(1);
    // initialStates 是挂载时一次性快照（壳重绘=卸载重挂），只读初值是本意
    // svelte-ignore state_referenced_locally
    let marks = $state<string[]>([...initialStates]);

    /** 组首题下标 → 分组（横线行插入点）。 */
    const gapAt = new Map(setGroups.map((g) => [g.start, g] as const));

    /** 滚动跟踪/点击的高亮写入（bindNumRail 调用）。 */
    export function setActive(n: number): void {
        active = n;
    }

    /** after 模式已答标记：仅中性态升级（对错态不覆盖，旧 markNumAnswered 守卫）。 */
    export function markAnswered(n: number): void {
        if (marks[n - 1] === "") marks[n - 1] = "wengu-num-answered";
    }

    /** 判分描色：对绿错红，先摘「已答」态（旧 markNum 语义）。 */
    export function markResult(n: number, ok: boolean): void {
        marks[n - 1] = ok ? "wengu-num-right" : "wengu-num-wrong";
    }
</script>

<nav class="wengu-nums" data-nums {title}>
    {#each marks as _, i (i)}
        {@const gap = gapAt.get(i)}
        {#if gap && i > 0}
            <div class="wengu-num-gap" data-start={gap.start} role="button" tabindex="0" title={gap.title}>
                <span class="wengu-num-gap-line"></span>
            </div>
        {/if}
        <button
            class="wengu-num{marks[i] ? ` ${marks[i]}` : ''}{active === i + 1 ? ' wengu-num-active' : ''}"
            data-num={i + 1}>{i + 1}</button
        >
    {/each}
</nav>
