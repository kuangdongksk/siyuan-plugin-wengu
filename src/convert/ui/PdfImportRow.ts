import { MinerUError } from "../service/MinerUClient";
import { importPdfAsDoc } from "../service/PdfImport";
import { convertRunActive } from "../service/ConvertRun";
import { esc, fmt } from "../../ui/shared";

/**
 * 转换弹窗的「从 PDF 导入」执行体（Svelte 化 20260830：runPdfImport
 * 纯函数化由组件直调，按钮/文件输入的 DOM 交互在组件里）。导入位置 =
 * 生成位置的指定父文档（custom）；same 时建到当前文档旁边（同笔记本
 * 同目录）。完成后把原文档 id 回填给弹窗（onImported），由用户接着点
 * 开始转换。
 */

/** 行依赖（弹窗控制器提供 DOM 之外的宿主能力）。 */
export interface PdfImportRowDeps {
    t: (key: string) => string;
    /** MinerU API token（设置页，空=未配置，点导入时提示）。 */
    mineruToken: string;
    /** 每次导入开始时弹窗接管终止按钮（挂 AbortController）。 */
    hookStop(c: AbortController): void;
    /** 导入位置解析（custom 父文档优先，否则参照文档旁边）。 */
    resolveTarget(): { parentDocId?: string; siblingDocId?: string };
    showStatus(html: string, kind: "ok" | "err" | "muted"): void;
    setBusy(v: boolean): void;
    /** 导入成功（原文档已建好并轮询可查）。 */
    onImported(r: { docId: string; title: string; charCount: number; imageCount: number }): void;
}

/** MinerU/导入错误 → i18n 文案（未知错误原样展示）。 */
function importError(e: unknown, t: (key: string) => string): string {
    if (e instanceof MinerUError) {
        const head = t(`mineruErr_${e.kind}`);
        return e.detail ? `${head}（${e.detail}）` : head;
    }
    const m = String((e as Error)?.message ?? e);
    return m === "pdfImportParentMissing" ? t("pdfImportParentMissing") : m;
}

/** 执行一次 MinerU 导入（文件已就位）；导入中可经终止按钮中止。 */
export async function runPdfImport(file: File, deps: PdfImportRowDeps): Promise<void> {
    // 转换运行中不开第二条内核写流：导入建文档与转换 append 并发
    // fetchSyncPost 会互相吞响应（20260829 审查，互斥原来只做在
    // ConvertRun 单例内部）
    if (convertRunActive()) {
        deps.showStatus(deps.t("convertBusy"), "err");
        return;
    }
    if (!deps.mineruToken) {
        deps.showStatus(deps.t("mineruNoToken"), "err");
        return;
    }
    const controller = new AbortController();
    deps.hookStop(controller);
    deps.setBusy(true);
    try {
        const r = await importPdfAsDoc(file, {
            token: deps.mineruToken,
            ...deps.resolveTarget(),
            signal: controller.signal,
            onProgress: (p) => {
                if (p.stage === "upload") deps.showStatus(deps.t("mineruUploading"), "muted");
                else if (p.stage === "wait") {
                    deps.showStatus(fmt(deps.t("mineruWaiting"), { p: String(p.percent ?? 0) }), "muted");
                } else if (p.stage === "download") deps.showStatus(deps.t("mineruDownloading"), "muted");
                else deps.showStatus(deps.t("mineruSaving"), "muted");
            },
        });
        deps.onImported(r);
        deps.showStatus(
            esc(
                fmt(deps.t("mineruImported"), {
                    title: r.title,
                    n: String(r.charCount),
                    img: String(r.imageCount),
                })
            ),
            "ok"
        );
    } catch (e) {
        if ((e as Error)?.name === "AbortError") {
            deps.showStatus(deps.t("convertDiscarded"), "muted");
        } else {
            deps.showStatus(importError(e, deps.t), "err");
        }
    } finally {
        deps.setBusy(false);
    }
}
