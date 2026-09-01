import { showMessage } from "siyuan";
import { fmt } from "./shared";

/**
 * 思源通知帮手（20260901）：后台任务的静默失败/完成经内核级
 * showMessage 浮层告知。只接「用户看不见」的路径——弹窗/页签内已有
 * 反馈的流不重复通知（判题失败、词书导入、学伴 AI 等均已页面可见）。
 * i18n 由 index.ts onload 注入（initNotify），深层存储模块无 t 也能用
 * 键取词；错误类按最终文案 60s 冷却去重——题库落盘失败每 5s 重排
 * 防抖重试，不冷却会一分钟刷十几条同文案。loader 注入的 "siyuan"
 * 模块表实测含 showMessage/hideMessage（3.8.2 common.js），与 Lute
 * 不在表内的情况不同（AGENTS.md 内核坑节）。
 */

export type NotifyMsg = string | { key: string; vars?: Record<string, string> };

let translate: (key: string) => string = (key) => key;

/** 插件装载时接线（index.ts onload，先于各存储 init）。 */
export function initNotify(i18n: Record<string, string>): void {
    translate = (key) => i18n[key] || key;
}

const ERR_COOLDOWN_MS = 60_000;
const lastErrAt = new Map<string, number>();

const resolve = (msg: NotifyMsg): string => (typeof msg === "string" ? msg : fmt(translate(msg.key), msg.vars ?? {}));

/** 信息通知（任务完成；不冷却——完成事件天然稀疏）。 */
export function notifyInfo(msg: NotifyMsg): void {
    showMessage(resolve(msg), 5000, "info");
}

/** 错误通知（静默失败兜底；同文案 60s 冷却防重试风暴）。 */
export function notifyError(msg: NotifyMsg): void {
    const text = resolve(msg);
    const now = Date.now();
    if (now - (lastErrAt.get(text) ?? 0) < ERR_COOLDOWN_MS) return;
    lastErrAt.set(text, now);
    showMessage(text, 7000, "error");
}
