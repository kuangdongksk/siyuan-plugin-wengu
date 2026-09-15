import { errText } from "./../../ui/shared";
import { agentChatOnce, aiAbort, newAiGroupId, type AiAbort } from "../../ai/client";
import { notifyError, notifyInfo } from "../../ui/Notify";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { buildRegenPrompt, verifyPrompt } from "../../ai/prompts/gen";
import { reseatAnswer } from "../gen/RegenVerify";
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
import { badMarkedQids, unmarkMany } from "../data/BadMark";
import type { WenguQuestion } from "../../types";
import { aiTitle, esc } from "../../ui/shared";
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
 *
 * **答案核查**（Issue #123，20260915 真机实录）：本链原先「解析→洗牌→
 * 落盘」全程无核查，AI 按「正确项写最前」重排选项却照抄原题旧答案字母
 * 时，坏答案直接入库。三条口径：
 *   1. prompt 走 `order:"keep"`（选项沿用原题顺序与字母，见
 *      `protocol.ts` 的 ProtocolOptsOrder），从源头消掉顺序冲突；
 *   2. `reseatAnswer` 再用原题正确项**文本**在新选项里定位、按命中位置
 *      校正 ans 字母（折行/标签/全角空白差异走 optionComparable 归一），
 *      先校正再洗牌，字母映射保持自洽；
 *   3. 文本定位不到（选项被改写）→ 走 `verifyPrompt` 独立会话自检
 *      （口径同 `GenQuestion.genWithVerify`：同组、标「自检」后缀），
 *      no 则整题放弃、**不落盘**（报错走既有 errText 通道）。
 *  `runRegen` 是题卡单题与 RepairDialog 批量修复/regenBadMarkedRecords 的
 *  共用入口，两入口同样受益（不需要两份实现）。
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
        // prompt 用 keep 变体：选项沿用原题顺序与字母（Issue #123）
        const prompt = buildRegenPrompt(record.kramdown, sourceBlock, section, note, q.type, "keep");
        const stem16 = (q.stemMd ?? "").replace(/\s+/g, " ").trim().slice(0, 16);
        const group = { id: newAiGroupId(), title: `重新生成 · ${stem16}` };
        const reply = await agentChatOnce(prompt, modelId, AI_TIMEOUT.long, stop.signal, {
            kind: "regen",
            title: aiTitle(deps.t, "aiTitleRegen", { name: stem16 }),
            group,
            onSid: stop.onSid,
        });
        const drafts = parseDrafts(reply).filter(hasStemPart);
        if (drafts.length === 0) throw new Error(t("convertEmptyReply"));
        const draft = drafts[0];
        // 核查：原题正确项文本 → 新选项位置 → 校正 ans 字母（先校正再洗牌）
        const verdict = reseatAnswer(draft, q);
        if (verdict.kind === "mismatch") {
            // 文本定位不到（选项被改写）：独立会话 AI 自检，no 则整题放弃
            const check = await agentChatOnce(verifyPrompt(renderUnit(draft)), modelId, AI_TIMEOUT.mid, stop.signal, {
                kind: "regen",
                title: `${group.title} · 自检`,
                group,
                onSid: stop.onSid,
            });
            if (!/VERIFY\s*[:：]\s*(yes|是)/i.test(check)) throw new Error(t("regenVerifyFailed"));
        }
        shuffleDraftOptions(draft);
        let kd = renderUnit(draft);
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
 *  返回成功数；供 RepairDialog 经 launchAiFlow 调起。
 *
 *  `onResult`（可选）逐题回报成败——批量重转据此**只清真正重转成功**的
 *  标记（失败/被中止/防重入跳过的一律保留）；返回值只有总数，区分不出
 *  是哪几题，故必须逐题回传，别在调用侧按清单整体清（Issue #46 验收 4）。 */
export async function regenRecords(
    deps: RegenDeps,
    qids: string[],
    stop: AiAbort,
    onResult?: (qid: string, ok: boolean) => void
): Promise<number> {
    let ok = 0;
    for (const qid of qids) {
        if (stop.signal.aborted) break;
        if (regenInFlight.has(qid)) {
            onResult?.(qid, false); // 题卡单题重出在飞：跳过防并发写冲突
            continue;
        }
        const q = await regenViewOf(deps.bank, qid);
        if (!q) {
            onResult?.(qid, false);
            continue;
        }
        const done = await runRegen(deps, q, "", "", stop, { quiet: true });
        if (done) ok++;
        onResult?.(qid, done);
    }
    notifyInfo({ key: "regenBatchDone", vars: { n: String(ok) } });
    deps.onDone();
    return ok;
}

/**
 * 批量重转「标记为错题」（Issue #46，预览模式顶部入口）：跨卷全局收集标记
 * 题 → 复用 regenRecords 逐题串行重出（单飞闸/进度与停止/失败通知全在既有
 * 通道，零新账）→ **只有真正重转成功的题自动清标记**，失败/被中止/防重入
 * 跳过的一律保留（用户可再转）。返回成功数；供预览头钮经 launchAiFlow 调起。
 *
 * 与单题「重新生成」弹窗并发靠 regenRecords 内既有 regenInFlight 防重入
 * （在飞的题被跳过，**标记保留**——不会「没重转却清了标记」）。
 *
 * ⚠️ 刷新只发一次（末尾那发）：regenRecords 内部还会调一次 deps.onDone，
 * 那时标记尚未清——让视图在那时重渲染就会出现「内容已换、标记还在」的
 * 中间态闪一下（重开页签标记复活同理）。故本函数把内部那发换成空动作，
 * 清标记 + 显式 flush 落盘后才发最终刷新：新内容与已清标记一起可见。
 */
export async function regenBadMarkedRecords(deps: RegenDeps, stop: AiAbort): Promise<number> {
    const qids = await badMarkedQids(deps.bank);
    if (qids.length === 0) {
        notifyInfo({ key: "regenBadNone" });
        return 0;
    }
    const succeeded: string[] = [];
    const ok = await regenRecords({ ...deps, onDone: () => undefined }, qids, stop, (qid, one) => {
        if (one) succeeded.push(qid);
    });
    const cleared = await unmarkMany(deps.bank, succeeded); // 仅成功那批
    if (cleared > 0) await deps.bank.flush(); // 标记落盘先于刷新（防旧态被读回）
    deps.onDone(); // 最终刷新：新内容 + 已清标记一起可见
    return ok;
}
