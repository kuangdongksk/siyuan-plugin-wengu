import { unzipSync } from "fflate";
import { fetchSyncPost } from "siyuan";

/**
 * MinerU 文档解析客户端（PDF → markdown + 插图）。
 *
 * 浏览器直连 mineru.net API 会被 CORS 拦（真机实测：OPTIONS 405、
 * 响应无 ACAO 头），JSON 请求一律经内核 /api/network/forwardProxy 转发
 * （3.8.0 真机验证可用，上游响应在 data.body）。两个二进制环节
 * （PUT 上传、zip 下载）代理通道传不了二进制，只能浏览器直连 OSS
 * 预签名地址——OSS 是否放行待真机验证，被拦时抛 kind 对应错误。
 *
 * 接口（官方 v4 批量上传解析，字段 2026-08 核对）：
 * 1. POST /api/v4/file-urls/batch {files:[{name,is_ocr}]} → batch_id + 上传地址
 * 2. PUT 文件二进制到上传地址——**绝不带 Content-Type**（官方文档明确
 *    「无须设置」，带了预签名校验不过，issue #4145）
 * 3. GET /api/v4/extract-results/batch/{batch_id} 轮询至 state=done
 *    （done/failed 终态；waiting-file/pending/running/converting 进行中，
 *    running 时有 extract_progress 页码进度）
 * 4. 下载 full_zip_url → fflate 解压取 full.md + images/*
 */

/** 错误类别（弹窗层据此映射 i18n 文案）。 */
export type MinerUErrorKind =
    | "auth" // token 错误/过期（A0202/A0211 或上游 401）
    | "upload" // PUT 上传失败
    | "download" // zip 下载失败
    | "parseFailed" // MinerU 解析失败（state=failed，detail 带 err_msg）
    | "timeout" // 轮询超时
    | "api"; // 其他上游错误

export class MinerUError extends Error {
    constructor(
        public readonly kind: MinerUErrorKind,
        public readonly detail: string
    ) {
        super(`${kind}: ${detail}`);
    }
}

/** 解析结果：markdown（插图引用 images/xxx 相对路径）+ 插图二进制。 */
export interface MinerUParseResult {
    markdown: string;
    images: { name: string; data: Uint8Array }[];
}

/** 阶段回调（status 文案 + 可选进度百分比）。 */
export type MinerUProgress = (info: {
    stage: "uploading" | "waiting" | "downloading";
    /** 解析进度（0-100），仅 waiting 阶段可能拿到。 */
    percent?: number;
}) => void;

const API_BASE = "https://mineru.net/api/v4";
/** 轮询间隔/总时长：整本书要十几分钟，20 分钟兜底。 */
const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 20 * 60 * 1000;

/** 经内核代理转发 JSON 请求，返回上游 body 解析结果（上游错误转 MinerUError）。 */
async function proxyJson(url: string, token: string, method: string, body?: string): Promise<Record<string, unknown>> {
    const res = await fetchSyncPost("/api/network/forwardProxy", {
        url,
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { payload: body } : {}),
        timeout: 30000,
    });
    const payload = (res?.data ?? {}) as { body?: unknown };
    const text = typeof payload.body === "string" ? payload.body : "";
    let json: Record<string, unknown> | undefined;
    try {
        json = JSON.parse(text) as Record<string, unknown>;
    } catch (_) {
        // 上游非 JSON（如网关错误页）
    }
    const code = Number(json?.code ?? -1);
    if (json && code !== 0) {
        // A0202 token 错误 / A0211 过期；msg 形如 "A0202: Invalid token"
        throw new MinerUError(
            String(json.msg ?? "").includes("A0202") || String(json.msg ?? "").includes("A0211") ? "auth" : "api",
            String(json.msg ?? text.slice(0, 200))
        );
    }
    if (!json) throw new MinerUError("api", text.slice(0, 200) || `HTTP ${method} ${url} 无响应体`);
    return json;
}

/** PUT 上传文件二进制到 OSS 预签名地址（不带 Content-Type）。 */
async function putToOss(uploadUrl: string, data: ArrayBuffer): Promise<void> {
    try {
        // ArrayBuffer body：fetch 不会自动补 Content-Type（File/Blob 带类型会，
        // 预签名按无 Content-Type 计算，带了直接签名不匹配）
        const res = await fetch(uploadUrl, { method: "PUT", body: data });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
        throw new MinerUError("upload", String((e as Error)?.message ?? e));
    }
}

interface ExtractResultRow {
    state?: string;
    full_zip_url?: string;
    err_msg?: string;
    extract_progress?: { extracted_pages?: number; total_pages?: number };
}

/** 轮询批次结果，done 时返回 zip 地址。 */
async function pollResult(batchId: string, token: string, onProgress: MinerUProgress): Promise<string> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
        if (Date.now() >= deadline) throw new MinerUError("timeout", batchId);
        const json = await proxyJson(`${API_BASE}/extract-results/batch/${batchId}`, token, "GET");
        const rows = (json.data as { extract_result?: ExtractResultRow[] } | undefined)?.extract_result ?? [];
        const row = rows[0] ?? {};
        if (row.state === "done" && row.full_zip_url) return row.full_zip_url;
        if (row.state === "failed") throw new MinerUError("parseFailed", row.err_msg ?? "");
        const p = row.extract_progress;
        if (p && p.total_pages) {
            onProgress({
                stage: "waiting",
                percent: Math.min(99, Math.round(((p.extracted_pages ?? 0) / p.total_pages) * 100)),
            });
        } else {
            onProgress({ stage: "waiting" });
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
}

/** 从结果 zip 提取 full.md 与 images/*（zip 内可能带一层目录，按 basename 匹配）。 */
function extractZip(bytes: Uint8Array): MinerUParseResult {
    let entries: Record<string, Uint8Array>;
    try {
        entries = unzipSync(bytes);
    } catch (e) {
        throw new MinerUError("download", `zip 解压失败 ${String((e as Error)?.message ?? e)}`);
    }
    let markdown = "";
    const images: { name: string; data: Uint8Array }[] = [];
    for (const [path, data] of Object.entries(entries)) {
        const base = path.slice(path.lastIndexOf("/") + 1);
        if (base === "full.md" && !markdown) {
            markdown = new TextDecoder().decode(data);
        } else if (path.startsWith("images/") && base) {
            images.push({ name: base, data });
        }
    }
    if (!markdown) throw new MinerUError("download", "zip 里没有 full.md");
    return { markdown, images };
}

/** 全流程：申请上传地址 → 上传 → 轮询 → 下载解压。 */
export async function mineruParsePdf(
    file: File,
    token: string,
    onProgress: MinerUProgress,
    signal?: AbortSignal
): Promise<MinerUParseResult> {
    const name = file.name || "upload.pdf";
    onProgress({ stage: "uploading" });
    const apply = await proxyJson(
        `${API_BASE}/file-urls/batch`,
        token,
        "POST",
        JSON.stringify({
            enable_formula: true,
            enable_table: true,
            language: "ch",
            files: [{ name, is_ocr: false, data_id: `wengu-${Date.now().toString(36)}` }],
        })
    );
    const data = (apply.data ?? {}) as { batch_id?: string; file_urls?: string[] };
    const uploadUrl = data.file_urls?.[0];
    const batchId = data.batch_id;
    if (!uploadUrl || !batchId) throw new MinerUError("api", "申请上传地址失败：响应缺 file_urls/batch_id");
    signal?.throwIfAborted();
    await putToOss(uploadUrl, await file.arrayBuffer());
    signal?.throwIfAborted();
    const zipUrl = await pollResult(batchId, token, onProgress);
    onProgress({ stage: "downloading" });
    signal?.throwIfAborted();
    try {
        const res = await fetch(zipUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return extractZip(new Uint8Array(await res.arrayBuffer()));
    } catch (e) {
        if (e instanceof MinerUError) throw e;
        throw new MinerUError("download", String((e as Error)?.message ?? e));
    }
}
