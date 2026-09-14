import { describe, expect, it } from "vitest";
import { assignHitsToNodes } from "./MaterialDecorate";
import { dataGlossTableHtml, glossTableHtml, splitGloss } from "./GlossDom";
import { planGlossLinks } from "../../convert/service/gloss/GlossEntry";

/**
 * 词形联动的**落格映射**（Issue #30 渲染侧）与词表区**渲染契约**
 * （Issue #53 三期收拢后本文件的两块内容）：
 *
 * 1. 偏移口径是「全部文本节点原文的拼接」，映射回「节点下标 + 节点内区间」
 *    ——同一节点内的多处命中必须全部落格，正向施工会把后一处推出已被截短
 *    的节点，故映射必须一次性算好再倒序施工（DOM 手术在装饰出口
 *    `MaterialDecorate.applyGlossLinks`，本文件只锁纯函数口径）；
 * 2. 词表区（`@@G` 行）的解析/渲染契约在 `GlossDom`——`ul.wengu-gloss`
 *    是装饰层的**非权威区**与**落格守卫**双重名单成员，类名即契约。
 */

describe("assignHitsToNodes：拼接偏移 → 节点内区间", () => {
    it("同一节点内多处命中各自映射到正确区间", () => {
        const texts = ["Funding is crucial here."];
        const starts = [0];
        const hits = planGlossLinks(texts[0], [
            { word: "funding", phonetic: "", meaning: "" },
            { word: "crucial", phonetic: "", meaning: "" },
        ]);
        const slots = assignHitsToNodes(texts, starts, hits);
        expect(slots).toEqual([
            { node: 0, from: 0, to: 7 },
            { node: 0, from: 11, to: 18 },
        ]);
        // 倒序施工时，先切后段不影响前段偏移（区间互不重叠）
        expect(slots[0].to).toBeLessThanOrEqual(slots[1].from);
    });

    it("多节点：命中跨节点则放弃（node=-1），不越界硬切", () => {
        const texts = ["Funding ", "is crucial."];
        const starts = [0, 8];
        const hits = planGlossLinks(texts.join(""), [
            { word: "funding", phonetic: "", meaning: "" },
            { word: "crucial", phonetic: "", meaning: "" },
        ]);
        expect(assignHitsToNodes(texts, starts, hits)).toEqual([
            { node: 0, from: 0, to: 7 },
            { node: 1, from: 3, to: 10 },
        ]);
    });

    it("拼接文本里跨节点的命中（词被拆到两个节点）→ 放弃", () => {
        const texts = ["fund", "ing is key"];
        const starts = [0, 4];
        const hits = [{ start: 0, end: 7, order: 1, text: "funding" }];
        expect(assignHitsToNodes(texts, starts, hits)).toEqual([{ node: -1, from: 0, to: 0 }]);
    });

    it("空命中零动作", () => {
        expect(assignHitsToNodes(["a"], [0], [])).toEqual([]);
    });
});

describe("词表区渲染契约（GlossDom）：类名即装饰层名单（Issue #53）", () => {
    it("词条 → ul.wengu-gloss + li.wengu-gloss-item + 三段 span", () => {
        const html = dataGlossTableHtml([{ word: "funding", phonetic: "['fʌndɪŋ]", meaning: "n. 资金" }]);
        expect(html).toContain('<ul class="wengu-gloss" data-gloss>');
        expect(html).toContain('<li class="wengu-gloss-item">');
        expect(html).toContain('<span class="wengu-gloss-word">funding</span>');
        expect(html).toContain('<span class="wengu-gloss-ph">');
        expect(html).toContain('<span class="wengu-gloss-mn">');
    });

    it("无词条 ⇒ 空串（装饰出口不进词表区 HTML，正文逐字节不回归）", () => {
        expect(dataGlossTableHtml([])).toBe("");
    });

    it("原文入口（先拆正文/词表再渲染）与数据入口同产物", () => {
        const md = "正文段落\n\n@@G funding | ['fʌndɪŋ] | n. 资金";
        expect(glossTableHtml(md)).toBe(
            dataGlossTableHtml([{ word: "funding", phonetic: "['fʌndɪŋ]", meaning: "n. 资金" }])
        );
        expect(splitGloss(md).body).toBe("正文段落");
    });

    it("无 @@G 行 ⇒ 正文逐字原样、词表为空", () => {
        expect(splitGloss("纯正文\n\n第二段")).toEqual({ body: "纯正文\n\n第二段", entries: [] });
    });
});
