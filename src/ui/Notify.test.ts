import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const showMessage = vi.fn();
vi.mock("siyuan", () => ({
    showMessage: (text: string, timeout?: number, type?: "info" | "error"): void => {
        showMessage(text, timeout, type);
    },
}));

import { initNotify, notifyError, notifyInfo } from "./Notify";

describe("Notify（思源通知帮手）", () => {
    beforeEach(() => {
        showMessage.mockClear();
        initNotify({ notifyConvertDone: "转换完成：共 {n} 题" });
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-09-01T10:00:00"));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("键 + 变量经注入的 i18n 取词（未接线/缺键回落键名）", () => {
        notifyInfo({ key: "notifyConvertDone", vars: { n: "12" } });
        expect(showMessage).toHaveBeenCalledTimes(1);
        expect(showMessage).toHaveBeenCalledWith("转换完成：共 12 题", 5000, "info");
        notifyInfo("raw 文案");
        expect(showMessage).toHaveBeenLastCalledWith("raw 文案", 5000, "info");
        notifyInfo({ key: "nope" });
        expect(showMessage).toHaveBeenLastCalledWith("nope", 5000, "info");
    });

    it("错误同文案 60s 冷却去重；不同文案与过期后不受限", () => {
        notifyError("题库落盘失败（稍后自动重试）：disk full");
        notifyError("题库落盘失败（稍后自动重试）：disk full");
        expect(showMessage).toHaveBeenCalledTimes(1);
        notifyError("另一处失败");
        expect(showMessage).toHaveBeenCalledTimes(2);
        vi.setSystemTime(new Date("2026-09-01T10:01:01"));
        notifyError("题库落盘失败（稍后自动重试）：disk full");
        expect(showMessage).toHaveBeenCalledTimes(3);
        expect(showMessage).toHaveBeenLastCalledWith("题库落盘失败（稍后自动重试）：disk full", 7000, "error");
    });
});
