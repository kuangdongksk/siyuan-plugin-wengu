import { errText } from "./../../ui/shared";
import { Dialog } from "siyuan";
import { formOption, svgIcon } from "../../ui/FormHtml";
import { launchAiFlow } from "../../ai/flow";
import type { AiAbort } from "../../ai/client";
import { notifyError, notifyInfo } from "../../ui/Notify";
import { genIntoCollection } from "../gen/GenCore";
import type { CollectionRow, KnowledgeRow, QuestionBank } from "../data/QuestionBank";
import { recordOf } from "../data/BankRegen";
import { esc } from "../../ui/shared";

/**
 * 专题管理对话框：上半=按知识点收集（勾选知识点键 → 并集收集成新
 * 专题，或「收集并补题」按缺口 AI 生成补入），下半=已有专题（点击
 * 切换、展开移除单题、两击确认删除）。知识点索引来自题库记录
 * （kp 引用优先，降级 knowledge/chapter），迁移完成前可能为空。
 *
 * 「收集并补题」20260905 起点击即关窗（弹窗去阻塞改造）：后台流经
 * launchAiFlow 单飞，进度与「停止」在 AI 会话面板，终态走思源通知，
 * 完成自动切新专题；纯收集（无 AI）保持窗内即时完成。
 */

export interface CollectionDialogDeps {
    t: (key: string) => string;
    bank: QuestionBank;
    /** AI 模型 id（收集并补题用）。 */
    modelId(): string;
    /** 来源文档 id → 标题（展开题目列表的来源卷名尾注）。 */
    docTitle(docId: string): string;
    /** 专题变化（新建/删除/移题）后刷新侧栏。 */
    onChanged(): void;
    /** 已有专题内容被编辑后（活跃专题需重载视图）。 */
    onEdited(collectionId: string): void;
    /** 创建/点击后直接切过去开刷。 */
    onSelect(collectionId: string): void;
    /** 预勾知识点（知识树节点行「针对此节点生成」入口）：不在索引里
     *  的键（0 题节点）合成 0 计数行展示，生成点位同样包含它们。 */
    preset?: { key: string; title: string }[];
}

/** 单次补题上限（串行 AI 调用，防 token/时长失控）。 */
const GEN_MAX_PER_RUN = 10;

export function openCollectionDialog(deps: CollectionDialogDeps): void {
    const { t, bank } = deps;
    const dialog = new Dialog({
        title: t("collectionsTitle"),
        width: "560px",
        content: `<div class="b3-dialog__content wengu-dialog wengu-col-dialog">
      <div class="wengu-muted">${esc(t("collectHint"))}</div>
      <div class="wengu-col-list" data-act="col-knowledge"><div class="wengu-muted">…</div></div>
      <div class="wengu-col-new">
        <input class="wengu-input" data-act="col-title" spellcheck="false"
          placeholder="${esc(t("collectTitlePlaceholder"))}">
        <button class="b3-button b3-button--outline" data-act="col-create">${esc(t("collectCreate"))}</button>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap">
        <span class="wengu-side-label">${esc(t("drillModeLabel"))}</span>
        <select class="b3-select" data-act="col-gen-mode">${
            formOption("variant", t("drillModeVariant"), true) + formOption("concept", t("drillModeConcept"), false)
        }</select>
        <span class="wengu-side-label">${esc(t("drillCountLabel"))}</span>
        <select class="b3-select" data-act="col-gen-count">${Array.from({ length: GEN_MAX_PER_RUN }, (_, i) =>
            formOption(String(i + 1), String(i + 1), i === 4)
        ).join("")}</select>
        <button class="b3-button b3-button--outline" data-act="col-gen">${esc(t("collectGenBtn"))}</button>
      </div>
      <div class="wengu-side-label" style="margin-top:12px">${esc(t("collectExisting"))}</div>
      <div class="wengu-col-list" data-act="col-existing"><div class="wengu-muted">…</div></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="col-close">${esc(t("cancel"))}</button>
    </div>`,
    });
    const root = dialog.element;
    const knowledgeBox = root.querySelector<HTMLElement>("[data-act='col-knowledge']");
    const existingBox = root.querySelector<HTMLElement>("[data-act='col-existing']");
    const titleInput = root.querySelector<HTMLInputElement>("[data-act='col-title']");
    const createBtn = root.querySelector<HTMLButtonElement>("[data-act='col-create']");
    const genBtn = root.querySelector<HTMLButtonElement>("[data-act='col-gen']");

    const selected = new Set<string>((deps.preset ?? []).map((p) => p.key));
    /** 默认标题 = 第一个勾选的知识点标题（可改）。 */
    let defaultTitle = deps.preset?.[0]?.title ?? "";
    if (defaultTitle && titleInput) titleInput.value = defaultTitle;
    /** 预设里不在索引中的键（0 题节点）：合成 0 计数行，展示与生成点位共用。 */
    let presetRows: KnowledgeRow[] = [];

    const renderKnowledge = (rows: KnowledgeRow[]) => {
        if (!knowledgeBox) return;
        if (rows.length === 0) {
            knowledgeBox.innerHTML = `<div class="wengu-muted">${esc(t("collectEmptyKnowledge"))}</div>`;
            return;
        }
        knowledgeBox.innerHTML = rows
            .slice(0, 200)
            .map(
                (r) =>
                    `<label class="wengu-col-row" data-key="${esc(r.key)}">
        <input type="checkbox" data-key="${esc(r.key)}"${selected.has(r.key) ? " checked" : ""}>
        <span class="wengu-col-row-title" title="${esc(r.title)}">${esc(r.title)}</span>
        <span class="wengu-meta">${esc(String(r.count))}</span>
      </label>`
            )
            .join("");
        for (const cb of knowledgeBox.querySelectorAll<HTMLInputElement>("input[type='checkbox']")) {
            cb.addEventListener("change", () => {
                const key = cb.dataset.key ?? "";
                const row = rows.find((r) => r.key === key);
                if (cb.checked) {
                    selected.add(key);
                    if (!defaultTitle && row) {
                        defaultTitle = row.title;
                        if (titleInput && !titleInput.value) titleInput.value = row.title;
                    }
                } else {
                    selected.delete(key);
                }
            });
        }
    };

    /** 展开区：专题题目清单（stem 60 字 + 来源卷名尾注，可逐题移除）。 */
    const renderColQuestions = async (box: HTMLElement, colId: string) => {
        const parsed = await bank.questionsOf(colId);
        const rows = await Promise.all(
            parsed.map(async (p) => {
                const src = (await recordOf(bank, p.id))?.sourceDocId ?? "";
                const srcTitle = src ? deps.docTitle(src) : "";
                return { qid: p.id, stem: (p.stemMd ?? "").replace(/\s+/g, " ").trim().slice(0, 60), srcTitle };
            })
        );
        box.innerHTML =
            rows.length === 0
                ? `<div class="wengu-muted" style="padding:2px 0 2px 24px">${esc(t("collectEmptyQuestions"))}</div>`
                : rows
                      .map(
                          (r) =>
                              `<div class="wengu-col-row wengu-col-qrow" data-qid="${esc(r.qid)}">
        <span class="wengu-col-row-title" title="${esc(r.stem)}">${esc(r.stem || r.qid)}${
            r.srcTitle ? `<span class="wengu-muted"> · ${esc(r.srcTitle)}</span>` : ""
        }</span>
        <button class="b3-button b3-button--cancel wengu-col-del" data-rmcol="${esc(colId)}" data-rmq="${esc(
            r.qid
        )}" title="${esc(t("collectRemoveQ"))}">${svgIcon("iconClose")}</button>
      </div>`
                      )
                      .join("");
        for (const btn of box.querySelectorAll<HTMLButtonElement>("[data-rmq]")) {
            const cid = btn.dataset.rmcol ?? "";
            const qid = btn.dataset.rmq ?? "";
            armConfirm(btn, t("collectConfirm"), async () => {
                await bank.removeFromCollection(cid, qid);
                await bank.flush();
                deps.onChanged();
                deps.onEdited(cid);
                await refresh();
            });
        }
    };

    const renderExisting = (rows: CollectionRow[]) => {
        if (!existingBox) return;
        if (rows.length === 0) {
            existingBox.innerHTML = `<div class="wengu-muted">${esc(t("collectEmptyCollections"))}</div>`;
            return;
        }
        existingBox.innerHTML = rows
            .map(
                (c) =>
                    `<div class="wengu-col-row" data-colid="${esc(c.id)}">
        <button class="b3-button b3-button--outline wengu-col-exp" data-exp="${esc(c.id)}" title="${esc(
            t("collectExpand")
        )}">${svgIcon("iconRight")}</button>
        <span class="wengu-col-row-title">${svgIcon("iconList")} ${esc(c.title)}</span>
        <span class="wengu-meta">${esc(String(c.count))}</span>
        <button class="b3-button b3-button--cancel wengu-col-del" data-del="${esc(c.id)}" title="${esc(
            t("collectDelete")
        )}">${svgIcon("iconClose")}</button>
      </div>
      <div class="wengu-col-qs" data-colqs="${esc(c.id)}" hidden></div>`
            )
            .join("");
        existingBox.querySelectorAll<HTMLElement>("[data-colid]").forEach((row) => {
            row.addEventListener("click", (ev) => {
                if (
                    (ev.target as HTMLElement).closest("[data-del]") ||
                    (ev.target as HTMLElement).closest("[data-exp]")
                )
                    return; // 删除/展开按钮单独处理
                const id = row.dataset.colid ?? "";
                dialog.destroy();
                deps.onSelect(id);
            });
        });
        existingBox.querySelectorAll<HTMLButtonElement>("[data-exp]").forEach((btn) => {
            btn.addEventListener("click", async () => {
                const id = btn.dataset.exp ?? "";
                const box = existingBox.querySelector<HTMLElement>(`[data-colqs='${id}']`);
                if (!box) return;
                const open = !box.hidden;
                box.hidden = open;
                btn.classList.toggle("wengu-col-exp-open", !open); // 展开态图标旋转 90°
                if (!open) await renderColQuestions(box, id);
            });
        });
        existingBox.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((btn) => {
            armConfirm(btn, t("collectConfirm"), async () => {
                const id = btn.dataset.del ?? "";
                await bank.deleteCollection(id);
                await bank.flush();
                deps.onChanged();
                deps.onEdited(id);
                await refresh();
            });
        });
    };

    const refresh = async (): Promise<void> => {
        const idx = await bank.knowledgeIndex();
        presetRows = (deps.preset ?? [])
            .filter((p) => !idx.some((r) => r.key === p.key))
            .map((p): KnowledgeRow => ({ key: p.key, title: p.title, count: 0 }));
        renderKnowledge([...idx, ...presetRows]);
        renderExisting(await bank.collectionsView());
    };

    /** 纯收集（不生成）：建专题后即切过去。 */
    createBtn?.addEventListener("click", () => {
        if (selected.size === 0) return;
        const title = (titleInput?.value ?? "").trim() || defaultTitle || t("collectDefaultTitle");
        void bank.collectQids([...selected]).then((qids) =>
            bank.createCollection(title, qids, "knowledge").then((row) => {
                void bank.flush();
                deps.onChanged();
                dialog.destroy();
                deps.onSelect(row.id);
            })
        );
    });

    /** 收集并补题：先收已有题建专题，再按勾选点的缺口逐点生成补入。
     *  点击即关窗（20260905 去阻塞）：后台流，终态走通知。 */
    genBtn?.addEventListener("click", () => {
        if (selected.size === 0) return;
        const mode = (root.querySelector<HTMLSelectElement>("[data-act='col-gen-mode']")?.value ?? "variant") as
            "variant" | "concept";
        const count = Math.min(
            GEN_MAX_PER_RUN,
            Number(root.querySelector<HTMLSelectElement>("[data-act='col-gen-count']")?.value ?? 5) || 5
        );
        const title =
            (root.querySelector<HTMLInputElement>("[data-act='col-title']")?.value ?? "").trim() ||
            defaultTitle ||
            t("collectDefaultTitle");
        const keys = [...selected];
        dialog.destroy(); // 参数收齐即关窗：收集索引在后台查
        launchAiFlow((stop) =>
            bank
                .knowledgeIndex()
                .then((idx): { key: string; title: string }[] => [
                    ...idx.filter((r) => selected.has(r.key)),
                    ...presetRows.filter((r) => selected.has(r.key)),
                ])
                .then((points) => runCollectGen(deps, keys, points, title, mode, count, stop))
        );
    });
    root.querySelector("[data-act='col-close']")?.addEventListener("click", () => dialog.destroy());
    void refresh();
}

/** 收集并补题主流程（生成核在 GenCore，与薄弱加练共用）。 */
async function runCollectGen(
    deps: CollectionDialogDeps,
    keys: string[],
    points: { key: string; title: string }[],
    title: string,
    mode: "variant" | "concept",
    count: number,
    stop: AiAbort
): Promise<void> {
    const { t, bank } = deps;
    const modelId = deps.modelId();
    try {
        const qids = await bank.collectQids(keys);
        const row = await bank.createCollection(title, qids, "knowledge");
        const { made, degraded } = await genIntoCollection(bank, points, {
            title,
            mode,
            count,
            modelId,
            append: (qid) => bank.appendQidToCollection(row.id, qid),
            t,
            abort: stop,
        });
        await bank.flush();
        if (stop.signal.aborted) notifyInfo({ key: "aiFlowAborted" });
        else notifyInfo(`${made} ${t("collectGenDone")}${degraded ? t("collectDegraded") : ""}`);
        deps.onChanged();
        deps.onSelect(row.id);
    } catch (e) {
        notifyError(stop.signal.aborted ? t("aiFlowAborted") : `${t("convertAiFailed")}${errText(e)}`);
    }
}

/** 两击确认：首次点击变确认态（3s 复原），复击执行——不引入新弹窗。 */
function armConfirm(btn: HTMLButtonElement, confirmText: string, act: () => void): void {
    let armed = false;
    let timer = 0;
    btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (armed) {
            window.clearTimeout(timer);
            act();
            return;
        }
        armed = true;
        btn.classList.add("wengu-col-armed");
        btn.textContent = confirmText;
        timer = window.setTimeout(() => {
            armed = false;
            btn.classList.remove("wengu-col-armed");
            btn.innerHTML = svgIcon("iconClose");
        }, 3000);
    });
}
