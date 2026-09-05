import { Dialog } from "siyuan";
import { svgIcon } from "../../ui/FormHtml";
import { esc, fmt } from "../../ui/shared";
import { errText } from "../../ui/shared";
import { notifyError, notifyInfo } from "../../ui/Notify";
import type { QuestionBank } from "../data/QuestionBank";
import { applyOptionRepairs, scanOptionRepairs, type OptionRepairRegenReason } from "../data/BankRepair";

/**
 * 题库体检 · 选项挤行（20260905）：专题工作区头部入口。检测必过目——
 * 先出摘要与逐题预览（拆出的选项、拟答字母、解析提及字母），勾选后
 * 确定性修复（预览即所得，无 AI 调用）；不可推导的（多选挤行等）列出
 * 原因，走题卡「重新生成」。弹窗被销毁后的终态改走思源通知。
 */

export interface RepairDeps {
    t: (key: string) => string;
    bank: QuestionBank;
    /** 成功后刷新视图（重拉面板/侧栏）。 */
    onDone(): void;
}

const WHY_KEY: Record<OptionRepairRegenReason, string> = {
    "packed-multi": "repairWhyMulti",
    answer: "repairWhyAnswer",
    noopts: "repairWhyNoopts",
    one: "repairWhyOne",
};

export async function openRepairDialog(deps: RepairDeps): Promise<void> {
    const { t, bank } = deps;
    const scan = await scanOptionRepairs(bank);
    if (scan.fixable.length === 0 && scan.regen.length === 0) {
        notifyInfo({ key: "repairEmpty" });
        return;
    }
    const fixRows = scan.fixable
        .map(
            (r, i) => `<label class="wengu-col-row" style="display:block">
  <span style="display:flex;align-items:center;gap:6px">
    <input type="checkbox" data-fix="${i}" checked />
    <span class="wengu-col-row-title">${esc(r.stem || r.qid)}</span>
    <span class="wengu-meta">${esc(r.set)}</span>
    <span class="wengu-meta">${esc(fmt(t("repairNewAnswer"), { a: r.answer }))}${r.said ? ` · ${esc(fmt(t("repairSaid"), { x: r.said }))}` : ""}</span>
  </span>
  <span class="wengu-muted" style="display:block;margin:2px 0 0 22px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(
      r.opts.map((o, j) => `${String.fromCharCode(65 + j)}. ${o}`).join("　")
  )}</span>
</label>`
        )
        .join("");
    const regenRows = scan.regen
        .map(
            (r) => `<div class="wengu-col-row" style="display:block">
  <span class="wengu-col-row-title">${esc(r.stem || r.qid)}</span>
  <span class="wengu-meta">${esc(r.set)} · ${esc(t(WHY_KEY[r.reason]))}</span>
</div>`
        )
        .join("");
    const dialog = new Dialog({
        title: t("repairTitle"),
        width: "640px",
        content: `<div class="b3-dialog__content wengu-dialog">
      <div class="wengu-muted">${svgIcon("iconCheck")} ${esc(t("repairHint"))}</div>
      <div class="wengu-meta" style="margin-top:6px">${esc(
          fmt(t("repairSummary"), {
              n: String(scan.scanned),
              fix: String(scan.fixable.length),
              regen: String(scan.regen.length),
          })
      )}</div>
      ${fixRows ? `<div class="wengu-col-list" style="margin-top:8px;max-height:46vh;overflow:auto">${fixRows}</div>` : ""}
      ${regenRows ? `<div class="wengu-muted" style="margin-top:10px">${esc(t("repairRegenHead"))}</div><div class="wengu-col-list" style="margin-top:4px;max-height:18vh;overflow:auto">${regenRows}</div>` : ""}
      <div class="wengu-status" data-act="repair-status" hidden></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="repair-cancel">${esc(t("cancel"))}</button>
      <button class="b3-button b3-button--outline" data-act="repair-ok">${esc(t("repairApply"))}</button>
    </div>`,
    });
    const root = dialog.element;
    const status = root.querySelector<HTMLElement>("[data-act='repair-status']");
    const okBtn = root.querySelector<HTMLButtonElement>("[data-act='repair-ok']");
    const show = (text: string, kind: "ok" | "err" | "muted"): void => {
        if (!status) return;
        if (!status.isConnected) {
            // 弹窗已销毁（X/取消不中止在途执行）：终态改走思源通知
            if (kind === "err") notifyError(text);
            else if (kind === "ok") notifyInfo(text);
            return;
        }
        status.textContent = text;
        status.className = `wengu-status wengu-status-${kind}`;
        status.removeAttribute("hidden");
    };
    root.querySelector("[data-act='repair-cancel']")?.addEventListener("click", () => dialog.destroy());
    okBtn?.addEventListener("click", () => {
        const picked = [...root.querySelectorAll<HTMLInputElement>("[data-fix]:checked")].map(
            (el) => scan.fixable[Number(el.dataset.fix)]
        );
        if (picked.length === 0) {
            show(t("repairNonePicked"), "err");
            return;
        }
        if (okBtn) okBtn.disabled = true;
        show(fmt(t("repairRunning"), { n: String(picked.length) }), "muted");
        void applyOptionRepairs(bank, picked)
            .then((n) => {
                show(fmt(t("repairDone"), { n: String(n) }), "ok");
                window.setTimeout(() => {
                    dialog.destroy();
                    deps.onDone();
                }, 600);
            })
            .catch((e: unknown) => {
                show(errText(e), "err");
                if (okBtn) okBtn.disabled = false;
            });
    });
}
