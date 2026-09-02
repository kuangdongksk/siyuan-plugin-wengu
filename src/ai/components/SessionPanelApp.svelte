<script lang="ts">
    import { onMount, setContext } from "svelte";
    import type { QuizView } from "../../quiz";
    import { SESSION_PANEL_CTX, initialSessionPanelUi } from "../core/SessionPanelUi";
    import { SessionPanelCtl } from "../core/SessionPanelCtl";
    import { AI_INTERRUPTED, type AiSessionRecord } from "../data/AiSessions";
    import { buildSessionRows } from "../core/SessionTree";
    import { listAiModels } from "../models";
    import { svgIcon } from "../../ui/FormHtml";
    import { fmt } from "../../ui/shared";

    /**
     * AI 会话管理工作区面板根组件（四件套之一）。两栏式（20260901
     * 改版）：左栏=会话清单（类别过滤 + 状态徽标 + 两击删除，固定宽
     * 自滚），右栏=选中会话的明细（完整轮次回看——user prompt 与 ai
     * 产出都在——+ 继续追问输入条），点左侧行即切右栏内容。左栏树状
     * 分组（20260902）：一次动作触发的多次调用归并成一个可展开组行
     * （归并逻辑在 core/SessionTree 纯函数），组行=聚合状态+组名+条数，
     * 点行展开/收起子会话。登记簿本体在 data/AiSessions（全仓共享单例，
     * agentChatOnce 带 track 的调用自动登记），本组件只吃快照；挂载
     * 编排见 ai/SessionPanel.ts。零 <style>，类名走全局 scss。
     */
    let { v }: { v: QuizView } = $props();

    // svelte-ignore state_referenced_locally
    const t = v.t;
    const ui = $state(initialSessionPanelUi());
    // svelte-ignore state_referenced_locally
    const ctl = new SessionPanelCtl(ui);
    setContext(SESSION_PANEL_CTX, { ctl, ui, t });

    /** 已知类别 → i18n 键（顺序即过滤条顺序；未知类别原样显示排尾部）。 */
    const KIND_KEYS: Record<string, string> = {
        judge: "aiKindJudge",
        convert: "aiKindConvert",
        detect: "aiKindDetect",
        tag: "aiKindTag",
        route: "aiKindRoute",
        regen: "aiKindRegen",
        word: "aiKindWord",
        ask: "aiKindAsk",
    };
    const kindLabel = (k: string): string => (KIND_KEYS[k] ? t(KIND_KEYS[k]) : k);

    const modelNames = new Map(listAiModels().map((m) => [m.id, m.name]));
    const modelName = (id: string): string => modelNames.get(id) ?? (id || t("aiModelDefault"));

    const p2 = (n: number): string => String(n).padStart(2, "0");
    const fmtTime = (ts: number): string => {
        const d = new Date(ts);
        return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    };

    const STATUS_ICON: Record<AiSessionRecord["status"], string> = {
        running: "iconRefresh",
        done: "iconCheck",
        error: "iconClose",
    };
    const statusLabel = (r: AiSessionRecord): string =>
        r.status === "running" ? t("aiStatusRunning") : r.status === "done" ? t("aiStatusDone") : t("aiStatusError");
    const errText = (r: AiSessionRecord): string => (r.error === AI_INTERRUPTED ? t("aiInterrupted") : (r.error ?? ""));

    /** 快照 → 树行（同组归并 + 类别过滤，纯函数见 core/SessionTree）。 */
    const rows = $derived.by(() => buildSessionRows(ui.recs, ui.filter));
    const kinds = $derived.by(() => {
        const present = new Set(ui.recs.map((r) => r.kind));
        return [...Object.keys(KIND_KEYS).filter((k) => present.has(k)), ...[...present].filter((k) => !KIND_KEYS[k])];
    });
    const sel = $derived.by(() => ui.recs.find((r) => r.id === ui.selId));

    /** 轮次更新自动滚到底（追问回复到达时贴底可见）。 */
    let logEl: HTMLDivElement | undefined;
    $effect(() => {
        void sel?.turns.length;
        void ui.sending;
        if (logEl) logEl.scrollTop = logEl.scrollHeight;
    });

    const send = (): void => {
        if (sel) void ctl.ask(sel, ui.draft);
    };

    onMount(() => {
        void ctl.load();
        return () => ctl.destroy();
    });
</script>

{#if ui.phase === "loading"}
    <div class="wengu-ws-page"><div class="wengu-muted">{t("loading")}</div></div>
{:else}
    <div class="wengu-ws-page">
        <div class="wengu-ws-title">
            {t("aiPanelTitle")}
            <span class="wengu-ws-titlebtns">
                <button type="button" class="b3-button b3-button--outline" onclick={() => ctl.armClear()}
                    >{ui.clrArmed ? t("collectConfirm") : t("aiClear")}</button
                >
                <button type="button" class="b3-button b3-button--text" onclick={() => void ctl.load()}
                    >{t("quizRefresh")}</button
                >
            </span>
        </div>
        <div class="wengu-muted" style="margin-bottom:8px">{t("aiPanelHint")}</div>

        <div class="wengu-ai-kinds">
            <button
                type="button"
                class="b3-button b3-button--small{ui.filter === '' ? ' b3-button--main' : ' b3-button--outline'}"
                onclick={() => ctl.setFilter("")}>{t("aiKindAll")}</button
            >
            {#each kinds as k (k)}
                <button
                    type="button"
                    class="b3-button b3-button--small{ui.filter === k ? ' b3-button--main' : ' b3-button--outline'}"
                    onclick={() => ctl.setFilter(k)}>{kindLabel(k)}</button
                >
            {/each}
        </div>
        <!-- 两栏式（20260901）：左清单常驻，点行切右栏明细 -->
        <div class="wengu-ai-two">
            <div class="wengu-ai-side">
                <div class="wengu-ai-list">
                    {#if rows.length === 0}
                        <div class="wengu-muted">{t("aiEmpty")}</div>
                    {:else}
                        {#snippet sessionRow(r: AiSessionRecord, child: boolean)}
                            <div
                                class="wengu-ai-row{child ? ' is-child' : ''}{ui.selId === r.id
                                    ? ' wengu-ai-row-active'
                                    : ''}"
                                role="button"
                                tabindex="0"
                                onclick={() => ctl.select(r.id)}
                                onkeydown={(e) => {
                                    if (e.key === "Enter") ctl.select(r.id);
                                }}
                            >
                                <span class="wengu-ai-status is-{r.status}">{@html svgIcon(STATUS_ICON[r.status])}</span
                                >
                                <span class="wengu-ai-kind">{kindLabel(r.kind)}</span>
                                <span class="wengu-ai-name">{r.title}</span>
                                <span class="wengu-ai-meta">{fmtTime(r.createdAt)}</span>
                                <span class="b3-list-item__action">
                                    <button
                                        type="button"
                                        class="b3-button b3-button--text"
                                        onclick={(e) => {
                                            e.stopPropagation();
                                            ctl.armRemove(r.id);
                                        }}>{ui.rmArmed === r.id ? t("collectConfirm") : t("aiDelete")}</button
                                    >
                                </span>
                            </div>
                        {/snippet}
                        {#each rows as row (row.type === "group" ? `g:${row.id}` : row.rec.id)}
                            {#if row.type === "group"}
                                {@const open = !!ui.openGroups[row.id]}
                                <div
                                    class="wengu-ai-row is-group"
                                    role="button"
                                    tabindex="0"
                                    onclick={() => ctl.toggleGroup(row.id)}
                                    onkeydown={(e) => {
                                        if (e.key === "Enter") ctl.toggleGroup(row.id);
                                    }}
                                >
                                    <span class="wengu-ai-caret">{@html svgIcon(open ? "iconDown" : "iconRight")}</span>
                                    <span class="wengu-ai-status is-{row.status}"
                                        >{@html svgIcon(STATUS_ICON[row.status])}</span
                                    >
                                    <span class="wengu-ai-name">{row.title}</span>
                                    <span class="wengu-ai-meta"
                                        >{fmt(t("aiGroupMeta"), {
                                            n: String(row.recs.length),
                                            time: fmtTime(row.createdAt),
                                        })}</span
                                    >
                                    <span class="b3-list-item__action">
                                        <button
                                            type="button"
                                            class="b3-button b3-button--text"
                                            onclick={(e) => {
                                                e.stopPropagation();
                                                ctl.armRemoveGroup(row.id);
                                            }}
                                            >{ui.rmArmed === `g:${row.id}`
                                                ? t("collectConfirm")
                                                : t("aiDelete")}</button
                                        >
                                    </span>
                                </div>
                                {#if open}
                                    {#each row.recs as r (r.id)}
                                        {@render sessionRow(r, true)}
                                    {/each}
                                {/if}
                            {:else}
                                {@render sessionRow(row.rec, false)}
                            {/if}
                        {/each}
                    {/if}
                </div>
            </div>
            <div class="wengu-ai-pane">
                {#if sel}
                    <div class="wengu-ai-detail">
                        <div class="wengu-ai-dhead">
                            <span class="wengu-ai-kind">{kindLabel(sel.kind)}</span>
                            <span class="wengu-ai-name">{sel.title}</span>
                            <span class="wengu-ai-meta"
                                >{fmtTime(sel.createdAt)} · {modelName(sel.model)} · {statusLabel(sel)}</span
                            >
                        </div>
                        {#if sel.status === "error" && sel.error}
                            <div class="wengu-ai-err">{errText(sel)}</div>
                        {/if}
                        <div class="wengu-ai-log" bind:this={logEl}>
                            {#each sel.turns as turn, i (i)}
                                <div class="wengu-ai-turn is-{turn.role}">
                                    <div class="wengu-ai-trole">
                                        {turn.role === "user" ? t("aiRoleUser") : t("aiRoleAi")}
                                    </div>
                                    <div class="wengu-ai-ttext">{turn.text}</div>
                                </div>
                            {/each}
                            {#if ui.sending}
                                <div class="wengu-ai-turn is-ai">
                                    <div class="wengu-ai-trole">{t("aiRoleAi")}</div>
                                    <div class="wengu-ai-ttext wengu-muted">{t("aiSending")}</div>
                                </div>
                            {/if}
                        </div>
                        <div class="wengu-ai-composer">
                            <textarea
                                class="b3-text-field"
                                rows="2"
                                placeholder={t("aiContinueHint")}
                                disabled={ui.sending}
                                oninput={(e) => ctl.setDraft(e.currentTarget.value)}
                                onkeydown={(e) => {
                                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                        e.preventDefault();
                                        send();
                                    }
                                }}>{ui.draft}</textarea
                            >
                            <button
                                type="button"
                                class="b3-button b3-button--main"
                                disabled={ui.sending || !ui.draft.trim()}
                                onclick={send}>{t("aiSend")}</button
                            >
                        </div>
                        {#if ui.sendError}
                            <div class="wengu-ai-err">{ui.sendError}</div>
                        {/if}
                    </div>
                {:else}
                    <div class="wengu-ai-empty wengu-muted">{t("aiPickHint")}</div>
                {/if}
            </div>
        </div>
    </div>
{/if}
