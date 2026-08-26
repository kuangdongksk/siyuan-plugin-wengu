import { Dialog } from "siyuan";
import type { ConvertProgressRecord } from "./ConvertBatch";
import {
    convertRunSnapshot,
    discardConvertRun,
    keepConvertRun,
    progressStatusText,
    stopConvertRun,
    subscribeConvertRun,
} from "./ConvertRun";
import { formGroup, formRow } from "../ui/FormHtml";
import { esc, fmt } from "../ui/shared";

/**
 * 转换管理面板（单独管理进行中/未完成的转换）：转换弹窗不再用
 * 「已有转换在进行中」一句报错打发——被拒时直接打开本面板。面板分两区：
 * ①进行中（ConvertRun 单例快照，订阅刷新）：进度行 + 终止，终止后
 * 待抉择时给「保留已生成/全部丢弃」（与页内转换条同款动作）；
 * ②未完成进度（prefs 记录，跨重启仍在）：逐条「继续生成」（回转换
 * 弹窗预填源文档，resume 提示接管）/「丢弃进度」——清记录，记录带
 * docId（非原位模式/原位已建临时文档）时**连同转换新建的部分习题
 * 文档一起删**；原位只存 kramdown 的记录没有新建文档，仅清内部
 * 数据。已确认语义，勿改成「只清书签不删文档」。
 */

/** 面板依赖（openWenguConvert 组装）。 */
export interface ConvertPanelDeps {
    t: (k: string) => string;
    /** 未完成进度记录（prefs 持久）。 */
    listProgress(): { srcDocId: string; rec: ConvertProgressRecord }[];
    /** 丢弃一条进度记录：清 prefs；rec 带 docId（转换新建的文档）时一并删除。 */
    discardProgress(srcDocId: string, rec: ConvertProgressRecord): void;
    /** 继续生成：打开转换弹窗并预填该源文档（resume 提示接管）。 */
    resumeProgress(srcDocId: string): void;
}

/** 单例（重复打开刷新旧面板）。 */
let panel: Dialog | undefined;

export function openConvertPanel(deps: ConvertPanelDeps): void {
    panel?.destroy();
    panel = undefined;
    const { t } = deps;
    const dialog = new Dialog({
        title: t("convertPanelTitle"),
        width: "480px",
        content: `<div class="b3-dialog__content wengu-dialog wengu-convert-panel">
      <div data-act="panel-body"></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="panel-close">${esc(t("convertPanelClose"))}</button>
    </div>`,
    });
    panel = dialog;
    const root = dialog.element;
    const body = root.querySelector<HTMLElement>("[data-act='panel-body']");
    if (!body) return;

    const render = (): void => {
        const snap = convertRunSnapshot();
        const records = deps.listProgress();
        const secs: string[] = [];
        if (snap?.running) {
            const text = snap.progress ? progressStatusText(t, snap.parallel, snap.progress) : esc(t("converting"));
            secs.push(
                '<div class="wengu-status wengu-status-muted wengu-convert-bar">' +
                    `<span class="wengu-convert-bar-text">${text}</span>` +
                    `<button class="b3-button b3-button--outline" data-act="panel-stop">${esc(
                        t("convertStop")
                    )}</button>` +
                    "</div>"
            );
        } else if (snap?.pendingChoice && snap.pending) {
            secs.push(
                '<div class="wengu-status wengu-status-muted wengu-convert-bar">' +
                    `<span class="wengu-convert-bar-text">${esc(
                        fmt(t("convertStopped"), {
                            c: String(snap.pending.count),
                            b: String(snap.pending.batches),
                            n: String(snap.pending.total),
                        })
                    )}</span>` +
                    `<button class="b3-button b3-button--outline" data-act="panel-keep">${esc(
                        t("convertKeep")
                    )}</button>` +
                    `<button class="b3-button b3-button--cancel" data-act="panel-discard">${esc(
                        t("convertDiscard")
                    )}</button>` +
                    "</div>"
            );
        }
        const rows = records
            .map(({ srcDocId, rec }) => {
                const title = rec.title || srcDocId;
                const meta = fmt(t("convertPanelRecordMeta"), {
                    c: String(rec.count),
                    b: String(rec.batches),
                    n: String(rec.total),
                });
                return formRow(
                    `《${title}》`,
                    meta,
                    `<button class="b3-button b3-button--outline" data-act="panel-resume" data-doc="${esc(
                        srcDocId
                    )}">${esc(t("convertPanelResume"))}</button>` +
                        `<button class="b3-button b3-button--cancel" data-act="panel-drop" data-doc="${esc(
                            srcDocId
                        )}">${esc(t("convertPanelDrop"))}</button>`,
                    ""
                );
            })
            .join("");
        if (secs.length === 0 && records.length === 0) {
            body.innerHTML = `<div class="wengu-status wengu-status-muted">${esc(t("convertPanelEmpty"))}</div>`;
            return;
        }
        let html = "";
        if (secs.length > 0) html += formGroup(t("convertPanelRunning"), secs.join(""));
        if (records.length > 0) html += formGroup(t("convertPanelRecords"), rows);
        body.innerHTML = html;
    };

    render();
    const unsub = subscribeConvertRun(() => {
        if (!document.contains(root)) {
            // 面板已被关闭（X/destroy）：退订自清
            unsub();
            return;
        }
        render();
    });

    // 事件委托（容器存活于重渲染之间）
    body.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === "panel-stop") {
            btn.disabled = true; // 中止异步收口，先禁用防连点
            stopConvertRun();
            return;
        }
        if (act === "panel-keep") {
            btn.disabled = true;
            void keepConvertRun();
            return;
        }
        if (act === "panel-discard") {
            discardConvertRun();
            render();
            return;
        }
        if (act === "panel-drop") {
            const srcDocId = btn.dataset.doc ?? "";
            const hit = deps.listProgress().find((r) => r.srcDocId === srcDocId);
            if (hit) deps.discardProgress(srcDocId, hit.rec);
            render();
            return;
        }
        if (act === "panel-resume") {
            const srcDocId = btn.dataset.doc ?? "";
            unsub();
            closePanel(dialog);
            deps.resumeProgress(srcDocId);
        }
    });
    root.querySelector<HTMLButtonElement>("[data-act='panel-close']")?.addEventListener("click", () => {
        unsub();
        closePanel(dialog);
    });
    root.querySelector<HTMLElement>(".b3-dialog__close")?.addEventListener("click", () => {
        unsub();
        if (panel === dialog) panel = undefined;
    });
}

/** 关面板（单例指针一并复位，避免对已销毁 Dialog 重复 destroy）。 */
function closePanel(dialog: Dialog): void {
    if (panel === dialog) panel = undefined;
    dialog.destroy();
}
