/**
 * 视图层小工具（全局唯一实现，docs/design-review.md P0-1）：
 * HTML 转义 / i18n 模板 / 秒数格式化 / 分钟规整 / 错误文案化。
 * QuizView、StartPanel、SettingsDialog、转换弹窗共用，不要再各自复制。
 */

/** 任意抛出值 → 人读文案：思源前端大量失败路径 reject 裸对象
 *  `{code,msg,data}` 而非 Error（3.8.2 起 saveData 的生命周期/只读闸、
 *  putFile 序列化失败皆如此），`String(e)` 直出「[object Object]」——
 *  展示给用户的错误一律经这里（20260903）。 */
export function errText(e: unknown): string {
    if (typeof e === "string") return e;
    if (e instanceof Error) return e.message || e.name;
    if (e && typeof e === "object") {
        const o = e as { code?: unknown; msg?: unknown; message?: unknown };
        const text = typeof o.msg === "string" && o.msg ? o.msg : typeof o.message === "string" ? o.message : "";
        if (text) return typeof o.code === "number" && o.code !== 0 ? `${text} [code ${o.code}]` : text;
        try {
            return JSON.stringify(o) ?? String(o);
        } catch (_) {
            return String(o); // 循环引用等不可序列化对象兜底
        }
    }
    return String(e);
}

/** 是否「运行环境已终止」类永久失败：3.8.2 saveData 在插件实例被
 *  dispose 后永久拒绝 `{code:410,"Plugin lifecycle has ended"}`——
 *  重试循环（防抖落盘重排等）撞上它必须停手，否则成僵尸循环。 */
export function isLifecycleGone(e: unknown): boolean {
    if (e && typeof e === "object" && (e as { code?: unknown }).code === 410) return true;
    return /lifecycle/i.test(errText(e));
}

/** HTML 转义（文本与属性通用）。 */
export function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** i18n 模板变量替换：attempts = "刷题 {n} 次" → fmt(t, {n: "3"})。 */
export function fmt(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

/** 富文本 HTML → 纯文本（<br> 转换行，转义实体经 DOM 解码）。 */
export function htmlToText(html: string): string {
    const el = document.createElement("div");
    el.innerHTML = html.replace(/<br\s*\/?>/gi, "\n");
    return el.textContent ?? "";
}

/** 写剪贴板（navigator.clipboard 优先，降级 execCommand 兜底）；成功与否以返回值表达。 */
export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
    }
}

/** 秒数 → m:ss（超 1 小时 h:mm:ss）。 */
export function mmss(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 倒计时分钟数：1~600 的整数，非法回退 20。 */
export function clampMinutes(n: number): number {
    return Number.isFinite(n) && n >= 1 ? Math.min(600, Math.floor(n)) : 20;
}

/** 时间戳 → 「MM-DD HH:mm」（错题本清单/时间线用）。 */
export function fmtDateTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 让出主线程一拍（静态分片渲染的帧预算 yield 用）：MessageChannel
 *  派发宏任务，不受后台页签定时器钳制——setTimeout(0) 在隐藏页签被
 *  钳到 ≥1s，长卷后台成像会被拖到分钟级（20260829 审查）。 */
export function yieldToBrowser(): Promise<void> {
    return new Promise<void>((resolve) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => resolve();
        ch.port2.postMessage(0);
    });
}
