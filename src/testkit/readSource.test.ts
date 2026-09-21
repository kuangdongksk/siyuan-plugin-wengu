import { describe, expect, it } from "vitest";
import { expectRed, hasSource, mustHave, read } from "./readSource";

/**
 * 读源码工具自身的验收（Issue #189）：本仓「源级断言」全靠它，它若静默
 * 取错文件或静默回落空串，上层所有红/绿判定一起失真，故单独钉住。
 */

describe("read（相对仓根的路径口径）", () => {
    it("按路径取值，命中正确文件", async () => {
        expect(await read("/src/quiz/render/NumRail.ts")).toContain("NumRail");
    });

    it("跨层同名文件不撞车：`src/quiz/index.ts` 与 `src/index.ts` 各取各的", async () => {
        const quiz = await read("/src/quiz/index.ts");
        const root = await read("/src/index.ts");
        expect(quiz).toContain("class QuizView");
        expect(root).toContain("class WenguPlugin");
        expect(root).not.toContain("class QuizView");
    });

    it("接受省略 `/src/` 前缀的写法，与带前缀等价", async () => {
        expect(await read("quiz/render/NumRail.ts")).toBe(await read("/src/quiz/render/NumRail.ts"));
    });

    it("文件不在即抛错（不静默回落空串——红清单靠它不缺条目）", () => {
        expect(() => read("/src/quiz/service/NotThere.ts")).toThrow(/源文件不在/);
    });
});

describe("hasSource / mustHave（在场闸）", () => {
    it("在场的文件为真且放行", () => {
        expect(hasSource("/src/quiz/render/NumRail.ts")).toBe(true);
        expect(() => mustHave("/src/quiz/render/NumRail.ts")).not.toThrow();
    });

    it("不在场为假且抛错", () => {
        expect(hasSource("/src/quiz/service/NotThere.ts")).toBe(false);
        expect(() => mustHave("/src/quiz/service/NotThere.ts")).toThrow(/源文件不在/);
    });
});

describe("expectRed（阶段一红清单自检）", () => {
    it("清单里的待产出文件都仍不在：红得名副其实", () => {
        expect(() => expectRed(["/src/quiz/service/NotThere.ts"])).not.toThrow();
    });

    it("清单里混进了已存在的文件即抛错——提醒收口时删清单", () => {
        expect(() => expectRed(["/src/quiz/render/NumRail.ts"])).toThrow(/红清单自检失败/);
    });
});
