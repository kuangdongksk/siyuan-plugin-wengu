import { svgIcon } from "../../ui/FormHtml";
import { openWenguDialog, type WenguDialogAction } from "../../ui/Dialog";
import { esc, fmt } from "../../ui/shared";
import { errText } from "../../ui/shared";
import { notifyError, notifyInfo } from "../../ui/Notify";
import { launchAiFlow } from "../../ai/flow";
import { regenRecords } from "./RegenDialog";
import type { QuestionBank } from "../data/QuestionBank";
import { applyBankHealth, scanBankHealth } from "../data/BankHealth";
import type { HealthAutoKind, HealthIssue, HealthScan } from "../data/BankHealth";

/**
 * 题库体检总览（20260909 自「选项挤行」单病弹窗升级为全库体检）：
 * 结构与引用一次扫完，四段呈现——引用与索引（勾选自动修复）、选项
 * 挤行（确定性拆行，预览即所得）、结构损坏（按原因归类，走题卡
 * 「重新生成」）、内容重复（同指纹多条，仅报告）。检测必过目，修复
 * 无 AI 调用；弹窗被销毁后的终态改走思源通知。
 */

export interface RepairDeps {
    t: (key: string) => string;
    bank: QuestionBank;
    /** AI 模型 id（结构损坏题批量重生成用）。 */
    modelId(): string;
    /** 成功后刷新视图（重拉面板/侧栏）。 */
    onDone(): void;
}

const ISSUE_KEY: Record<HealthIssue, string> = {
    "parse-fail": "healthParseFail",
    "no-stem": "healthNoStem",
    "no-answer": "healthNoAnswer",
    "bad-answer": "healthBadAnswer",
    "answer-range": "healthAnswerRange",
    "packed-multi": "healthPackedMulti",
    "packed-answer": "healthPackedAnswer",
    noopts: "healthNoopts",
    one: "healthOne",
    "steps-broken": "healthStepsBroken",
    "slots-broken": "healthSlotsBroken",
};

const AUTO_KEY: Record<HealthAutoKind, string> = {
    "set-dangling": "healthAutoSetDangling",
    "set-missing": "healthAutoSetMissing",
    "col-dangling": "healthAutoColDangling",
    "mat-missing": "healthAutoMatMissing",
    "mat-orphan": "healthAutoMatOrphan",
    "hash-bad": "healthAutoHashBad",
    "hashed-stale": "healthAutoHashedStale",
    "kpref-gap": "healthAutoKprefGap",
    "stats-missing": "healthAutoStatsMissing",
    "meta-drift": "healthAutoMetaDrift",
};

function section(title: string, inner: string, max: string): string {
    return `<div class="wengu-muted" style="margin-top:10px">${esc(title)}</div>
<div class="wengu-col-list" style="margin-top:4px;max-height:${max};overflow:auto">${inner}</div>`;
}

function autoRows(t: (k: string) => string, scan: HealthScan): string {
    return scan.auto
        .map(
            (r, i) => `<label class="wengu-col-row" style="display:block">
  <span style="display:flex;align-items:center;gap:6px">
    <input type="checkbox" data-auto="${i}" checked />
    <span class="wengu-col-row-title">${esc(t(AUTO_KEY[r.kind]))}</span>
    <span class="wengu-meta">×${r.count}${r.sample.length ? ` · ${esc(r.sample.join("、"))}` : ""}</span>
  </span>
</label>`
        )
        .join("");
}

function fixRows(t: (k: string) => string, scan: HealthScan): string {
    return scan.fixable
        .map(
            (r, i) => `<label class="wengu-col-row" style="display:block">
  <span style="display:flex;align-items:center;gap:6px">
    <input type="checkbox" data-fix="${i}" checked />
    <span class="wengu-col-row-title">${esc(r.stem || r.qid)}</span>
    <span class="wengu-meta">${esc(r.set || t("healthNoSet"))}</span>
    <span class="wengu-meta">${esc(fmt(t("repairNewAnswer"), { a: r.answer }))}${r.said ? ` · ${esc(fmt(t("repairSaid"), { x: r.said }))}` : ""}</span>
  </span>
  <span class="wengu-muted" style="display:block;margin:2px 0 0 22px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(
      r.opts.map((o, j) => `${String.fromCharCode(65 + j)}. ${o}`).join("　")
  )}</span>
</label>`
        )
        .join("");
}

function regenRows(t: (k: string) => string, scan: HealthScan): string {
    return scan.regen
        .map(
            (r, i) => `<label class="wengu-col-row" style="display:block">
  <span style="display:flex;align-items:center;gap:6px">
    <input type="checkbox" data-regen="${i}" checked />
    <span class="wengu-col-row-title">${esc(r.stem || r.qid)}</span>
    <span class="wengu-meta">${esc(r.set || t("healthNoSet"))} · ${esc(r.issues.map((i) => t(ISSUE_KEY[i])).join(" / "))}</span>
  </span>
</label>`
        )
        .join("");
}

function dupRows(t: (k: string) => string, scan: HealthScan): string {
    return scan.dups
        .slice(0, 50)
        .map(
            (g) => `<div class="wengu-col-row" style="display:block">
  <span class="wengu-col-row-title">${esc(g.rows[0]?.stem || g.hash)}</span>
  <span class="wengu-meta">×${g.rows.length} · ${esc(g.rows.map((r) => r.set || t("healthNoSet")).join("、"))}</span>
</div>`
        )
        .join("");
}

export async function openHealthDialog(deps: RepairDeps): Promise<void> {
    const { t, bank } = deps;
    const scan = await scanBankHealth(bank);
    if (scan.auto.length === 0 && scan.fixable.length === 0 && scan.regen.length === 0 && scan.dups.length === 0) {
        notifyInfo({ key: "repairEmpty" });
        return;
    }
    const body = `
      <div class="wengu-muted">${svgIcon("iconCheck")} ${esc(t("repairHint"))}</div>
      <div class="wengu-meta" style="margin-top:6px">${esc(
          fmt(t("repairSummary"), {
              n: String(scan.scanned),
              auto: String(scan.auto.length),
              fix: String(scan.fixable.length),
              regen: String(scan.regen.length),
              dup: String(scan.dups.length),
          })
      )}</div>
      ${scan.auto.length ? section(t("repairAutoHead"), autoRows(t, scan), "22vh") : ""}
      ${scan.fixable.length ? section(t("repairFixHead"), fixRows(t, scan), "30vh") : ""}
      ${scan.regen.length ? section(t("repairRegenHead"), regenRows(t, scan), "22vh") : ""}
      ${scan.dups.length ? section(t("repairDupHead"), dupRows(t, scan), "14vh") : ""}
      <div class="wengu-status" data-act="repair-status" hidden></div>
    `;
    const actions: WenguDialogAction[] = [
        { id: "repair-ok", label: t("repairApply"), variant: "outline" },
        { id: "repair-cancel", label: t("cancel") },
    ];
    if (scan.regen.length > 0) actions.unshift({ id: "repair-regen", label: t("repairRegenBtn") });
    const { dialog, root } = openWenguDialog({
        title: t("repairTitle"),
        width: "680px",
        body,
        actions,
    });
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
    root.querySelector<HTMLButtonElement>("[data-act='repair-regen']")?.addEventListener("click", () => {
        const picked = [...root.querySelectorAll<HTMLInputElement>("[data-regen]:checked")].map(
            (el) => scan.regen[Number(el.dataset.regen)]
        );
        if (picked.length === 0) {
            show(t("repairNonePicked"), "err");
            return;
        }
        dialog.destroy(); // 点击即关窗：批量 AI 后台跑，进度在 AI 会话面板，终态走通知
        launchAiFlow(async (stop) => {
            await regenRecords(
                { t, bank, modelId: deps.modelId(), onDone: deps.onDone },
                picked.map((r) => r.qid),
                stop
            );
        });
    });
    okBtn?.addEventListener("click", () => {
        const kinds = new Set(
            [...root.querySelectorAll<HTMLInputElement>("[data-auto]:checked")].map(
                (el) => scan.auto[Number(el.dataset.auto)].kind
            )
        );
        const picked = [...root.querySelectorAll<HTMLInputElement>("[data-fix]:checked")].map(
            (el) => scan.fixable[Number(el.dataset.fix)]
        );
        if (kinds.size === 0 && picked.length === 0) {
            show(t("repairNonePicked"), "err");
            return;
        }
        if (okBtn) okBtn.disabled = true;
        show(t("repairRunning"), "muted");
        void applyBankHealth(bank, kinds, picked)
            .then((n) => {
                show(fmt(t("repairDone"), { a: String(n.auto), f: String(n.packed) }), "ok");
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
