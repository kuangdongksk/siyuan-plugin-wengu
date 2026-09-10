import type { QuestionBank } from "../../bank/data/QuestionBank";
import { openVariantDrillDialog } from "../../bank/ui/VariantDrill";
import { openTagDialog } from "../../bank/ui/TagDialog";
import type { CollectionFlow } from "../../bank";
import type { WenguDoc } from "../../types";

/**
 * 目录文档右键的**弹窗类**动作（Issue #12 外移，index.ts 压回红线）：
 * 变式重练 / 生成标签。原先平铺在 QuizView 上——每项都要 `docs.find` +
 * bank 门控 + 弹窗入参组装，属「编排外的业务动作」而非视图状态访问器，
 * 外移不破坏内聚（与 AnswerMirror 同批）。重新导入/删除题集直接转调
 * DocOps，仍留 index.ts 一行。
 */

/** 弹窗类动作所需视图能力（QuizView 提供薄实现）。 */
export interface DocActionCtx {
    docs(): WenguDoc[];
    bank(): QuestionBank | undefined;
    modelId(): string;
    colFlow(): CollectionFlow;
}

/** 右键「变式重练」（V2）：整卷/仅错题按题生成变式专题。 */
export function variantDrillAction(ctx: DocActionCtx, docId: string, t: (k: string) => string): void {
    const doc = ctx.docs().find((d) => d.id === docId);
    const bank = ctx.bank();
    if (!doc || !bank) return;
    openVariantDrillDialog(
        {
            t,
            bank,
            modelId: () => ctx.modelId(),
            onChanged: () =>
                void ctx
                    .colFlow()
                    .refresh()
                    .then(() => ctx.colFlow().refreshSide()),
            onSelect: (id) => ctx.colFlow().switchTo(id),
        },
        docId,
        doc.title
    );
}

/** 右键「生成标签」：已有标签核对挂引用、缺失标签 AI 生成。 */
export function genTagsAction(ctx: DocActionCtx, docId: string, t: (k: string) => string): void {
    const doc = ctx.docs().find((d) => d.id === docId);
    const bank = ctx.bank();
    if (!doc || !bank) return;
    void openTagDialog({ t, bank, modelId: ctx.modelId(), docId, docTitle: doc.title });
}
