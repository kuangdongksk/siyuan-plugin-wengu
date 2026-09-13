import { describe, expect, it } from "vitest";
import { listReviewModel, type ReviewItemModel } from "./ReviewHtml";

/**
 * 错题清单筛选口径（Issue #44 验收 5/7）：qid 集筛选与既有状态/文档
 * 筛选按合取语义——空集=不筛（否则取消筛选后会空清单）、与 docFilter
 * 并存互不覆盖。
 */

function item(qid: string, docId: string, extra: Partial<ReviewItemModel> = {}): ReviewItemModel {
    return { qid, docId, stemSummary: qid, wrongCount: 1, mastered: false, ...extra };
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
