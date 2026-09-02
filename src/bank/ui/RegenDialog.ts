import { Dialog } from "siyuan";
import { agentChatOnce } from "../../ai/client";
import { notifyError, notifyInfo } from "../../ui/Notify";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { extractBlockId } from "../../convert/service/ConvertService";
import { hasStemPart, parseDrafts, protocolSpec, renderUnit } from "../../convert/service/QuestionDraft";
import { shuffleDraftOptions } from "../../convert/service/OptionShuffle";
import { formGroup, formInput, formRow } from "../../ui/FormHtml";
import { injectKnowledgeRefs, sectionKramdown } from "../../convert/service/KnowRef";
import type { QuestionBank } from "../data/QuestionBank";
import { recordOf, replaceRecordKramdown } from "../data/BankRegen";
import type { WenguQuestion } from "../../types";
import { esc } from "../../ui/shared";
import { KernelBlock } from "../../siyuan/block";

/**
 * 题卡「重新生成」（④）：题错了/OCR 坏了时按题重出。
 * 两种模式——提供原文链接（改好的原文块，含图片行）；不提供（AI 依
 * 知识点小节正文判断缺失并补全，图补不了——端点纯文本，只能从原文来）。
 * 产物确定性注回原知识点引用；题库记录替换为主，源文档块尽力同步
 * （updateBlock 单块，失败不阻断——题库是主记录）。
 */

export interface RegenDeps {
    t: (key: string) => string;
    bank: QuestionBank;
    modelId: string;
    /** 成功后刷新视图（重拉题目列表）。 */
    onDone(): void;
}

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
    }
): void {
    el.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement;
        const ref = target.closest<HTMLElement>("[data-type='block-ref']")?.dataset.id;
        if (ref) {
            window.open(`siyuan://blocks/${ref}`);
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
    const dialog = new Dialog({
        title: t("regenTitle"),
        width: "560px",
        content: `<div class="b3-dialog__content wengu-dialog">
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
      <div class="wengu-status" data-act="regen-status" hidden></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="regen-cancel">${esc(t("cancel"))}</button>
      <button class="b3-button b3-button--outline" data-act="regen-ok">${esc(t("regenBtn"))}</button>
    </div>`,
    });
    const root = dialog.element;
    const status = root.querySelector<HTMLElement>("[data-act='regen-status']");
    const okBtn = root.querySelector<HTMLButtonElement>("[data-act='regen-ok']");
    const srcInput = root.querySelector<HTMLInputElement>("[data-act='regen-src']");
    const noteInput = root.querySelector<HTMLInputElement>("[data-act='regen-note']");
    const show = (text: string, kind: "ok" | "err" | "muted") => {
        if (!status) return;
        // 弹窗已销毁（X/取消不中止在途 AI）：终态改走思源通知
        if (!status.isConnected) {
            if (kind === "err") notifyError(text);
            else if (kind === "ok") notifyInfo(text);
            return;
        }
        status.textContent = text;
        status.className = `wengu-status wengu-status-${kind}`;
        status.removeAttribute("hidden");
    };
    root.querySelector("[data-act='regen-cancel']")?.addEventListener("click", () => dialog.destroy());
    okBtn?.addEventListener("click", () => {
        void runRegen(deps, dialog, q, srcInput?.value ?? "", noteInput?.value ?? "", show, okBtn);
    });
}

async function runRegen(
    deps: RegenDeps,
    dialog: Dialog,
    q: WenguQuestion,
    srcRaw: string,
    note: string,
    show: (text: string, kind: "ok" | "err" | "muted") => void,
    okBtn?: HTMLButtonElement
): Promise<void> {
    const { t, bank, modelId } = deps;
    // 先禁用再进首个 await：原「recordOf 之后才禁用」，异步窗口内可
    // 双击并发两轮重生成（20260829 审查）
    if (okBtn) okBtn.disabled = true;
    const record = await recordOf(bank, q.id);
    if (!record) {
        show(t("regenNoRecord"), "err");
        if (okBtn) okBtn.disabled = false;
        return;
    }
    show(t("regenRunning"), "muted");
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
        const section = sourceBlock ? "" : kp ? await sectionKramdown(kp.id) : "";
        const prompt = buildRegenPrompt(record.kramdown, sourceBlock, section, note);
        const reply = await agentChatOnce(prompt, modelId, AI_TIMEOUT.long);
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
        // 源文档块尽力同步（updateBlock 单块；失败不阻断，题库为主记录）
        try {
            await KernelBlock.update({ id: q.id, dataType: "markdown", data: kd });
        } catch (_) {
            // 文档块同步失败：题库已是新内容
        }
        show(t("regenDone"), "ok");
        window.setTimeout(() => {
            dialog.destroy();
            deps.onDone();
        }, 600);
    } catch (e) {
        show(String((e as Error)?.message ?? e), "err");
        if (okBtn) okBtn.disabled = false;
    }
}

function buildRegenPrompt(kd: string, sourceBlock: string, section: string, note: string): string {
    const srcPart = sourceBlock ? `\n【修正后的原文（以此为准，图片行原样保留进题干）】\n${sourceBlock}` : "";
    const secPart = !sourceBlock && section ? `\n【相关知识点小节（补全缺失数据的依据）】\n${section}` : "";
    const notePart = note ? `\n【用户备注】\n${note}` : "";
    return `你是思源笔记的题目修复助手。下面这道题存在问题（OCR 缺失/转换错误/答案算错），请重出这一道题。
${srcPart || secPart ? "以补充材料为准修正；没有依据的部分不要编造，宁可保守。" : "依据题目自身与解析保守修复。"}${notePart}
要求：输出与原题相同的题型结构（客观题保持客观题）；公式行内 $...$、块级 $$...$$；题干依赖的图片行（![](...assets/...)）原样逐字保留；正确答案与解析必须自洽。
只输出一道题的行协议（格式如下），格式之外不要输出任何文字。
${protocolSpec()}

【原题 kramdown】
${kd}${srcPart}${secPart}${notePart}`;
}
