import { errText } from "./../../ui/shared";
import { Dialog } from "siyuan";
import { formOption } from "../../ui/FormHtml";
import { launchAiFlow } from "../../ai/flow";
import type { AiAbort } from "../../ai/client";
import { notifyError, notifyInfo } from "../../ui/Notify";
import { generateVariantOf } from "../gen/GenQuestion";
import type { QuestionBank } from "../data/QuestionBank";
import { addGenerated, recordsOfDoc } from "../data/BankRegen";
import { esc, fmt } from "../../ui/shared";

/**
 * 变式重练（docs/variant-and-doctree.md §一 V1~V4）：对整卷/仅错题以
 * 每题自己为模板生成「改数字/换条件」变式题（generateVariantOf），
 * 逐题串行（内核 AI 并发互斥），即时追加进新建的《{卷名}·变式 时间戳》
 * 专题（每次新建不续写，历史清晰），完成自动切过去开刷。
 *
 * 20260905 起点击开始即关窗（弹窗去阻塞改造）：后台流经 launchAiFlow
 * 单飞，进度与「停止」在 AI 会话面板，终态走思源通知——产物保留已落
 * 部分（中止不清偿），完成后照旧自动切专题。
 */

/** 单轮上限（与收集补题 GEN_MAX_PER_RUN 同节奏，防 token/时长失控）。 */
const VARIANT_MAX_PER_RUN = 10;

export interface VariantDrillDeps {
    t: (key: string) => string;
    bank: QuestionBank;
    /** AI 模型 id。 */
    modelId(): string;
    /** 专题创建/追加后刷新侧栏。 */
    onChanged(): void;
    /** 完成后直接切过去开刷。 */
    onSelect(collectionId: string): void;
}

export function openVariantDrillDialog(deps: VariantDrillDeps, docId: string, docTitle: string): void {
    const { t } = deps;
    const dialog = new Dialog({
        title: t("variantDrillTitle"),
        width: "520px",
        content: `<div class="b3-dialog__content wengu-dialog">
      <div class="wengu-muted">${esc(t("variantDrillHint"))}</div>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap">
        <span class="wengu-side-label">${esc(t("variantRangeLabel"))}</span>
        <select class="b3-select" data-act="vd-range">${
            formOption("all", t("variantRangeAll"), true) + formOption("wrong", t("variantRangeWrong"), false)
        }</select>
        <span class="wengu-side-label">${esc(t("drillCountLabel"))}</span>
        <select class="b3-select" data-act="vd-count">${Array.from({ length: VARIANT_MAX_PER_RUN }, (_, i) =>
            formOption(String(i + 1), String(i + 1), i === VARIANT_MAX_PER_RUN - 1)
        ).join("")}</select>
        <button class="b3-button b3-button--outline" data-act="vd-start">${esc(t("variantStart"))}</button>
      </div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="vd-close">${esc(t("cancel"))}</button>
    </div>`,
    });
    const root = dialog.element;
    root.querySelector("[data-act='vd-close']")?.addEventListener("click", () => dialog.destroy());
    root.querySelector("[data-act='vd-start']")?.addEventListener("click", () => {
        const range = (root.querySelector<HTMLSelectElement>("[data-act='vd-range']")?.value ?? "all") as
            "all" | "wrong";
        const count = Math.min(
            VARIANT_MAX_PER_RUN,
            Number(root.querySelector<HTMLSelectElement>("[data-act='vd-count']")?.value ?? VARIANT_MAX_PER_RUN) ||
                VARIANT_MAX_PER_RUN
        );
        dialog.destroy(); // 点击即关窗：后台流，终态走通知
        launchAiFlow((stop) => runVariantDrill(deps, docId, docTitle, range, count, stop));
    });
}

/** Fisher-Yates 洗牌（整卷时随机抽样，避免每轮都变前 N 题）。 */
function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

async function runVariantDrill(
    deps: VariantDrillDeps,
    docId: string,
    docTitle: string,
    range: "all" | "wrong",
    count: number,
    stop: AiAbort
): Promise<void> {
    const { t, bank } = deps;
    try {
        const records = await recordsOfDoc(bank, docId);
        const pool = shuffle(range === "wrong" ? records.filter((r) => r.stats.wrongCount > 0) : records).slice(
            0,
            count
        );
        if (pool.length === 0) {
            notifyError({ key: "variantEmpty" });
            return;
        }
        const stamp = new Date();
        const pad = (n: number) => String(n).padStart(2, "0");
        const title = `${docTitle}·变式 ${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(
            stamp.getHours()
        )}:${pad(stamp.getMinutes())}`;
        const col = await bank.createCollection(title, [], "manual");
        deps.onChanged();
        let made = 0;
        for (let i = 0; i < pool.length; i++) {
            if (stop.signal.aborted) break;
            const r = pool[i];
            const kd = await generateVariantOf(r.kramdown, deps.modelId(), stop);
            if (!kd) continue; // 单题失败/不过检跳过，不中断整轮
            const qid = await addGenerated(
                bank,
                kd,
                r.kpRefs.map((k) => ({ id: k.id, title: k.title })),
                title
            );
            await bank.appendQidToCollection(col.id, qid);
            made++;
            deps.onChanged();
        }
        await bank.flush();
        if (made === 0 && !stop.signal.aborted) {
            notifyError({ key: "variantAllFailed" });
            await bank.deleteCollection(col.id);
            await bank.flush();
            deps.onChanged();
            return;
        }
        if (stop.signal.aborted && made === 0) {
            // 中止且零产物：空壳专题回收，静默退场
            await bank.deleteCollection(col.id);
            await bank.flush();
            deps.onChanged();
            notifyInfo({ key: "aiFlowAborted" });
            return;
        }
        if (stop.signal.aborted) notifyInfo({ key: "aiFlowAborted" });
        else notifyInfo(fmt(t("variantDone"), { n: String(made) }));
        deps.onSelect(col.id);
    } catch (e) {
        notifyError(stop.signal.aborted ? t("aiFlowAborted") : `${t("convertAiFailed")}${errText(e)}`);
    }
}
