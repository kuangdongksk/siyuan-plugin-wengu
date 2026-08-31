import { Dialog } from "siyuan";
import { agentChatOnce } from "../../ai/client";
import { AI_TIMEOUT } from "../../ai/timeouts";
import {
    buildKnowledgeIndex,
    classifyMatchFail,
    type KnowRouteFail,
    type MatchFailKind,
} from "../../convert/service/KnowledgeLink";
import { convertRunActive } from "../../convert/service/ConvertRun";
import { formGroup, formRow, formSwitch } from "../../ui/FormHtml";
import { esc, fmt } from "../../ui/shared";
import type { BankRecord, QuestionBank } from "../data/QuestionBank";
import { knowRootsOf } from "../data/KnowRoots";
import { applyRefsToRecord, lexiconOfRoots, linkBankByText } from "../data/KnowLinkText";
import { routeCache, routeKnowledgeCached } from "../data/RouteCache";
import { routeTextOf } from "./MatchDialog";

/**
 * 批量关联（2026-08-31）：全部登记知识文档 × 全库题。两级流水——
 * phase1 文本关联（knowledge 标签 ↔ 小节标题归一匹配，零 AI 瞬时，
 * 与「导入即关联」同一条路）；phase2 可选 AI 两级路由兜底未命中的题
 * （逐题独立会话，同 MatchDialog）。导入根后已自动跑过 phase1 的，
 * 这里再跑=增量（默认跳过已挂引用的题）。
 */

export interface BatchDeps {
    t: (key: string) => string;
    bank: QuestionBank;
    /** phase2 AI 路由用模型（跟随转换侧选择）。 */
    modelId: string;
    onDone?(): void;
}

export async function openBatchLinkDialog(deps: BatchDeps): Promise<void> {
    const { t } = deps;
    const dialog = new Dialog({
        title: t("batchTitle"),
        width: "560px",
        content: `<div class="b3-dialog__content wengu-dialog">
      <div class="wengu-muted">${esc(t("batchHint"))}</div>
      ${formGroup(
          t("matchGroup"),
          formRow(t("batchAiLabel"), t("batchAiHint"), formSwitch("batch-ai", false, "data-act")) +
              formRow(t("matchSkipLabel"), t("matchSkipHint"), formSwitch("batch-skip", true, "data-act"))
      )}
      <div class="wengu-status" data-act="batch-status" hidden></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="batch-cancel">${esc(t("cancel"))}</button>
      <button class="b3-button b3-button--outline" data-act="batch-ok">${esc(t("matchStart"))}</button>
    </div>`,
    });
    const root = dialog.element;
    const status = root.querySelector<HTMLElement>("[data-act='batch-status']");
    const show = (text: string, kind: "ok" | "err" | "muted"): void => {
        if (!status || !status.isConnected) return;
        status.textContent = text;
        status.className = `wengu-status wengu-status-${kind}`;
        status.removeAttribute("hidden");
    };
    const cancelAll = (): void => {
        ctrl?.abort();
        dialog.destroy();
    };
    root.querySelector("[data-act='batch-cancel']")?.addEventListener("click", cancelAll);
    root.querySelector(".b3-dialog__close")?.addEventListener("click", () => ctrl?.abort());
    const okBtn = root.querySelector<HTMLButtonElement>("[data-act='batch-ok']");
    let running = false;
    let ctrl: AbortController | undefined;
    okBtn?.addEventListener("click", () => {
        if (running) {
            ctrl?.abort();
            return;
        }
        if (convertRunActive()) {
            show(t("convertBusy"), "err");
            return;
        }
        running = true;
        ctrl = new AbortController();
        const ai = root.querySelector<HTMLInputElement>("[data-act='batch-ai']")?.checked ?? false;
        const skip = root.querySelector<HTMLInputElement>("[data-act='batch-skip']")?.checked ?? true;
        void runBatch(deps, dialog, ai, skip, ctrl, show, okBtn, () => {
            running = false;
            ctrl = undefined;
        });
    });
}

async function runBatch(
    deps: BatchDeps,
    dialog: Dialog,
    useAi: boolean,
    skipLinked: boolean,
    ctrl: AbortController,
    show: (text: string, kind: "ok" | "err" | "muted") => void,
    okBtn: HTMLButtonElement,
    onEnd: () => void
): Promise<void> {
    const { t, bank, modelId } = deps;
    okBtn.textContent = t("matchStop");
    show(t("matchPreparing"), "muted");
    try {
        const roots = await knowRootsOf(bank);
        if (roots.length === 0) throw new Error(t("batchNoRoots"));
        const lex = await lexiconOfRoots(roots);
        if (lex.size === 0) throw new Error(t("matchNoIndex"));
        // phase1：文本关联（零 AI）
        const p1 = await linkBankByText(bank, lex, { skipLinked, signal: ctrl.signal });
        let hit = p1.hit;
        let miss = p1.miss;
        const skip = p1.skip;
        let aiHit = 0;
        // phase2：AI 兜底（可选，只跑文本未命中的题；带按题指纹缓存，
        // 未变的题重跑零 AI 调用）
        const fails: KnowRouteFail[] = [];
        const failCount = new Map<MatchFailKind, number>();
        const cache = routeCache();
        if (useAi && !ctrl.signal.aborted && p1.missed.length > 0 && dialog.element.isConnected) {
            const index = await buildKnowledgeIndex(roots);
            if (index.chapters.length > 0) {
                const pending: BankRecord[] = p1.missed;
                for (let i = 0; i < pending.length; i++) {
                    if (ctrl.signal.aborted || !dialog.element.isConnected) break;
                    const r = pending[i];
                    show(fmt(t("batchAiRunning"), { c: String(i + 1), n: String(pending.length) }), "muted");
                    let refs: { id: string; title: string }[] = [];
                    try {
                        refs = await routeKnowledgeCached({
                            text: routeTextOf(r),
                            index,
                            modelId,
                            call: (m) =>
                                agentChatOnce(m, modelId, AI_TIMEOUT.quick, ctrl.signal, {
                                    kind: "route",
                                    title: `批量关联 · ${routeTextOf(r).replace(/\s+/g, " ").trim().slice(0, 16)}`,
                                }),
                            onFail: (f) => fails.push(f),
                        });
                    } catch (_) {
                        // 路由失败按未命中，不阻断后续题
                    }
                    if (ctrl.signal.aborted) break;
                    if (refs.length > 0 && (await applyRefsToRecord(bank, r, refs))) {
                        hit++;
                        aiHit++;
                    }
                }
            }
        }
        miss = p1.missed.length > 0 ? p1.missed.length - aiHit : 0;
        await bank.flush();
        await cache?.flush();
        for (const f of fails) {
            const k = classifyMatchFail(String(f.error?.message ?? f.error ?? ""));
            failCount.set(k, (failCount.get(k) ?? 0) + 1);
        }
        const topFail = [...failCount.entries()].sort((a, b) => b[1] - a[1])[0];
        const failHint =
            hit === 0 && miss > 0 && topFail ? "\n" + fmt(t(`matchFail_${topFail[0]}`), { n: String(topFail[1]) }) : "";
        show(
            ctrl.signal.aborted
                ? fmt(t("matchAborted"), { h: String(hit) })
                : fmt(t("batchDone"), {
                      h: String(hit),
                      x: String(p1.hit),
                      y: String(aiHit),
                      m: String(miss),
                      s: String(skip),
                  }) + failHint,
            ctrl.signal.aborted ? "muted" : hit === 0 && failHint ? "err" : "ok"
        );
        if (!ctrl.signal.aborted) window.setTimeout(() => dialog.destroy(), 800);
        deps.onDone?.();
    } catch (e) {
        show(String((e as Error)?.message ?? e), "err");
    } finally {
        okBtn.textContent = t("matchStart");
        onEnd();
    }
}
