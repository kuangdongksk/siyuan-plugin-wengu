import { describe, expect, it } from "vitest";
import {
    clueOwnerQid,
    clickClueChip,
    disarmClueChip,
    findInText,
    locateInNodes,
    newClueDeleteState,
    normForMatch,
    planMarks,
} from "./ClueMark";

/**
 * 线索标注纯逻辑（Issue #28）：选段定位（空白不敏感 + 跨标签降级）、
 * 高亮计划、chips 两击删除状态机。
 */

describe("normForMatch / findInText", () => {
    it("空白差异不影响定位（跨行选段）", () => {
        const hay = "第一行文字\n  第二行文字";
        expect(findInText(hay, "第一行文字 第二行文字")).toEqual({ start: 0, end: hay.length });
    });

    it("返回原串坐标（含前导空白，归一后等于选段）", () => {
        const hay = "  定位句在这里";
        const hit = findInText(hay, "定位句");
        expect(hit).not.toBeNull();
        expect(normForMatch(hay.slice(hit!.start, hit!.end))).toBe("定位句");
    });

    it("多处出现取首个命中", () => {
        const hay = "abc abc";
        expect(findInText(hay, "abc")).toEqual({ start: 0, end: 3 });
    });

    it("未命中返回 null；空选段不命中", () => {
        expect(findInText("甲乙丙", "丁")).toBeNull();
        expect(findInText("甲乙丙", "   ")).toBeNull();
    });

    it("needle 比 haystack 长直接判否", () => {
        expect(findInText("ab", "abc")).toBeNull();
    });
});

describe("locateInNodes（跨标签边界降级）", () => {
    it("跨标签选段命中首个包含完整文本的节点", () => {
        // <p>洛必达<strong>法则</strong>适用</p> 渲染成三个文本节点
        const nodes = ["洛必达", "法则", "适用"];
        expect(locateInNodes(nodes, "法则")).toEqual({ node: 1, start: 0, end: 2 });
    });

    it("跨节点选段整体不落在单节点时不命中（宁缺勿错）", () => {
        const nodes = ["洛必达", "法则"];
        expect(locateInNodes(nodes, "洛必达法则")).toBeNull();
    });

    it("部分包含（尾部越出）也不命中", () => {
        expect(locateInNodes(["甲乙"], "乙丙")).toBeNull();
    });

    it("按节点序取首个命中", () => {
        const nodes = ["线索", "线索"];
        expect(locateInNodes(nodes, "线索")?.node).toBe(0);
    });
});

describe("planMarks", () => {
    it("逐条算计划，未命中的 hit 为 null", () => {
        const plan = planMarks(["定位句在此", "无关文本"], ["定位句", "找不到的话"]);
        expect(plan[0].hit).toEqual({ node: 0, start: 0, end: 3 });
        expect(plan[1].text).toBe("找不到的话");
        expect(plan[1].hit).toBeNull();
    });

    it("去重且丢掉空选段，保持原始顺序", () => {
        const plan = planMarks(["ab"], ["ab", " ab ", "", "   "]);
        expect(plan.map((p) => p.text)).toEqual(["ab"]);
    });
});

describe("chips 两击删除状态机", () => {
    it("首击 arm、再击同一下标确认", () => {
        const st = newClueDeleteState();
        expect(clickClueChip(st, 1)).toBe("first");
        expect(st.armed).toBe(1);
        expect(clickClueChip(st, 1)).toBe("second");
        expect(st.armed).toBeUndefined();
    });

    it("点别的 chip 把待确认挪过去", () => {
        const st = newClueDeleteState();
        clickClueChip(st, 0);
        expect(clickClueChip(st, 2)).toBe("first");
        expect(st.armed).toBe(2);
    });

    it("disarm 后再次点击回到首击", () => {
        const st = newClueDeleteState();
        clickClueChip(st, 0);
        disarmClueChip(st);
        expect(clickClueChip(st, 0)).toBe("first");
    });
});

describe("clueOwnerQid（chip 归属题反查）", () => {
    it("卡上 chip 取该卡 qid（长卷全卡常驻，非当前题也要删对）", () => {
        expect(clueOwnerQid({ cardQid: "q7", currentQid: "q1" })).toBe("q7");
    });

    it("组题行在 .wengu-gunit 里、无卡 qid 时回落当前题", () => {
        expect(clueOwnerQid({ cardQid: undefined, currentQid: "q1" })).toBe("q1");
    });

    it("两侧都没有则 undefined", () => {
        expect(clueOwnerQid({ cardQid: undefined, currentQid: undefined })).toBeUndefined();
    });
});
