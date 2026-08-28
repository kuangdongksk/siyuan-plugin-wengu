import { KernelDoc } from "../../siyuan/doc";
import { extractBlockId, getDocInfo, parentOf } from "./ConvertService";
import { mineruParsePdf } from "./MinerUClient";

/**
 * PDF 一键导入（配合 MinerUClient）：MinerU 解析 → 插图逐张 putFile 到
 * 笔记本 assets/wengu/{时间戳}/ → markdown 图片路径改写 → createDocWithMd
 * 建一份人类可读的原文档。原文档不加任何 wengu 属性，就是普通文档；
 * 之后走既有 AI 转换（默认原位替换，见 ConvertBatch 的 writeMode）。
 *
 * putFile 必须 multipart（内核不吃 JSON body）；插图与建文档全部串行，
 * 避开 fetchSyncPost 并发互吞的内核坑。
 */

/** 进度回调（弹窗状态行展示）。 */
export interface PdfImportProgress {
    (info: { stage: "upload" | "wait" | "download" | "save"; percent?: number }): void;
}

export interface PdfImportOptions {
    /** MinerU API token（设置页配置）。 */
    token: string;
    /** 原文档建到该父文档下面（文档 id 或 siyuan:// 链接），与 siblingDocId 二选一。 */
    parentDocId?: string;
    /** 原文档建到该文档旁边（同笔记本同目录），与 parentDocId 二选一。 */
    siblingDocId?: string;
    onProgress?: PdfImportProgress;
    signal?: AbortSignal;
}

export interface PdfImportResult {
    docId: string;
    title: string;
    charCount: number;
    imageCount: number;
}

/** 上传单个文件到内核 /api/putfile（multipart；token 取自 window.siyuan）。 */
async function putAsset(path: string, data: Uint8Array): Promise<void> {
    const token =
        (
            window as unknown as {
                siyuan?: { config?: { api?: { token?: string } } };
            }
        ).siyuan?.config?.api?.token ?? "";
    const form = new FormData();
    form.append("path", path);
    form.append("isDir", "false");
    // fflate 解出的 Uint8Array 均为独占 buffer，整体作为 Blob 安全
    form.append("file", new Blob([data.buffer as ArrayBuffer]));
    // 3.8.1 路由迁移：/api/putFile → /api/file/putFile（旧路由 404 空响应）
    const res = await fetch("/api/file/putFile", {
        method: "POST",
        headers: token ? { Authorization: `Token ${token}` } : undefined,
        body: form,
    });
    let json: { code?: number; msg?: string } = {};
    try {
        json = (await res.json()) as { code?: number; msg?: string };
    } catch (_) {
        // 非 JSON 响应按状态码报错
    }
    if (json.code !== 0) throw new Error(`putFile ${path} 失败：${json.msg ?? `HTTP ${res.status}`}`);
}

/** 文件名清洗（对齐 createExerciseDoc 的规则）+ 去掉 .pdf 后缀。 */
function titleOf(fileName: string): string {
    const base = fileName
        .replace(/\.pdf$/i, "")
        .replace(/[\\/:*?"<>|]/g, "-")
        .trim();
    return base || "PDF 导入";
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 导入主流程：返回新建原文档的定位信息。 */
export async function importPdfAsDoc(file: File, opts: PdfImportOptions): Promise<PdfImportResult> {
    const fire = (info: Parameters<PdfImportProgress>[0]) => opts.onProgress?.(info);
    // 定位：指定父文档下面，或参照文档旁边（同笔记本同目录）
    let notebook: string;
    let parentPath: string;
    if (opts.parentDocId) {
        const parent = await getDocInfo(extractBlockId(opts.parentDocId));
        if (!parent?.notebook) throw new Error("pdfImportParentMissing");
        notebook = parent.notebook;
        parentPath = parent.hPath && parent.hPath.trim() ? parent.hPath : "/";
    } else if (opts.siblingDocId) {
        const sibling = await getDocInfo(extractBlockId(opts.siblingDocId));
        if (!sibling?.notebook) throw new Error("pdfImportParentMissing");
        notebook = sibling.notebook;
        parentPath = parentOf(sibling.hPath ?? "/");
    } else {
        throw new Error("pdfImportParentMissing");
    }

    const parsed = await mineruParsePdf(
        file,
        opts.token,
        (p) =>
            fire(
                p.stage === "uploading"
                    ? { stage: "upload" }
                    : p.stage === "downloading"
                      ? { stage: "download" }
                      : { stage: "wait", percent: p.percent }
            ),
        opts.signal
    );

    fire({ stage: "save" });
    const stamp = Date.now().toString(36);
    let markdown = parsed.markdown;
    for (const img of parsed.images) {
        opts.signal?.throwIfAborted(); // 落盘循环可中止（原无检查点）
        const target = `assets/wengu/${stamp}/${img.name}`;
        // putFile 路径必须工作区相对（带前导斜杠 3.8.1 会拼出非法盘符路径）
        await putAsset(`data/${notebook}/assets/wengu/${stamp}/${img.name}`, img.data);
        // 函数形式替换串：zip 内文件名含 $&/$' 等序列时不被特殊解释
        markdown = markdown.replace(new RegExp(`images/${escRe(img.name)}`, "g"), () => target);
    }

    const title = titleOf(file.name);
    const path = `${parentPath === "/" ? "" : parentPath}/${title}.sy`;
    const fallback = `${parentPath === "/" ? "" : parentPath}/${title}·${stamp}.sy`;
    let docId = "";
    let lastMsg = "";
    for (const p of [path, fallback]) {
        const res = await KernelDoc.createByMd(notebook, p, markdown);
        if (res.code === 0 && res.data) {
            docId = String(res.data);
            break;
        }
        lastMsg = res.msg;
    }
    if (!docId) throw new Error(`建文档失败：${lastMsg || "createDocWithMd failed"}`);

    // 内核索引有数秒延迟：轮询到能查到再返回，保证紧接着的转换不落空
    for (let i = 0; i < 15; i++) {
        const info = await getDocInfo(docId);
        if (info) return { docId, title, charCount: markdown.length, imageCount: parsed.images.length };
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return { docId, title, charCount: markdown.length, imageCount: parsed.images.length };
}
