import { describe, expect, it } from "vitest";
import { NON_CANON_SELECTOR, NO_WRAP_SELECTOR, planClueMarks } from "./MaterialDecorate";
import { buildCanonMap, remapCanon } from "./ClueCanon";
import { markSlots } from "../flow/ClueMark";

/**
 * 装饰出口的**判定链**（Issue #52 二期验收 4/5/6）：坐标优先 → 文本匹配
 * 降级 → 只出 chip 的三分支，以及「mark 包住联动 <u>」的嵌套顺序矩阵。
 *
 * 纯逻辑层可测（DOM 观测/施工在 decorateMaterial）：本文件不启 jsdom，
 * 喂的是与施工后节点表同形的文本数组。选择器口径（非权威区/落格守卫）
 * 用字符串断言锁死——多写一个类就等于把那几个字从权威串里挖掉。
 */

/** 一句英语材料装饰后的节点表：`Funding` 被词形联动包成 `<u>词</u>` + 上标。 */
function glossedNodes(): string[] {
    // [0]"Fund"（<u> 内，权威） [1]"1·补"（上标，非权威）
    // [2]"ing is crucial"（正文，权威） [3]"here."（正文，权威）
    return ["Fund", "1·补", "ing is crucial", "here."];
}

/** 权威表（装饰前）→ 装饰后重算（与 decorateMaterial 第 ④ 步同口径）。 */
function canonAfterGloss() {
    const base = buildCanonMap(["Funding is crucial", "here."], [0, 1]);
    const texts = glossedNodes();
    const isCanon = [true, false, true, true];
    return { map: remapCanon(base, texts, isCanon), texts };
}

describe("planClueMarks：降级链三分支（D6）", () => {
    it("主路径：坐标校验通过 ⇒ 按坐标落格，不依赖文本匹配", () => {
        const { map, texts } = canonAfterGloss();
        const { plan, resolved } = planClueMarks(map, texts, [{ text: "crucial", range: { s: 11, e: 18 } }]);
        expect(plan[0].hits).toEqual([{ node: 2, start: 7, end: 14 }]);
        expect(resolved[0]).toEqual({ text: "crucial", range: { s: 11, e: 18 } });
    });

    it("坐标漂移（材料被增量重转）⇒ 校验拦下，降级文本匹配求坐标", () => {
        const { map, texts } = canonAfterGloss();
        // 存储 text 与切片不符（错位线索）⇒ 坐标作废、走文本匹配
        const { plan, resolved } = planClueMarks(map, texts, [{ text: "here.", range: { s: 0, e: 5 } }]);
        expect(plan[0].hits.length).toBeGreaterThan(0);
        // 权威串 = "Funding is crucial" + "here."，here. 在权威偏移 18..23
        expect(resolved[0].range).toEqual({ s: 18, e: 23 });
    });

    it("无坐标的存量线索 ⇒ 文本匹配（#51 修复版）当场求坐标，用完即弃", () => {
        const { map, texts } = canonAfterGloss();
        const { plan, resolved } = planClueMarks(map, texts, [{ text: "ing is" }]);
        expect(plan[0].hits).toEqual([{ node: 2, start: 0, end: 6 }]);
        expect(resolved[0]).toEqual({ text: "ing is", range: { s: 4, e: 10 } });
    });

    it("文本也匹配不上 ⇒ 只出 chip（hits 空、无坐标），不报错", () => {
        const { map, texts } = canonAfterGloss();
        const { plan, resolved } = planClueMarks(map, texts, [{ text: "完全不存在的一段" }]);
        expect(plan[0].hits).toEqual([]);
        expect(resolved[0]).toEqual({ text: "完全不存在的一段" });
    });

    it("验收 3：有坐标 ⇒ 不依赖文本匹配也能落格（文本在节点表里根本不存在）", () => {
        const { map, texts } = canonAfterGloss();
        // 权威串含 "crucial"，但节点表被装饰切成 ["Fund","ing is crucial","here."]
        // ——坐标口径与文本匹配口径不同源，坐标命中不依赖当前节点边界
        const { plan, resolved } = planClueMarks(map, texts, [{ text: "crucial", range: { s: 11, e: 18 } }]);
        expect(plan[0].hits).toEqual([{ node: 2, start: 7, end: 14 }]);
        expect(resolved[0].range).toEqual({ s: 11, e: 18 });
    });

    it("重复文本只算一次（与 planMarks 同口径）", () => {
        const { map, texts } = canonAfterGloss();
        const { plan } = planClueMarks(map, texts, [{ text: "here." }, { text: "here." }]);
        expect(plan.length).toBe(1);
    });
});

describe("嵌套顺序矩阵：mark × gloss 词（二期验收 1/6）", () => {
    it("选段跨『联动词 + 上标 + 后半词』：mark 落在权威节点上，上标不参与", () => {
        const { map, texts } = canonAfterGloss();
        // 「Funding is」横跨 <u>内的 "Fund"、跳过上标（非权威）、继续 "ing is"
        const { plan } = planClueMarks(map, texts, [{ text: "Funding is", range: { s: 0, e: 10 } }]);
        expect(plan[0].hits).toEqual([
            { node: 0, start: 0, end: 4 },
            { node: 2, start: 0, end: 6 },
        ]);
        // 上标（节点 1）不在任何落格计划里 ⇒ mark 包不住它
        expect(plan[0].hits.some((h) => h.node === 1)).toBe(false);
    });

    it("跨 **加粗** 选段：两个权威节点各落一段（mark 可跨元素）", () => {
        const base = buildCanonMap(["位置**关键词**训练"], [0]);
        // 装饰后（加粗由渲染器切成节点）：位置 / 关键词 / 训练
        const texts = ["位置", "关键词", "训练"];
        const map = remapCanon(base, texts, [true, true, true]);
        const { plan } = planClueMarks(map, texts, [{ text: "置关键词训", range: { s: 1, e: 6 } }]);
        expect(plan[0].hits).toEqual([
            { node: 0, start: 1, end: 2 },
            { node: 1, start: 0, end: 3 },
            { node: 2, start: 0, end: 1 },
        ]);
        // 施工序：节点升序 + 节点内起点降序（同节点内靠后的段先切）
        const slots = markSlots(plan);
        expect(slots.map((s) => s.node)).toEqual([0, 1, 2]);
    });

    it("同一节点内两条线索：施工序自后向前（否则第二条静默不落格）", () => {
        const base = buildCanonMap(["Funding is crucial"], [0]);
        const texts = ["Funding is crucial"];
        const map = remapCanon(base, texts, [true]);
        const { plan } = planClueMarks(map, texts, [
            { text: "Funding", range: { s: 0, e: 7 } },
            { text: "crucial", range: { s: 11, e: 18 } },
        ]);
        const slots = markSlots(plan);
        expect(slots.map((s) => s.start)).toEqual([11, 0]);
    });
});

describe("选择器口径（多写一个类 = 权威串被挖掉几个字）", () => {
    it("非权威区含词表区/上标/选项区/解析区/公式占位与控件", () => {
        for (const cls of [
            ".wengu-gloss",
            "button",
            "mark",
            ".wengu-static-sol",
            ".wengu-opts",
            ".wengu-option-fallback",
            "[data-type='inline-math']",
            "[data-type='NodeMathBlock']",
        ]) {
            expect(NON_CANON_SELECTOR).toContain(cls);
        }
    });

    it("联动词形 .wengu-gloss-link **不在**非权威表（<u> 包的就是原文本身）", () => {
        // 回归 Issue #51：排除它 ⇒ 含联动词的选段整段锚点失败
        expect(NON_CANON_SELECTOR).not.toContain(".wengu-gloss-link");
    });

    it("落格守卫只挡『不许被包』：上标与词表区（不进匹配源口径）", () => {
        expect(NO_WRAP_SELECTOR).toContain(".wengu-gloss-sup");
        expect(NO_WRAP_SELECTOR).toContain(".wengu-gloss");
    });
});
