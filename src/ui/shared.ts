/**
 * 视图层小工具（全局唯一实现，docs/design-review.md P0-1）：
 * HTML 转义 / i18n 模板 / 秒数格式化 / 分钟规整。
 * QuizView、StartPanel、SettingsDialog、转换弹窗共用，不要再各自复制。
 */

/** HTML 转义（文本与属性通用）。 */
export function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** i18n 模板变量替换：attempts = "刷题 {n} 次" → fmt(t, {n: "3"})。 */
export function fmt(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
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
