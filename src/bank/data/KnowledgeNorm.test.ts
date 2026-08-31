import { describe, expect, it } from "vitest";
import { knKey, normalizeKnowledge } from "./KnowledgeNorm";

describe("normalizeKnowledge", () => {
    it("命名性后缀剥离：洛必达法则 → 洛必达", () => {
        expect(normalizeKnowledge("洛必达法则")).toBe("洛必达");
        expect(normalizeKnowledge("洛必达")).toBe("洛必达");
    });

    it("同族命名后缀：定理/定律/公式/原理 同归词干", () => {
        expect(normalizeKnowledge("勾股定理")).toBe("勾股");
        expect(normalizeKnowledge("牛顿第二定律")).toBe("牛顿第二");
        expect(normalizeKnowledge("万有引力公式")).toBe("万有引力");
        expect(normalizeKnowledge("勒夏特列原理")).toBe("勒夏特列");
    });

    it("装饰剥离：空白/书名号/全角空格/尾部「的」", () => {
        expect(normalizeKnowledge(" 洛必达法则 ")).toBe("洛必达");
        expect(normalizeKnowledge("《洛必达法则》")).toBe("洛必达");
        expect(normalizeKnowledge("洛必达　法则")).toBe("洛必达"); // 全角空格
        expect(normalizeKnowledge("极限的")).toBe("极限");
    });

    it("宁漏并勿错并：动作/范畴后缀不剥，保护考查对象", () => {
        // 「极限的计算」剥成「极限」会把「极限的计算」与「极限的概念」误并
        expect(normalizeKnowledge("极限的计算")).toBe("极限的计算");
        expect(normalizeKnowledge("极限的求法")).toBe("极限的求法");
        expect(normalizeKnowledge("单调性的判定")).toBe("单调性的判定");
        expect(normalizeKnowledge("函数的性质")).toBe("函数的性质");
    });

    it("剥后缀不得掏空主体：「法则」本身不剥", () => {
        expect(normalizeKnowledge("法则")).toBe("法则");
        expect(normalizeKnowledge("定理")).toBe("定理");
    });

    it("无后缀原样（去装饰后）", () => {
        expect(normalizeKnowledge("极限")).toBe("极限");
        expect(normalizeKnowledge("文言文虚词")).toBe("文言文虚词");
    });

    it("空文本/纯装饰 → 空串", () => {
        expect(normalizeKnowledge("")).toBe("");
        expect(normalizeKnowledge("   ")).toBe("");
        expect(normalizeKnowledge("的")).toBe("");
    });
});

describe("knKey", () => {
    it("两措辞同键：洛必达 = 洛必达法则", () => {
        expect(knKey("洛必达")).toBe(knKey("洛必达法则"));
        expect(knKey("洛必达")).toBe("kn:洛必达");
    });

    it("空 knowledge → 空串（不落 kn: 键）", () => {
        expect(knKey("")).toBe("");
    });
});
