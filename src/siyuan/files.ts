import { EApi } from "./api";

/**
 * 内核文件特殊通道（词书等工作区文件，redesign §五）：putFile 走
 * multipart、getFile 回裸内容（无 {code,data} 信封）、removeFile 走
 * JSON 信封——三类都不合 api.ts 工厂的信封约定，故独立成模块。
 * path 一律工作区相对、不带前导 /。
 */

/** 取内核访问令牌头（鉴权开启的环境里裸 fetch 会 401，ai/client 同用）。 */
export function authHeaders(): Record<string, string> {
    const token =
        (
            window as unknown as {
                siyuan?: { config?: { api?: { token?: string } } };
            }
        ).siyuan?.config?.api?.token ?? "";
    return token ? { Authorization: `Token ${token}` } : {};
}

async function postJson(path: string, body: unknown): Promise<{ code?: number; msg?: string; status: number }> {
    const res = await fetch(path, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    let json: { code?: number; msg?: string } = {};
    try {
        json = (await res.json()) as { code?: number; msg?: string };
    } catch (_) {
        // 非 JSON 响应按状态码报
    }
    return { code: json.code, msg: json.msg, status: res.status };
}

/** 读工作区文本文件；不存在/不可读返回 undefined。 */
export async function kernelReadText(path: string): Promise<string | undefined> {
    try {
        const res = await fetch(EApi.FileGet, {
            method: "POST",
            headers: { ...authHeaders(), "Content-Type": "application/json" },
            body: JSON.stringify({ path }),
        });
        if (!res.ok) return undefined;
        return await res.text();
    } catch (_) {
        return undefined;
    }
}

/** 写工作区文本文件（UTF-8；putFile multipart，见类注释）。 */
export async function kernelWriteText(path: string, text: string): Promise<void> {
    const form = new FormData();
    form.append("path", path);
    form.append("isDir", "false");
    form.append("file", new Blob([text], { type: "application/json" }));
    const res = await fetch(EApi.FilePut, { method: "POST", headers: authHeaders(), body: form });
    let json: { code?: number; msg?: string } = {};
    try {
        json = (await res.json()) as { code?: number; msg?: string };
    } catch (_) {
        // 非 JSON 响应按状态码报错
    }
    if (json.code !== 0) throw new Error(`putFile ${path} 失败：${json.msg ?? `HTTP ${res.status}`}`);
}

/** 删工作区文件（信封端点；失败上抛由调用方决定提示——原吞错只
 *  console，词书删除静默半途的「文件残留/manifest 落盘被跳过」不可
 *  见，20260829 挂账清偿）。 */
export async function kernelRemoveFile(path: string): Promise<void> {
    const r = await postJson(EApi.FileRemove, { path });
    if (r.code !== 0) throw new Error(`removeFile ${path}：${r.msg ?? `HTTP ${r.status}`}`);
}
