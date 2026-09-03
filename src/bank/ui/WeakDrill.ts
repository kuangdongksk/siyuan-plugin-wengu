import { errText } from "./../../ui/shared";
import { Dialog } from "siyuan";
import { formOption } from "../../ui/FormHtml";
import { genIntoCollection } from "../gen/GenCore";
import type { QuestionBank } from "../data/QuestionBank";
import { appendToCollection, ensureCollection } from "../data/BankRegen";
import type { WeakTopRow, WeaknessStore } from "../data/WeaknessStore";
import { esc, fmt } from "../../ui/shared";

/**
 * 针对性生成（⑥）：从薄弱画像出发生成加练题，两种模式——
 * A 错题变式（默认，以该点错得最多的真题为模板改数字/换条件，质量稳，
 *   答案可对照原题）；B 概念辨析（依小节正文出概念/判断题，避开 AI
 *   自算答案的计算大题）。每题生成后跑一次自检（AI 重做校验答案），
 *   不过就丢弃。产物确定性注回知识点引用，落成《薄弱加练·M.d》专题。
 * 串行调用、单次上限 5 题，防 30s 超时与 token 失控。
 */

const MAX_PER_RUN = 5;

export interface WeakDrillDeps {
    t: (key: string) => string;
    bank: QuestionBank;
    weakness: WeaknessStore;
    modelId: string;
    /** 完成后刷新侧栏专题。 */
    onDone(): void;
}

export function openWeakDrill(deps: WeakDrillDeps, rows: WeakTopRow[]): void {
    const { t } = deps;
    const dialog = new Dialog({
        title: t("drillTitle"),
        width: "560px",
        content: `<div class="b3-dialog__content wengu-dialog wengu-col-dialog">
      <div class="wengu-muted">${esc(t("drillHint"))}</div>
      <div class="wengu-col-list" data-act="drill-rows"><div class="wengu-muted">…</div></div>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
        <span class="wengu-side-label">${esc(t("drillModeLabel"))}</span>
        <select class="b3-select" data-act="drill-mode">${
            formOption("variant", t("drillModeVariant"), true) + formOption("concept", t("drillModeConcept"), false)
        }</select>
        <span class="wengu-side-label">${esc(t("drillCountLabel"))}</span>
        <select class="b3-select" data-act="drill-count">${[1, 2, 3, 4, 5]
            .map((n, i) => formOption(String(n), String(n), i === 2))
            .join("")}</select>
      </div>
      <div class="wengu-status" data-act="drill-status" hidden></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="drill-cancel">${esc(t("cancel"))}</button>
      <button class="b3-button b3-button--outline" data-act="drill-ok">${esc(t("drillGenBtn"))}</button>
    </div>`,
    });
    const root = dialog.element;
    const rowsBox = root.querySelector<HTMLElement>("[data-act='drill-rows']");
    const status = root.querySelector<HTMLElement>("[data-act='drill-status']");
    const selected = new Set<string>(rows.slice(0, 3).map((r) => r.key));
    if (rowsBox) {
        rowsBox.innerHTML = rows
            .map(
                (r) =>
                    `<label class="wengu-col-row"><input type="checkbox" data-key="${esc(r.key)}"${
                        selected.has(r.key) ? " checked" : ""
                    }><span class="wengu-col-row-title" title="${esc(r.aiNote ?? r.title)}">${esc(r.title)}</span>
        <span class="wengu-meta">${esc(String(r.wrong))}</span></label>`
            )
            .join("");
        for (const cb of rowsBox.querySelectorAll<HTMLInputElement>("input[type='checkbox']")) {
            cb.addEventListener("change", () => {
                if (cb.checked) selected.add(cb.dataset.key ?? "");
                else selected.delete(cb.dataset.key ?? "");
            });
        }
    }
    const show = (text: string, kind: "ok" | "err" | "muted") => {
        if (!status) return;
        status.textContent = text;
        status.className = `wengu-status wengu-status-${kind}`;
        status.removeAttribute("hidden");
    };
    root.querySelector("[data-act='drill-cancel']")?.addEventListener("click", () => dialog.destroy());
    root.querySelector("[data-act='drill-ok']")?.addEventListener("click", () => {
        const okBtn = root.querySelector<HTMLButtonElement>("[data-act='drill-ok']");
        const picked = rows.filter((r) => selected.has(r.key));
        if (picked.length === 0) {
            show(t("weakDrillNone"), "err");
            return;
        }
        if (okBtn) okBtn.disabled = true; // 生成期间禁用防连点并发多轮 AI（同 VariantDrill，20260829 审查）
        const mode = (root.querySelector<HTMLSelectElement>("[data-act='drill-mode']")?.value ?? "variant") as
            "variant" | "concept";
        const count = Math.min(
            MAX_PER_RUN,
            Number(root.querySelector<HTMLSelectElement>("[data-act='drill-count']")?.value ?? 3) || 3
        );
        void runDrill(deps, picked, mode, count, show, dialog);
    });
}

async function runDrill(
    deps: WeakDrillDeps,
    rows: WeakTopRow[],
    mode: "variant" | "concept",
    count: number,
    show: (text: string, kind: "ok" | "err" | "muted") => void,
    dialog: Dialog
): Promise<void> {
    const { t, bank, modelId } = deps;
    if (rows.length === 0) return;
    const now = new Date();
    const title = fmt(t("drillColTitle"), { m: String(now.getMonth() + 1), d: String(now.getDate()) });
    await ensureCollection(bank, title);
    try {
        const { made } = await genIntoCollection(bank, rows, {
            title,
            mode,
            count,
            modelId,
            append: (qid) => appendToCollection(bank, title, qid),
            progress: (n, pointTitle) => show(`${t("drillRunning")} ${n}/${count} · ${pointTitle}`, "muted"),
            t,
        });
        await bank.flush();
        show(`${made} ${fmt(t("drillDone"), { t: title })}`, "ok");
        deps.onDone();
        window.setTimeout(() => dialog.destroy(), 800);
    } catch (e) {
        show(`${t("convertAiFailed")}${errText(e)}`, "err");
    }
}
