import { errText } from "./../../ui/shared";
import { agentChatOnce, aiAbort, type AiAbort } from "../../ai/client";
import { notifyError, notifyInfo } from "../../ui/Notify";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { buildRegenPrompt } from "../../ai/prompts/gen";
import { extractBlockId } from "../../convert/service/core/ConvertService";
import { hasStemPart, parseDrafts, renderUnit } from "../../convert/service/draft/QuestionDraft";
import { shuffleDraftOptions } from "../../convert/service/draft/OptionShuffle";
import { formGroup, formInput, formRow } from "../../ui/FormHtml";
import { openWenguDialog } from "../../ui/Dialog";
import { injectKnowledgeRefs, sectionKramdown } from "../../convert/service/knowledge/KnowRef";
import type { QuestionBank } from "../data/QuestionBank";
import { knowNodeText, knowTreesOf } from "../data/KnowTrees";
import { parseQuestionKramdown } from "../data/BankParse";
import { recordOf, replaceRecordKramdown } from "../data/BankRegen";
import { badMarkedQids, markBad } from "../data/BadMark";
import type { WenguQuestion } from "../../types";
import { esc } from "../../ui/shared";
import { KernelBlock } from "../../siyuan/block";

/**
 * 题卡「重新生成」（④）：题错了/OCR 坏了时按题重出。
 * 两种模式——提供原文链接（改好的原文块，含图片行）；不提供（AI 依
 * 知识点小节正文判断缺失并补全，图补不了——端点纯文本，只能从原文来）。
 * 产物确定性注回原知识点引用；题库记录替换即生效（唯一内容真相）。
 *
 * 20260905 起点击即关窗（用户定夺，弃「弹窗内转圈」阻塞态）：AI 后台
 * 跑，调用带 track 登记进 AI 会话面板（running→done 即实时进度），终态
 * 走思源通知；qid 防重入（关窗后同题再点不叠第二轮 AI）。
 */

export interface RegenDeps {
    t: (key: string) => string;
    bank: QuestionBank;
    modelId: string;
    /** 成功后刷新视图（重拉题目列表）。 */
    onDone(): void;
}

/** 在途去重（qid → 是否正在重出）。 */
const regenInFlight = new Set<string>();

/** 一次性事件委托（视图构造时调用一次，重渲染不重复绑定）：
 *  静态渲染的块引用跳转 + 题卡「重新生成」入口。 */
export function bindCardActions(
    el: HTMLElement,
    deps: {
        t(key: string): string;
        find(qid: string): WenguQuestion | undefined;
        bank?: QuestionBank;
        modelId(): string;
        reload(): void;
        /** 卡头「标记为错题」开关（Issue #46；预览模式两态切换，实现体
         *  在 quiz/flow/BadMarkFlow——本模块不依赖视图）。 */
        toggleBadMark?(qid: string): void;
    }
): void {
    el.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement;
        const ref = target.closest<HTMLElement>("[data-type='block-ref']")?.dataset.id;
        if (ref) {
            window.open(`siyuan://blocks/${ref}`);
            return;
        }
        // 「标记为错题」（Issue #46）：与 regen 钮同机制（卡 qid 反查），
        // 不做 openRegenDialog——两态切换，视图侧刷新回灌新态
        if (target.closest("[data-act='badmark']")) {
            const qid = target.closest<HTMLElement>(".wengu-card")?.dataset.qid ?? "";
            if (qid) deps.toggleBadMark?.(qid);
            return;
        }
        if (!target.closest("[data-act='regen']")) return;
        const qid = target.closest<HTMLElement>(".wengu-card")?.dataset.qid ?? "";
        const q = deps.find(qid);
        if (q && deps.bank)
            openRegenDialog({ t: deps.t, bank: deps.bank, modelId: deps.modelId(), onDone: deps.reload }, q);
    });
}

export function openRegenDialog(deps: RegenDeps, q: WenguQuestion): void {
    const { t } = deps;
    const { dialog, root } = openWenguDialog({
        title: t("regenTitle"),
        body: `
      <div class="wengu-muted">${esc(t("regenHint"))}</div>
      ${formGroup(
          t("regenTitle"),
          formRow(
              t("regenSourceLabel"),
              t("regenSourceHint"),
              formInput(
                  "regen-src",
                  "",
                  `spellcheck="false" placeholder="${esc(t("regenSourcePlaceholder"))}"`,
                  "data-act"
              )
          ) +
              formRow(
                  t("regenNoteLabel"),
                  t("regenNoteHint"),
                  formInput(
                      "regen-note",
                      "",
                      `spellcheck="false" placeholder="${esc(t("regenNotePlaceholder"))}"`,
                      "data-act"
                  )
              )
      )}
    `,
        actions: [
            { id: "regen-cancel", label: t("cancel") },
            { id: "regen-ok", label: t("regenBtn"), variant: "outline" },
        ],
    });
    const srcInput = root.querySelector<HTMLInputElement>("[data-act='regen-src']");
    const noteInput = root.querySelector<HTMLInputElement>("[data-act='regen-note']");
    root.querySelector("[data-act='regen-cancel']")?.addEventListener("click", () => dialog.destroy());
    root.querySelector("[data-act='regen-ok']")?.addEventListener("click", () => {
        // 点击即关窗：参数先收齐（input 随弹窗销毁），AI 后台跑
        const src = srcInput?.value ?? "";
        const note = noteInput?.value ?? "";
        dialog.destroy();
        startRegen(deps, q, src, note);
    });
}

function startRegen(deps: RegenDeps, q: WenguQuestion, srcRaw: string, note: string): void {
    if (regenInFlight.has(q.id)) {
        notifyInfo({ key: "regenBusy" });
        return;
    }
    regenInFlight.add(q.id);
    notifyInfo({ key: "regenStarted" });
    const stop = aiAbort(); // 面板「停止」同样可中止重出
    void runRegen(deps, q, srcRaw, note, stop).finally(() => regenInFlight.delete(q.id));
}

async function runRegen(
    deps: RegenDeps,
    q: WenguQuestion,
    srcRaw: string,
    note: string,
    stop: AiAbort,
    opts?: { quiet?: boolean }
): Promise<boolean> {
    const { t, bank, modelId } = deps;
    const record = await recordOf(bank, q.id);
    if (!record) {
        notifyError({ key: "regenNoRecord" });
        return false;
    }
    try {
        // 提供原文链接：拉原文块 kramdown；不提供：知识点小节正文（首个引用）
        let sourceBlock = "";
        const srcId = extractBlockId(srcRaw);
        if (srcId) {
            try {
                const r = await KernelBlock.kramdown(srcId);
                sourceBlock = String((r.data as { kramdown?: string } | null)?.kramdown ?? "");
            } catch (_) {
                // 原文块拉不到：按无链接模式继续
            }
        }
        const kp = record.kpRefs[0];
        const section = sourceBlock
            ? ""
            : kp
              ? (await sectionKramdown(kp.id)) || knowNodeText(await knowTreesOf(bank), kp.id)
              : "";
        const prompt = buildRegenPrompt(record.kramdown, sourceBlock, section, note, q.type);
        const stem16 = (q.stemMd ?? "").replace(/\s+/g, " ").trim().slice(0, 16);
        const reply = await agentChatOnce(prompt, modelId, AI_TIMEOUT.long, stop.signal, {
            kind: "regen",
            title: `重新生成 · ${stem16}`,
            onSid: stop.onSid,
        });
        const drafts = parseDrafts(reply).filter(hasStemPart);
        if (drafts.length === 0) throw new Error(t("convertEmptyReply"));
        shuffleDraftOptions(drafts[0]);
        let kd = renderUnit(drafts[0]);
        // 保留原容器的其余属性（q/type/steps/knowledge/chapter…），只换内容
        const oldIal = /\n(\{:[^\n]*custom-plugin-wengu-q="1"[^\n]*\})\s*$/.exec(record.kramdown)?.[1] ?? "";
        if (oldIal) {
            const tail = /\n(\{:[^\n]*custom-plugin-wengu-q="\d+"[^\n]*\})\s*$/.exec(kd);
            if (tail) kd = kd.slice(0, tail.index) + "\n" + oldIal;
        }
        kd = injectKnowledgeRefs(kd, record.kpRefs);
        const replaced = await replaceRecordKramdown(bank, q.id, kd);
        if (!replaced) throw new Error(t("regenNoRecord"));
        await bank.flush();
        if (!opts?.quiet) {
            notifyInfo({ key: "regenDone" });
            deps.onDone();
        }
        return true;
    } catch (e) {
        notifyError(stop.signal.aborted ? deps.t("aiFlowAborted") : errText(e));
        return false;
    }
}

/** 取一条记录并构造可重生成的题视图（parse-fail 记录退化：type/题干未知
 *  走全量兜底，让 AI 依原 kramdown 推断题型）。 */
async function regenViewOf(bank: QuestionBank, qid: string): Promise<WenguQuestion | undefined> {
    const record = await recordOf(bank, qid);
    if (!record) return undefined;
    const parsed = bank.parsedOf(qid, record.hash) ?? parseQuestionKramdown(record.kramdown, qid, record.sourceDocId);
    if (parsed) return parsed;
    return { id: qid, attempts: 0, wrongCount: 0, stemMd: "" };
}

/** 批量重生成（题库体检「结构损坏」直修）：逐题复用单题重出（quiet：不
 *  逐题通知/刷新，失败逐题已通知、不计成功数），终态统一通知并刷新。
 *  返回成功数；供 RepairDialog 经 launchAiFlow 调起。 */
export async function regenRecords(deps: RegenDeps, qids: string[], stop: AiAbort): Promise<number> {
    let ok = 0;
    for (const qid of qids) {
        if (stop.signal.aborted) break;
        if (regenInFlight.has(qid)) continue; // 题卡单题重出在飞：跳过防并发写冲突
        const q = await regenViewOf(deps.bank, qid);
        if (!q) continue;
        if (await runRegen(deps, q, "", "", stop, { quiet: true })) ok++;
    }
    notifyInfo({ key: "regenBatchDone", vars: { n: String(ok) } });
    deps.onDone();
    return ok;
}

/**
 * 批量重转「标记为错题」（Issue #46，预览模式顶部入口）：跨卷全局收集标记
 * 题 → 复用 regenRecords 逐题串行重出（单飞闸/进度与停止/失败通知全在既有
 * 通道，零新账）→ **成功重转的题自动清标记**（失败的保留，用户可再转）。
 * 返回成功数；供预览头钮经 launchAiFlow 调起。
 *
 * 与单题「重新生成」弹窗并发靠 regenRecords 内既有 regenInFlight 防重入
 * （在飞的题被跳过，标记保留——不会「没重转却清了标记」）。
 *
 * ⚠️ 两次刷新的次序有意为之：regenRecords 尾调 deps.onDone 时标记**尚未
 * 清**——若视图那时自行 flush（渲染前落盘），会把「已重转但仍带标记」的
 * 记录写下去（重开页签标记复活）。故本函数在它之后再清标记 + 显式 flush，
 * **flush 完成后**才发最终刷新：新内容与已清标记一起可见。
 */
export async function regenBadMarkedRecords(deps: RegenDeps, stop: AiAbort): Promise<number> {
    const qids = await badMarkedQids(deps.bank);
    if (qids.length === 0) {
        notifyInfo({ key: "regenBadNone" });
        return 0;
    }
    const ok = await regenRecords(deps, qids, stop);
    // 清标记：成功重转过的（含被驳回的题）——重出已换掉内容，标记不再适用；
    // 被 regenInFlight 跳过或被中止的保留标记，待下一轮
    let cleared = 0;
    for (const qid of qids) {
        if (stop.signal.aborted) break;
        if (await markBad(deps.bank, qid, false)) cleared++;
    }
    if (cleared > 0) await deps.bank.flush(); // 标记落盘先于刷新（防旧态被读回）
    deps.onDone(); // 最终刷新：新内容 + 已清标记一起可见
    return ok;
}
