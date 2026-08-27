import { describe, expect, it } from "vitest";
import { buildColTree, summarizeSessions, type ColRowView } from "./CollectionPanel";
import { normalizeCollectionPath } from "../data/QuestionBank";

describe("summarizeSessions", () => {
    it("空会话 = 没刷过", () => {
        expect(summarizeSessions([])).toEqual({ lastAt: undefined, answered: 0, correct: 0 });
    });

    it("聚合轮次并取最近一次开始时间", () => {
        const s = summarizeSessions([
            { startedAt: 1000, answered: 10, correct: 8 },
            { startedAt: 2000, answered: 20, correct: 19 },
            { startedAt: 1500, answered: 5, correct: 1 },
        ]);
        expect(s).toEqual({ lastAt: 2000, answered: 35, correct: 28 });
    });
});

describe("buildColTree", () => {
    const row = (title: string): ColRowView => ({
        id: title,
        title,
        name: title,
        count: 1,
        stat: { answered: 0, correct: 0 },
    });

    it("路径标题按段挂目录，叶子名=末段", () => {
        const root = buildColTree([row("高数/极限/洛必达"), row("高数/极限/泰勒"), row("英语/阅读")]);
        expect(root.rows).toHaveLength(0);
        expect(new Set(root.children.map((c) => c.name))).toEqual(new Set(["英语", "高数"]));
        const gs = root.children.find((c) => c.name === "高数")!;
        expect(gs.children.map((c) => c.name)).toEqual(["极限"]);
        expect(new Set(gs.children[0].rows.map((r) => r.name))).toEqual(new Set(["泰勒", "洛必达"]));
        // title 保留全路径（重命名/悬浮提示用）
        expect(new Set(gs.children[0].rows.map((r) => r.title))).toEqual(
            new Set(["高数/极限/泰勒", "高数/极限/洛必达"])
        );
    });

    it("平铺标题留当前层，与目录共存且按名排序", () => {
        const root = buildColTree([row("错题重练"), row("高数/极限")]);
        expect(root.rows.map((r) => r.name)).toEqual(["错题重练"]);
        expect(root.children.map((c) => c.name)).toEqual(["高数"]);
    });

    it("空标题（规范化后为空）不进树", () => {
        const root = buildColTree([row(" / ")]);
        expect(root.rows).toHaveLength(0);
        expect(root.children).toHaveLength(0);
    });
});

describe("normalizeCollectionPath", () => {
    it("分段 trim、去空段", () => {
        expect(normalizeCollectionPath(" 高数 / 极限 // 洛必达 ")).toBe("高数/极限/洛必达");
    });

    it("无分隔符=普通标题（等价 trim）", () => {
        expect(normalizeCollectionPath("  错题重练 ")).toBe("错题重练");
    });

    it("全空段返回空串", () => {
        expect(normalizeCollectionPath(" / / ")).toBe("");
    });

    it("总长超 60 从整段处截断（不切半段）", () => {
        const long = "a".repeat(30);
        const out = normalizeCollectionPath(`${long}/${long}/${long}`);
        expect(out.length).toBeLessThanOrEqual(60);
        expect(out.split("/").every((s) => s === long)).toBe(true);
    });
});
