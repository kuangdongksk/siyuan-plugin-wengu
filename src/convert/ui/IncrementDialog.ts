import { Dialog } from "siyuan";
import { formGroup, formOption, formRow, formSelect, formSwitch } from "../../ui/FormHtml";
import { esc, fmt } from "../../ui/shared";
import type { IncrementPlan, StructChunk } from "../service/SrcChunk";

/**
 * 增量重转换弹窗（增量哈希二期）：重新导入检测到源文档有变更时，把
 * 三态分类结果列给用户逐块选——新增块默认生成（开关可关）、变更块/
 * 消失块默认保留旧题（下拉可改重生成/删除）。默认保留=省费（AI 重生成
 * 要花钱，开关交给用户）；「全部保留」的整卷省费模式在设置页
 * （convertKeepOld，跳过本弹窗只补新增）。
 */

/** 逐块选择的落定（convertIncremental 的入参原料）。 */
export interface IncrementChoice {
    /** 待生成块（新增选中 + 变更选重生成）。 */
    chunks: StructChunk[];
    /** 待删除旧块（变更重生成的旧块 + 消失选删除的块）。 */
    deleteBlockIds: string[];
    /** 保留但源已更新的旧块（打 src-stale 标记）。 */
    staleBlockIds: string[];
}

/** 省费模式的全保留默认选择（设置页 convertKeepOld 开时的直通口径）：
 *  新增全生成、变更/消失全保留。 */
export function keepOldChoice(plan: IncrementPlan): IncrementChoice {
    return {
        chunks: [...plan.fresh],
        deleteBlockIds: [],
        staleBlockIds: plan.changed.flatMap((c) => c.old.blocks).concat(...plan.removed.map((r) => r.blocks)),
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
    onConfirm(choice: IncrementChoice): void;
}): void {
    const { t, plan } = deps;
    const rows: string[] = [];
    if (plan.fresh.length > 0) {
        rows.push(
            formGroup(
                fmt(t("incrNewGroup"), { n: String(plan.fresh.length) }),
                plan.fresh
                    .map((c, i) => formRow(esc(c.key), excerpt(c.text), formSwitch(`inc-new-${i}`, true, "data-act")))
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
                                formOption("keep", t("incrKeep"), true) + formOption("regen", t("incrRegen"), false),
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
    const dialog = new Dialog({
        title: t("incrTitle"),
        width: "620px",
        content: `<div class="b3-dialog__content wengu-dialog">
      <div class="wengu-muted">${esc(fmt(t("incrHint"), { n: String(plan.same) }))}</div>
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
        const choice: IncrementChoice = { chunks: [], deleteBlockIds: [], staleBlockIds: [] };
        plan.fresh.forEach((c, i) => {
            if (root.querySelector<HTMLInputElement>(`[data-act='inc-new-${i}']`)?.checked) choice.chunks.push(c);
        });
        plan.changed.forEach((c, i) => {
            const v = root.querySelector<HTMLSelectElement>(`[data-act='inc-chg-${i}']`)?.value;
            if (v === "regen") {
                choice.chunks.push(c.chunk);
                choice.deleteBlockIds.push(...c.old.blocks);
            } else choice.staleBlockIds.push(...c.old.blocks);
        });
        plan.removed.forEach((r, i) => {
            const v = root.querySelector<HTMLSelectElement>(`[data-act='inc-rm-${i}']`)?.value;
            if (v === "del") choice.deleteBlockIds.push(...r.blocks);
            else choice.staleBlockIds.push(...r.blocks);
        });
        dialog.destroy();
        deps.onConfirm(choice);
    });
}
