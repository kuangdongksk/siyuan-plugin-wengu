import { Dialog } from "siyuan";
import { formGroup, formOption, formRow, formSelect, formSwitch } from "../../ui/FormHtml";
import { esc, fmt } from "../../ui/shared";
import type { IncrementPlan, StructChunk } from "../service/SrcChunk";

/**
 * 增量重转换弹窗（增量哈希二期）：重新导入的哈希检测报告——先给检测
 * 摘要（源共几块、已入库几块未变、本次待处理几块），再逐块选——新增块
 * 默认生成（开关可关）、变更块/消失块默认保留旧题（下拉可改重生成/
 * 删除）。默认保留=省费（AI 重生成要花钱，开关交给用户）；设置页
 * convertKeepOld（省费模式）不出逐块清单，只出摘要确认（compact）——
 * 检测结果必须过目，但不用逐块点。
 */

/** 逐块选择的落定（convertIncremental 的入参原料）。 */
export interface IncrementChoice {
    /** 待生成块（新增选中 + 变更选重生成）。 */
    chunks: StructChunk[];
    /** 待删除旧记录（变更重生成的旧记录 + 消失选删除的记录）。 */
    deleteQids: string[];
    /** 保留但源已更新的旧记录（打 src-stale 标记）。 */
    staleQids: string[];
}

/** 省费模式的全保留默认选择（设置页 convertKeepOld 开时的直通口径）：
 *  新增全生成、变更/消失全保留。 */
export function keepOldChoice(plan: IncrementPlan): IncrementChoice {
    return {
        chunks: [...plan.fresh],
        deleteQids: [],
        staleQids: plan.changed.flatMap((c) => c.old.blocks).concat(...plan.removed.map((r) => r.blocks)),
    };
}

/** 块首行预览（剥标记语法，截 36 字）。 */
function excerpt(text: string): string {
    const oneLine = text
        .replace(/[#>*`\[\]()!]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return oneLine.slice(0, 36) + (oneLine.length > 36 ? "…" : "");
}

export function openIncrementDialog(deps: {
    t: (key: string) => string;
    plan: IncrementPlan;
    /** 源文档结构块总数（摘要行「源文档共 X 块」的口径）。 */
    total: number;
    /** 省费模式：不出逐块清单，只出检测摘要，确认后按全保留口径执行。 */
    compact?: boolean;
    onConfirm(choice: IncrementChoice): void;
}): void {
    const { t, plan } = deps;
    const summary = `<div class="wengu-muted">${esc(
        fmt(t("incrSummary"), {
            total: String(deps.total),
            same: String(plan.same),
            fresh: String(plan.fresh.length),
            changed: String(plan.changed.length),
            removed: String(plan.removed.length),
        })
    )}</div>${deps.compact ? `<div class="wengu-muted">${esc(t("incrCompactHint"))}</div>` : ""}`;
    const rows: string[] = [];
    if (!deps.compact) {
        if (plan.fresh.length > 0) {
            rows.push(
                formGroup(
                    fmt(t("incrNewGroup"), { n: String(plan.fresh.length) }),
                    plan.fresh
                        .map((c, i) =>
                            formRow(esc(c.key), excerpt(c.text), formSwitch(`inc-new-${i}`, true, "data-act"))
                        )
                        .join("")
                )
            );
        }
        if (plan.changed.length > 0) {
            rows.push(
                formGroup(
                    fmt(t("incrChangedGroup"), { n: String(plan.changed.length) }),
                    plan.changed
                        .map((c, i) =>
                            formRow(
                                `${esc(c.chunk.key)} · ${excerpt(c.old.key || c.chunk.key)}`,
                                excerpt(c.chunk.text),
                                formSelect(
                                    `inc-chg-${i}`,
                                    formOption("keep", t("incrKeep"), true) +
                                        formOption("regen", t("incrRegen"), false),
                                    "data-act"
                                )
                            )
                        )
                        .join("")
                )
            );
        }
        if (plan.removed.length > 0) {
            rows.push(
                formGroup(
                    fmt(t("incrRemovedGroup"), { n: String(plan.removed.length) }),
                    plan.removed
                        .map((r, i) =>
                            formRow(
                                esc(r.key || r.hash),
                                t("incrRemovedHint"),
                                formSelect(
                                    `inc-rm-${i}`,
                                    formOption("keep", t("incrKeep"), true) + formOption("del", t("incrDelete"), false),
                                    "data-act"
                                )
                            )
                        )
                        .join("")
                )
            );
        }
    }
    const dialog = new Dialog({
        title: t("incrTitle"),
        width: "620px",
        content: `<div class="b3-dialog__content wengu-dialog">
      ${summary}
      ${rows.join("")}
      <div class="wengu-status" data-act="incr-status" hidden></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="incr-cancel">${esc(t("cancel"))}</button>
      <button class="b3-button b3-button--outline" data-act="incr-ok">${esc(t("incrStart"))}</button>
    </div>`,
    });
    const root = dialog.element;
    root.querySelector("[data-act='incr-cancel']")?.addEventListener("click", () => dialog.destroy());
    root.querySelector(".b3-dialog__close")?.addEventListener("click", () => dialog.destroy());
    root.querySelector("[data-act='incr-ok']")?.addEventListener("click", () => {
        if (deps.compact) {
            dialog.destroy();
            deps.onConfirm(keepOldChoice(plan));
            return;
        }
        const choice: IncrementChoice = { chunks: [], deleteQids: [], staleQids: [] };
        plan.fresh.forEach((c, i) => {
            if (root.querySelector<HTMLInputElement>(`[data-act='inc-new-${i}']`)?.checked) choice.chunks.push(c);
        });
        plan.changed.forEach((c, i) => {
            const v = root.querySelector<HTMLSelectElement>(`[data-act='inc-chg-${i}']`)?.value;
            if (v === "regen") {
                choice.chunks.push(c.chunk);
                choice.deleteQids.push(...c.old.blocks);
            } else choice.staleQids.push(...c.old.blocks);
        });
        plan.removed.forEach((r, i) => {
            const v = root.querySelector<HTMLSelectElement>(`[data-act='inc-rm-${i}']`)?.value;
            if (v === "del") choice.deleteQids.push(...r.blocks);
            else choice.staleQids.push(...r.blocks);
        });
        dialog.destroy();
        deps.onConfirm(choice);
    });
}
