import { errText } from "./../../ui/shared";
import { Dialog } from "siyuan";
import { agentChatOnce, newAiGroupId, type AiAbort } from "../../ai/client";
import { launchAiFlow } from "../../ai/flow";
import { notifyError, notifyInfo } from "../../ui/Notify";
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
import { knowTreesOf } from "../data/KnowTrees";
import { routeCache, routeKnowledgeCached } from "../data/RouteCache";
import { routeTextOf } from "./MatchDialog";

/**
 * 批量关联（2026-08-31）：全部登记知识文档 × 全库题。两级流水——
 * phase1 文本关联（knowledge 标签 ↔ 小节标题归一匹配，零 AI 瞬时，
 * 与「导入即关联」同一条路）；phase2 可选 AI 两级路由兜底未命中的题
 * （逐题独立会话，同 MatchDialog）。导入根后已自动跑过 phase1 的，
 * 这里再跑=增量（默认跳过已挂引用的题）。
 *
 * 20260905 起点击开始即关窗（弹窗去阻塞改造）：后台流经 launchAiFlow
 * 单飞，进度与「停止」在 AI 会话面板，终态走思源通知。
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
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="batch-cancel">${esc(t("cancel"))}</button>
      <button class="b3-button b3-button--outline" data-act="batch-ok">${esc(t("matchStart"))}</button>
    </div>`,
    });
    const root = dialog.element;
    root.querySelector("[data-act='batch-cancel']")?.addEventListener("click", () => dialog.destroy());
    root.querySelector("[data-act='batch-ok']")?.addEventListener("click", () => {
        if (convertRunActive()) {
            notifyError(deps.t("convertBusy"));
            return;
        }
        const ai = root.querySelector<HTMLInputElement>("[data-act='batch-ai']")?.checked ?? false;
        const skip = root.querySelector<HTMLInputElement>("[data-act='batch-skip']")?.checked ?? true;
        dialog.destroy(); // 点击即关窗：后台流，终态走通知
        launchAiFlow((stop) => runBatch(deps, ai, skip, stop));
    });
}

async function runBatch(deps: BatchDeps, useAi: boolean, skipLinked: boolean, stop: AiAbort): Promise<void> {
    const { t, bank, modelId } = deps;
    try {
        const roots = await knowRootsOf(bank);
        if (roots.length === 0) throw new Error(t("batchNoRoots"));
        const lex = await lexiconOfRoots(roots, await knowTreesOf(bank));
        if (lex.size === 0) throw new Error(t("matchNoIndex"));
        // phase1：文本关联（零 AI）
        const p1 = await linkBankByText(bank, lex, { skipLinked, signal: stop.signal });
        let hit = p1.hit;
        let miss = p1.miss;
        const skip = p1.skip;
        let aiHit = 0;
        // phase2：AI 兜底（可选，只跑文本未命中的题；带按题指纹缓存，
        // 未变的题重跑零 AI 调用）
        const fails: KnowRouteFail[] = [];
        const failCount = new Map<MatchFailKind, number>();
        const cache = routeCache();
        if (useAi && !stop.signal.aborted && p1.missed.length > 0) {
            const index = await buildKnowledgeIndex(roots, await knowTreesOf(bank));
            if (index.chapters.length > 0) {
                const pending: BankRecord[] = p1.missed;
                // 动作分组（AI 会话面板树归并）：本次批量关联的 AI 兜底挂同组
                const group = { id: newAiGroupId(), title: `批量关联 · ${pending.length} 题` };
                for (let i = 0; i < pending.length; i++) {
                    if (stop.signal.aborted) break;
                    const r = pending[i];
                    let refs: { id: string; title: string }[] = [];
                    try {
                        refs = await routeKnowledgeCached({
                            text: routeTextOf(r),
                            index,
                            modelId,
                            call: (m) =>
                                agentChatOnce(m, modelId, AI_TIMEOUT.quick, stop.signal, {
                                    kind: "route",
                                    title: `批量关联 · ${routeTextOf(r).replace(/\s+/g, " ").trim().slice(0, 16)}`,
                                    group,
                                    onSid: stop.onSid,
                                }),
                            onFail: (f) => fails.push(f),
                        });
                    } catch (_) {
                        // 路由失败按未命中，不阻断后续题
                    }
                    if (stop.signal.aborted) break;
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
        const summary = fmt(t("batchDone"), {
            h: String(hit),
            x: String(p1.hit),
            y: String(aiHit),
            m: String(miss),
            s: String(skip),
        });
        if (stop.signal.aborted) notifyInfo(fmt(t("matchAborted"), { h: String(hit) }));
        else if (hit === 0 && failHint) notifyError(summary + failHint);
        else notifyInfo(summary + failHint);
        deps.onDone?.();
    } catch (e) {
        notifyError(stop.signal.aborted ? t("aiFlowAborted") : errText(e));
    }
}
