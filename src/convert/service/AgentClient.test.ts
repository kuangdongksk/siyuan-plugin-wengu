import { describe, expect, it } from "vitest";
import { newSessionId } from "./AgentClient";

describe("newSessionId", () => {
    it("格式 = {14位时间戳}-{7位小写字母数字}（内核 isValidSessionID 校验格式）", () => {
        const id = newSessionId(new Date(2026, 7, 27, 12, 30, 45));
        expect(id).toMatch(/^\d{14}-[a-z0-9]{7}$/);
        expect(id.startsWith("20260827123045-")).toBe(true);
    });

    it("批量生成不重复", () => {
        const ids = Array.from({ length: 200 }, () => newSessionId());
        expect(new Set(ids).size).toBe(200);
    });
});
