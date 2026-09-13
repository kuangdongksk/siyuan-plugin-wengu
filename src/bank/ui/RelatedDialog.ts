import { svgIcon } from "../../ui/FormHtml";
import { openWenguDialog } from "../../ui/Dialog";
import { KernelQuery } from "../../siyuan/query";
import { KernelDoc } from "../../siyuan/doc";
import { kpRootMap } from "../data/BankReconcile";
import type { QuestionBank } from "../data/QuestionBank";
import { collectKpRefs, questionsRelatedToDoc } from "../data/BankRegen";
import {
    hasAnswerData,
    kpIdsOf,
    qidSetOf,
    recordKeysOf,
    weakKeysOf,
    weakLinesOf,
    type RelatedRow,
    type RelatedWeakLine,
} from "../data/RelatedData";
import { ensureRelatedCollection } from "../data/LiveCols";
import { relatedAnalysisPrompt } from "../../ai/prompts/related";
import { agentChatOnce, newAiGroupId } from "../../ai/client";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { sectionKramdown } from "../../convert/service/knowledge/KnowRef";
import { renderMdHtml } from "../../ui/MdRender";
import { errText, esc, fmt } from "../../ui/shared";
import { notifyError } from "../../ui/Notify";
import type { WeakPointEntry } from "../data/WeaknessStore";

/**
 * 相关题弹窗（知识文档面板行「查看相关题」+ 思源右键「温故：查相关题目」
 * 两入口共用）：列表 + 四个联动动作（预览/开刷/回顾/AI 分析，Issue #44）。
 *
 * 联动不自造轮子——预览/开刷都走 **related 活视图专题**
 * （LiveCols.ensureRelatedCollection，id `col-related-{docId}`），与
 * KnowPanelCtl.drillNode「刷此知识点」逐字同链路：物化/对账 → 刷新侧栏
 * → switchTo → 预览/开刷工作区。题单收集与**本弹窗列表同源**
 * （RelatedQids.relatedRecordsOf，含「sourceDocId 命中但无 kpRefs」的题）
 * ——列表 = 专题题单恒一致。**不得复用 col-kp-{id}**：那条腿按 kp 键收集，
 * 口径不同会让题单与列表对不上。
 *
 * 回顾 = 错题本既有清单加一层 qid 集筛选（ReviewCtl.filterQids，与
 * docFilter 合取），详情/时间线/答案全现成，**不新做重刷**。
 *
 * AI 分析 = 一次 agentChatOnce（track kind="analyze"，AI 会话面板可回看
 * 全文），弹窗内等待渲染；关窗不中止调用。
 */
export interface RelatedViewAccess {
    t(key: string): string;
    aiModelId(): string;
    /** 薄弱画像（分析材料第三路；无则不喂该段）。pointsSync=只读快照，
     *  private all()/缓存装载不暴露给视图层。 */
    weaknessStore(): { pointsSync(): WeakPointEntry[] } | undefined;
    /** 预览入口（只读浏览不作答不计轮次）。 */
    enterPreviewMode(): void;
    /** 复习模式入口（qids=错题清单的 qid 集筛选维度）。 */
    enterReviewMode(opt: { qids?: string[] }): void;
    /** 左侧工作区切换（预览/开刷都切刷题）。 */
    switchWorkspace(ws: "drill"): void;
    /** 专题编排（物化相关题专题 + 刷新侧栏清单）。 */
    colFlowOf(): RelatedColFlowLike;
}

interface RelatedColFlowLike {
    refresh(): Promise<void>;
    refreshSide(): void;
    switchTo(id: string): void;
}

/** 弹窗会话上下文（一次性算好，列表与四个动作共用）。 */
interface RelatedCtx {
    v: RelatedViewAccess;
    bank: QuestionBank;
    docId: string;
    docTitle: string;
    rows: RelatedRow[];
}

/** 打开弹窗（blockId 可为文档/标题/任意块，先定位根文档）。
 *  v 缺省 = 视图不在场（思源右键在插件视图外触发）：列表照常、联动提示。 */
export async function openRelatedDialog(
    bank: QuestionBank,
    t: (k: string) => string,
    blockId: string,
    v?: RelatedViewAccess
): Promise<void> {
    const docId = await rootDocIdOf(blockId);
    const ctx: RelatedCtx = { v: v ?? noopAccess(t), bank, docId, docTitle: "", rows: [] };
    ctx.docTitle = await docTitleOf(docId);
    ctx.rows = await rowsOf(bank, docId);
    mountDialog(ctx);
}

/** 根文档定位（查不到就按原 id 试）。 */
async function rootDocIdOf(blockId: string): Promise<string> {
    try {
        const rows = await KernelQuery.rows<{ root_id?: string }>(
            `SELECT root_id FROM blocks WHERE id = '${blockId}' LIMIT 1`
        );
        return rows[0]?.root_id || blockId;
    } catch (_) {
        return blockId;
    }
}

/** 来源文档标题（查不到不算错：专题标题保持现值，列表/动作照常）。 */
async function docTitleOf(docId: string): Promise<string> {
    try {
        return (await KernelDoc.infoOf([docId])).get(docId)?.title ?? "";
    } catch (_) {
        return "";
    }
}

/** 相关题列表（与 related 活视图专题题单同源；记录侧顺带取分析用键）。 */
async function rowsOf(bank: QuestionBank, docId: string): Promise<RelatedRow[]> {
    const refs = await collectKpRefs(bank);
    const roots = await kpRootMap(bank, [...refs.keys()]);
    const rows = await questionsRelatedToDoc(bank, docId, roots);
    const data = await bank.all();
    return rows.map((r) => {
        const keys = recordKeysOf(data.records[r.qid]);
        return { ...r, kpIds: keys.kpIds, weakKeys: keys.weakKeys };
    });
}

/* ── 弹窗壳 ── */

/** 四动作（图标全取仓库既有/思源核心 sprite 里的 id——不自造图标 id，
 *  核心里没有的会渲染成空白）。 */
const ACTS = [
    { id: "related-preview", labelKey: "relatedPreview", icon: "iconEye" },
    { id: "related-drill", labelKey: "relatedDrill", icon: "iconRiffCard" },
    { id: "related-review", labelKey: "relatedReview", icon: "iconList" },
    { id: "related-analyze", labelKey: "relatedAnalyze", icon: "iconSparkles" },
] as const;

function mountDialog(ctx: RelatedCtx): void {
    const t = ctx.v.t;
    const { rows } = ctx;
    const items =
        rows.length > 0
            ? rows.map((r) => rowHtml(r, t)).join("")
            : `<div class="wengu-muted">${esc(t("relatedEmpty"))}</div>`;
    // 三个刷题动作需要题单（0 题无意义）；AI 分析恒可用——0 题时也能
    // 就「该文档考点 + 尚无相关题」给学习建议（prompt 侧如实说明）
    const acts = ACTS.map((a) => {
        const dead = rows.length === 0 && a.id !== "related-analyze";
        return `<button class="b3-button b3-button--outline wengu-related-act" data-act="${a.id}"${
            dead ? " disabled" : ""
        }>${svgIcon(a.icon)}${esc(t(a.labelKey))}</button>`;
    }).join("");
    const { dialog, root } = openWenguDialog({
        title: t("relatedTitle"),
        width: "640px",
        body: `
      <div class="wengu-muted">${svgIcon("iconSearch")} ${esc(t("relatedHint"))}</div>
      <div class="wengu-related-acts">${acts}</div>
      <div class="wengu-col-list wengu-related-list">${items}</div>
      <div class="wengu-related-analysis" data-ana hidden>
        <div class="wengu-related-analysis-head">${esc(t("relatedAnalyzeHead"))}</div>
        <div class="wengu-related-analysis-body" data-ana-body></div>
      </div>
    `,
        actions: [{ id: "related-close", label: t("cancel") }],
    });
    root.querySelector("[data-act='related-close']")?.addEventListener("click", () => dialog.destroy());
    for (const row of root.querySelectorAll<HTMLElement>("[data-jump]")) {
        row.addEventListener("click", () => window.open(`siyuan://blocks/${row.dataset.jump}`));
    }
    for (const btn of root.querySelectorAll<HTMLButtonElement>(".wengu-related-act")) {
        btn.addEventListener("click", () => void runAction(ctx, btn, root));
    }
}

/** 列表行（点行仍 siyuan:// 跳源块——原行为不变）。 */
function rowHtml(r: RelatedRow, t: (k: string) => string): string {
    return `<div class="wengu-col-row wengu-related-row" data-jump="${esc(r.qid)}" title="${esc(r.stem)}">
        <span class="wengu-col-row-title">${esc(r.stem || r.qid)}</span>
        <span class="wengu-meta">${esc(fmt(t("relatedStats"), { a: String(r.attempts), w: String(r.wrongCount) }))}</span>
      </div>`;
}

/* ── 四个动作 ── */

async function runAction(ctx: RelatedCtx, btn: HTMLButtonElement, root: HTMLElement): Promise<void> {
    if (btn.dataset.act === "related-analyze") return runAnalyze(ctx, btn, root);
    if (btn.dataset.act === "related-review") {
        ctx.v.enterReviewMode({ qids: [...qidSetOf(ctx.rows)] });
        return;
    }
    await openRelatedDrill(ctx, btn.dataset.act === "related-preview");
}

/** 预览/开刷：物化 related 专题（确定性 id，删了再点即重建）→ 落盘 →
 *  刷新侧栏 → 切专题 → 刷题工作区（预览再叠预览模式）。
 *  与 KnowPanelCtl.drillNode 逐字同链路。 */
async function openRelatedDrill(ctx: RelatedCtx, preview: boolean): Promise<void> {
    const { v, bank, docId, docTitle } = ctx;
    const row = await ensureRelatedCollection(bank, docId, docTitle);
    await bank.flush();
    const flow = v.colFlowOf();
    await flow.refresh();
    flow.refreshSide();
    flow.switchTo(row.id);
    v.switchWorkspace("drill");
    if (preview) v.enterPreviewMode();
}

/* ── AI 分析（弹窗内等待渲染；关窗不中止，结果在 AI 会话面板可回看） ── */

async function runAnalyze(ctx: RelatedCtx, btn: HTMLButtonElement, root: HTMLElement): Promise<void> {
    const box = root.querySelector<HTMLElement>("[data-ana]");
    const body = root.querySelector<HTMLElement>("[data-ana-body]");
    if (!box || !body || btn.disabled) return;
    const t = ctx.v.t;
    box.hidden = false;
    body.textContent = t("relatedAnalyzeLoading");
    btn.disabled = true;
    try {
        const reply = await agentChatOnce(await analyzePromptOf(ctx), ctx.v.aiModelId(), AI_TIMEOUT.quick, undefined, {
            kind: "analyze",
            title: ctx.docTitle || t("relatedTitle"),
            group: { id: newAiGroupId(), title: t("relatedAnalyzeGroup") },
        });
        body.innerHTML = renderMdHtml(reply);
    } catch (e) {
        body.textContent = fmt(t("relatedAnalyzeFail"), { msg: errText(e) });
    } finally {
        btn.disabled = false;
    }
}

/** 三路材料：文档小节正文（考点）+ 题清单（ctx.rows）+ 薄弱摘要
 *  （命中这组题聚合键的条目；零作答数据时整段省略，prompt 侧如实说明）。 */
async function analyzePromptOf(ctx: RelatedCtx): Promise<string> {
    return relatedAnalysisPrompt({
        docTitle: ctx.docTitle || ctx.docId,
        section: await sectionOfDoc(ctx),
        rows: ctx.rows,
        weak: weakLinesFor(ctx),
        hasData: hasAnswerData(ctx.rows),
    });
}

/** 考点材料：这组题引用的知识点小节正文拼串（sectionKramdown，与
 *  GenQuestion/WeakDrill 同款帮手；取不到则空段，不阻断分析）。 */
async function sectionOfDoc(ctx: RelatedCtx): Promise<string> {
    const parts: string[] = [];
    for (const id of kpIdsOf(ctx.rows).slice(0, 6)) {
        try {
            const sec = await sectionKramdown(id);
            if (sec) parts.push(sec);
        } catch (_) {
            // 单小节取不到不算错
        }
    }
    return parts.join("\n\n");
}

/** 薄弱摘要（WeaknessStore 只读快照；未装载=空，不算错）。 */
function weakLinesFor(ctx: RelatedCtx): RelatedWeakLine[] {
    const store = ctx.v.weaknessStore();
    if (!store) return [];
    const keys = weakKeysOf(ctx.rows);
    if (keys.length === 0) return [];
    return weakLinesOf(store.pointsSync(), keys);
}

/** 视图不在场（思源右键在插件视图外触发）：列表照常、联动动作提示。 */
function noopAccess(t: (k: string) => string): RelatedViewAccess {
    const busy = (): void => notifyError({ key: "relatedNoView" });
    return {
        t,
        aiModelId: () => "",
        weaknessStore: () => undefined,
        enterPreviewMode: busy,
        enterReviewMode: busy,
        switchWorkspace: busy,
        colFlowOf: () => ({ refresh: async () => undefined, refreshSide: () => undefined, switchTo: () => busy() }),
    };
}
