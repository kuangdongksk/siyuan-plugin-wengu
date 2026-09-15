import { describe, expect, it } from "vitest";
import { listReviewModel, rowDateOf, rowDateTitle } from "./ReviewHtml";
import type { ReviewItem } from "./core/ReviewUi";

/**
 * 错题清单筛选口径（Issue #44 验收 5/7）：qid 集筛选与既有状态/文档
 * 筛选按合取语义——空集=不筛（否则取消筛选后会空清单）、与 docFilter
 * 并存互不覆盖。
 */

function item(qid: string, docId: string, extra: Partial<ReviewItem> = {}): ReviewItem {
    return { qid, docId, stemSummary: qid, wrongCount: 1, mastered: false, attempts: [], ...extra };
}

const titleOf = (id: string) => `doc:${id}`;
const all = [
    item("q1", "docA"),
    item("q2", "docA", { mastered: true, wrongCount: 3 }),
    item("q3", "docB"),
    item("q4", "docB", { mastered: true }),
];

describe("listReviewModel qidFilter（相关题「回顾」筛选）", () => {
    it("空集/未传 = 不筛（全部错题照常）", () => {
        expect(listReviewModel(all, "all", "recent", "", titleOf).total).toBe(4);
        expect(listReviewModel(all, "all", "recent", "", titleOf, new Set()).total).toBe(4);
    });

    it("只留 qid 集里的题", () => {
        const m = listReviewModel(all, "all", "recent", "", titleOf, new Set(["q1", "q3"]));
        expect(m.total).toBe(2);
        expect(m.groups.flatMap((g) => g.items.map((i) => i.qid)).sort()).toEqual(["q1", "q3"]);
    });

    it("集里没有的 qid 不影响（不在库的题被忽略）", () => {
        const m = listReviewModel(all, "all", "recent", "", titleOf, new Set(["q1", "gone"]));
        expect(m.total).toBe(1);
    });

    it("与状态筛选合取（相关题 ∩ 未掌握）；统计仍按 qid 域算，不随状态筛变", () => {
        const m = listReviewModel(all, "pending", "recent", "", titleOf, new Set(["q2", "q3"]));
        expect(m.groups.flatMap((g) => g.items.map((i) => i.qid))).toEqual(["q3"]); // q2 已掌握被状态筛掉
        expect(m.total).toBe(2); // 域口径：q2+q3
        expect(m.pending).toBe(1);
    });

    it("与文档筛选合取（相关题 ∩ 文档），互不覆盖", () => {
        const m = listReviewModel(all, "all", "recent", "docB", titleOf, new Set(["q1", "q3", "q4"]));
        expect(m.groups.map((g) => g.docId)).toEqual(["docB"]);
        expect(m.groups[0].items.map((i) => i.qid)).toEqual(["q3", "q4"]);
        expect(m.total).toBe(3); // 域口径（q1+q3+q4），文档筛只收窄清单
    });

    it("统计口径随 qid 域走（旧口径：文档/状态筛不改概览）", () => {
        const m = listReviewModel(all, "all", "recent", "", titleOf, new Set(["q2", "q3", "q4"]));
        expect(m.total).toBe(3);
        expect(m.pending).toBe(1); // q3
        expect(m.mastered).toBe(2); // q2/q4
        // 文档筛只收窄清单，不动概览（改造前口径）
        const docScoped = listReviewModel(all, "all", "recent", "docB", titleOf, new Set(["q2", "q3", "q4"]));
        expect(docScoped.total).toBe(3);
        expect(docScoped.groups.flatMap((g) => g.items.map((i) => i.qid))).toEqual(["q3", "q4"]);
    });

    it("筛后为空 = 空清单（组件据此出「该筛选下没有错题」）", () => {
        const m = listReviewModel(all, "all", "recent", "", titleOf, new Set(["nope"]));
        expect(m.total).toBe(0);
        expect(m.groups).toEqual([]);
    });
});

describe("listReviewModel 显示层（Issue #136 §7.e / §5.3）", () => {
    const item2 = (qid: string, docId: string): ReviewItem =>
        item(qid, docId, { attempts: [], lastWrongAt: new Date(2026, 8, 13, 21, 4).getTime() });

    it("题集名剥结尾「-题解」（组头与行头同源）；全名随组带着供悬停", () => {
        const rows = [item2("q1", "doc1"), item2("q2", "doc2")];
        const titles: Record<string, string> = {
            doc1: "考研数学强化通关330·线性代数-题解",
            doc2: "高数第一章",
        };
        const m = listReviewModel(rows, "all", "recent", "", (id) => titles[id] ?? id);
        const byId = new Map(m.groups.map((g) => [g.docId, g]));
        expect(byId.get("doc1")!.docTitle).toBe("考研数学强化通关330·线性代数");
        expect(byId.get("doc1")!.docTitleFull).toBe("考研数学强化通关330·线性代数-题解"); // 悬停保真
        expect(byId.get("doc2")!.docTitle).toBe("高数第一章"); // 无后缀原样
    });

    it("aggregated：未筛文档=「全部」聚合视图（行头出题集名）", () => {
        const rows = [item2("q1", "docA"), item2("q2", "docB")];
        expect(listReviewModel(rows, "all", "recent", "", titleOf).aggregated).toBe(true);
    });

    it("aggregated：按文档筛（侧栏点文档）时关掉（组头已表达归属，行内省同名列）", () => {
        const rows = [item2("q1", "docA"), item2("q2", "docB")];
        const m = listReviewModel(rows, "all", "recent", "docB", titleOf);
        expect(m.aggregated).toBe(false);
        expect(m.groups.map((g) => g.docId)).toEqual(["docB"]);
    });

    it("行头日期：同年 MM-DD、跨年 YYYY-MM-DD、无时间戳出空串（列不塌陷）", () => {
        const now = new Date(2026, 8, 15, 12, 0).getTime();
        expect(rowDateOf(new Date(2026, 8, 13, 21, 4).getTime(), now)).toBe("09-13");
        expect(rowDateOf(new Date(2025, 11, 30, 9, 12).getTime(), now)).toBe("2025-12-30");
        expect(rowDateOf(undefined, now)).toBe("");
        expect(rowDateTitle(new Date(2026, 8, 13, 21, 4).getTime())).toBe("2026-09-13 21:04");
        expect(rowDateTitle(undefined)).toBe("");
    });
});
