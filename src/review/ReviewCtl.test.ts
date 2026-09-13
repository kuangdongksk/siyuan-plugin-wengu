import { beforeEach, describe, expect, it } from "vitest";
import { reviewCtl } from "./core/ReviewCtl";

/**
 * 「回顾」的 qid 集筛选状态机（Issue #44）：同集再点=取消、空集=不筛、
 * 不同集原地替换、与文档筛互斥（进入 qid 筛时清文档筛，避免静默变窄）。
 * 模块级单例：用各用例独有的 qid 隔离，只动公开 API。
 */

const sorted = (s: Set<string> | undefined): string[] => [...(s ?? [])].sort();

describe("ReviewCtl qidFilter", () => {
    beforeEach(() => reviewCtl.clearQidFilter()); // 上一用例可能留筛

    it("set → 生效；同集再点 → 取消（回全部）", () => {
        reviewCtl.filterQids(["q1", "q2"]);
        expect(sorted(reviewCtl.qidFilterNow())).toEqual(["q1", "q2"]);
        reviewCtl.filterQids(["q2", "q1"]); // 同集（顺序无关）
        expect(reviewCtl.qidFilterNow()).toBeUndefined();
    });

    it("空集 = 不筛（不是筛出零条）", () => {
        reviewCtl.filterQids(["q-a"]);
        reviewCtl.filterQids([]);
        expect(reviewCtl.qidFilterNow()).toBeUndefined();
    });

    it("不同集 → 原地替换", () => {
        reviewCtl.filterQids(["q-b"]);
        reviewCtl.filterQids(["q-c", "q-d"]);
        expect(sorted(reviewCtl.qidFilterNow())).toEqual(["q-c", "q-d"]);
    });

    it("进入 qid 筛清掉文档筛（单一维度，不静默变窄）", () => {
        reviewCtl.filterDoc("doc-A"); // 侧栏点文档
        expect(reviewCtl.docFilterNow()).toBe("doc-A");
        reviewCtl.filterQids(["q-e", "q-f"]);
        expect(reviewCtl.docFilterNow()).toBe("");
    });

    it("clear → 回全部（头部徽标一键取消）", () => {
        reviewCtl.filterQids(["q-g", "q-h"]);
        reviewCtl.clearQidFilter();
        expect(reviewCtl.qidFilterNow()).toBeUndefined();
    });
});
