import { describe, expect, it } from "vitest";
import { parseCount } from "./ConvertDetect";
import { chunkKramdown } from "./ConvertService";

/**
 * 检测计数的纯逻辑：分段覆盖全文（总和语义的事实源）+ COUNT 解析
 * 容错（AI 回复格式漂移不崩、缺 COUNT 不误报数字）。
 */

describe("parseCount", () => {
    it("取 COUNT 数字（中英文冒号均可）", () => {
        expect(parseCount("CAN_CONVERT: yes\nCOUNT: 12\nREASON: 试卷")).toBe(12);
        expect(parseCount("COUNT：3")).toBe(3);
    });
    it("带加号只取数字（加号由调用侧按分段失败标注）", () => {
        expect(parseCount("COUNT: 5+")).toBe(5);
    });
    it("缺 COUNT 或非数字为 undefined", () => {
        expect(parseCount("CAN_CONVERT: yes\nREASON: 讲义")).toBeUndefined();
        expect(parseCount("COUNT: 很多")).toBeUndefined();
        expect(parseCount("")).toBeUndefined();
    });
});

describe("检测分段（chunkKramdown 复用为检测窗口）", () => {
    it("长文档按 12k 窗切段后连续覆盖全文、无重无漏", () => {
        const md = Array.from({ length: 4000 }, (_, i) => `第${i}题：${"题干".repeat(6)}。`).join("\n\n");
        const wins = chunkKramdown(md, 12000);
        expect(wins.length).toBeGreaterThan(1);
        expect(wins.map((c) => c.text).join("\n\n").length).toBeGreaterThan(0);
        for (const c of wins) {
            expect(c.text.length).toBeLessThanOrEqual(12000);
            expect(md.slice(c.offset, c.offset + c.text.length).trim()).toBe(c.text);
        }
        const last = wins[wins.length - 1];
        expect(last.offset + last.text.length).toBe(md.length);
    });
});
