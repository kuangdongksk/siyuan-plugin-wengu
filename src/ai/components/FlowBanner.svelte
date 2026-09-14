<script lang="ts">
    import { onMount } from "svelte";
    import { Armed } from "../../ui/shared";
    import Button from "../../ui/Button.svelte";
    import { aiFlowSnapshot, stopAiFlow, subscribeAiFlow, type AiFlowSnapshot } from "../core/FlowRegistry";
    import { bannerViewOf } from "../core/FlowBannerUi";

    /**
     * 「运行中的 AI 流」横幅（Issue #77）：AI 会话面板**顶部**的流级停止面
     * ——流名 + 进度摘要 + 停止钮（两击确认）；转换流停下后转**待抉择态**
     * （保留已生成 / 全部丢弃），抉择落定横幅消失。数据源是 ai 域通用注册
     * 表 core/FlowRegistry（**不是转换专属**，六批流与转换族共用一个口），
     * 订阅制刷新；无在途流时整条不渲染。零 <style>，类名走全局 scss
     * （`.wengu-aiflow-*`）。
     */
    let { t }: { t: (k: string) => string } = $props();

    let snap: AiFlowSnapshot | undefined = $state();
    /** 停止两击确认态（3s 自动复位，同仓内两击删除惯例；不上模态框）。 */
    let armedId: string | undefined = $state();
    const arm = new Armed<string>((v) => (armedId = v));

    onMount(() => {
        const sync = (): void => {
            const next = aiFlowSnapshot();
            // 流换人/收口即复位确认态，免得确认态跨流残留
            if (next?.id !== snap?.id && armedId) arm.disarm();
            snap = next;
        };
        sync();
        return subscribeAiFlow(sync);
    });

    const view = $derived(bannerViewOf(snap, !!snap && armedId === snap.id));

    const clickStop = (): void => {
        if (!snap) return;
        if (armedId === snap.id) {
            arm.disarm();
            stopAiFlow();
            return;
        }
        arm.arm(snap.id);
    };
</script>

{#if view && snap}
    <div class="wengu-aiflow" class:is-choice={view.choosing}>
        <span class="wengu-aiflow-dot"></span>
        <span class="wengu-aiflow-name">{view.title}</span>
        {#if view.progress}
            <span class="wengu-aiflow-text">{view.progress}</span>
        {/if}
        {#if view.extra}
            <span class="wengu-aiflow-extra">{view.extra}</span>
        {/if}
        <span class="wengu-aiflow-btns">
            {#if view.stopping}
                <Button type="button" variant="outline" onclick={clickStop}>{t(view.stopKey)}</Button>
            {:else if view.choosing && snap.choice}
                <!-- 抉择落定后由**状态机**收口横幅（keep/discard 同步清快照 →
                     订阅 sync 里 end），组件不抢着 end——否则横幅先消失、
                     页内进度条还留着，两处口径分叉。 -->
                <Button type="button" variant="outline" onclick={() => snap?.choice?.keep()}>{t("aiFlowKeep")}</Button>
                <Button type="button" variant="cancel" onclick={() => snap?.choice?.discard()}
                    >{t("aiFlowDiscard")}</Button
                >
            {/if}
        </span>
    </div>
{/if}
