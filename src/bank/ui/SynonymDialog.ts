import { Armed, esc, fmt } from "../../ui/shared";
import { openWenguDialog } from "../../ui/Dialog";
import { notifyInfo } from "../../ui/Notify";
import { knowSynonyms, type KnowSynonymEntry } from "../data/KnowSynonyms";

/**
 * 同义词表查看/清空（20260910，Issue #3）：AI 同义判定的沉淀物必须
 * 可见可清——一次错判否则被永久固化（表是查表命中的前置层）。列表按
 * 写回时间倒序列出「标签 → 规范词」（判否的行显示「不同义」），底部
 * 「清空」两击确认后整表重置（清空后词对重新过 AI）。
 *
 * 表在 AI 判定后由弹窗自动写回，无需手动维护；此弹窗只做查看与重置。
 */

export interface SynonymDeps {
    t: (key: string) => string;
}

export async function openSynonymDialog(deps: SynonymDeps): Promise<void> {
    const { t } = deps;
    const store = knowSynonyms();
    const rows = store ? await store.list() : [];
    const { dialog, root } = openWenguDialog({
        title: t("synTitle"),
        extraCls: "wengu-syn-dialog",
        body: `
      <div class="wengu-muted">${esc(fmt(t("synHint"), { n: String(rows.length) }))}</div>
      <div class="wengu-syn-list" data-act="syn-list">${
          rows.length > 0
              ? rows.map((e) => rowHtml(e, t)).join("")
              : `<div class="wengu-muted">${esc(t("synEmpty"))}</div>`
      }</div>
    `,
        actions: [
            { id: "syn-cancel", label: t("cancel") },
            { id: "syn-clear", label: t("synClear") },
        ],
    });
    root.querySelector("[data-act='syn-cancel']")?.addEventListener("click", () => dialog.destroy());
    // 清空=两击确认（首击变红「确认清空」，3s 复原），清掉后关窗。
    // 武装态走公共底座 Armed（同专题/转换条口径，3s 自动复位）：armed 值
    // 即按钮本身，判据走类名（apply 是唯一写入者）。
    // ⚠️ apply 必须**双向写态**：底座 `arm()` 进门先 `disarm()` 一次，单向
    // apply（只管还原）会把首击刚置上的文案与类当场抹掉，复击永不成立
    // （20260915 复核实测）。
    const clearBtn = root.querySelector<HTMLButtonElement>("[data-act='syn-clear']");
    const arm = new Armed<HTMLButtonElement>((btn) => {
        const target = btn ?? clearBtn;
        if (!target) return;
        target.textContent = btn ? t("synClearConfirm") : t("synClear");
        target.classList.toggle("wengu-syn-armed", !!btn);
    });
    clearBtn?.addEventListener("click", () => {
        if (!clearBtn.classList.contains("wengu-syn-armed")) {
            arm.arm(clearBtn);
            return;
        }
        arm.disarm();
        void store
            ?.clear()
            .then(() => notifyInfo({ key: "synCleared" }))
            .catch((): void => notifyInfo({ key: "synCleared" }));
        dialog.destroy();
    });
}

/** 一行：标签 → 规范词（判否=「不同义」）+ 来源徽标。 */
function rowHtml(e: KnowSynonymEntry, t: (key: string) => string): string {
    const target = e.canonical ? e.canonical : t("synNo");
    return `<div class="wengu-syn-row">
  <span class="wengu-syn-raw" title="${esc(e.raw)}">${esc(e.raw)}</span>
  <span class="wengu-syn-arrow">→</span>
  <span class="wengu-syn-canon${e.canonical ? "" : " wengu-syn-no"}" title="${esc(target)}">${esc(target)}</span>
  <span class="wengu-badge">${esc(e.source === "manual" ? t("synManual") : t("synAi"))}</span>
</div>`;
}
