import { describe, expect, it } from "vitest";
import { estimateOptWidth } from "../../types";
import { mdFragmentHtml, optionRowHtml, unwrapSingleBlock } from "./ProtyleHost";

/**
 * 短选项紧凑排布（opt-compact，20260829；docs/option-compact-layout.md）：
 * ① unwrapSingleBlock 剥壳——20260830 渲染自包含化后 MdRender 产出的
 * 段落是 `<div class="p">内联正文</div>`（无 Lute 时代的 contenteditable
 * 壳/protyle-attr 尾巴），剥壳取内联 HTML；多块/代码块/标题/形态漂移
 * 一律返回 null（整行独占）。旧 Lute 残渣形态仍兼容（存量渲染缓存）。
 * ② estimateOptWidth 估宽——公式段定值 8、全角 2、半角 1，档位
 * s≤10 / m≤24。渲染底层 markdown-it 纯 JS，node 直跑无需 stub。
 */

/** MdRender 段落形态模板。 */
const pWrap = (inner: string) => `<div class="p">${inner}</div>`;

/** 旧 Lute 残渣形态（contenteditable 正文 + protyle-attr 尾巴）。 */
const pLegacy = (inner: string) =>
    '<div data-node-id="20260829000000-abc1234" data-type="NodeParagraph" class="p">' +
    `<div contenteditable="true" spellcheck="false">${inner}</div>` +
    '<div class="protyle-attr" contenteditable="false">\u200B</div></div>';

describe("unwrapSingleBlock：渲染输出剥壳", () => {
    it("单段落块取内联正文（公式 span 原样保留）", () => {
        const inner =
            '甲<span data-type="inline-math" data-subtype="math" data-content="\\frac{\\pi}{6}" contenteditable="false" class="render-node"></span>';
        expect(unwrapSingleBlock(pWrap(inner))).toBe(inner);
    });

    it("旧 Lute 残渣形态仍可剥壳（兼容）", () => {
        expect(unwrapSingleBlock(pLegacy("甲"))).toBe("甲");
    });

    it("两个顶层块返回 null（多块选项整行独占）", () => {
        expect(unwrapSingleBlock(pWrap("a") + pWrap("b"))).toBeNull();
    });

    it("非段落块返回 null：列表/代码块/标题/pre 降级", () => {
        expect(unwrapSingleBlock('<div class="list"><div class="li">a</div></div>')).toBeNull();
        expect(unwrapSingleBlock("<pre>甲</pre>")).toBeNull();
        expect(unwrapSingleBlock('<h1 data-node-id="x">题</h1>')).toBeNull();
        expect(unwrapSingleBlock("")).toBeNull();
    });

    it("顶层 class 带附加类（p fn__flex）仍认段落", () => {
        expect(unwrapSingleBlock('<div class="p fn__flex">a</div>')).toBe("a");
    });
});

describe("estimateOptWidth：估宽（半角单位）", () => {
    it("公式段每段定值 8（含 $$ 块式记法）", () => {
        expect(estimateOptWidth("$\\frac{\\pi}{6}$")).toBe(8);
        expect(estimateOptWidth("$$x$$")).toBe(8);
        expect(estimateOptWidth("$a$b$c$")).toBe(8 + 1 + 8); // 两段公式夹半角
    });

    it("纯文本全角 2、半角 1", () => {
        expect(estimateOptWidth("甲乙")).toBe(4);
        expect(estimateOptWidth("ab")).toBe(2);
        expect(estimateOptWidth("")).toBe(0);
    });

    it("混排逐段累加", () => {
        expect(estimateOptWidth("甲$x>1$乙")).toBe(2 + 8 + 2);
    });
});

describe("optionRowHtml：估宽档类（markdown-it 直跑）", () => {
    it("短选项加 s 档、中长加 m 档、长选项无档类", () => {
        expect(optionRowHtml(0, "- A. $x$")).toContain('class="wengu-option-fallback wengu-opt-s"');
        expect(optionRowHtml(1, "B、甲乙丙丁戊己")).toContain('class="wengu-option-fallback wengu-opt-m"');
        expect(optionRowHtml(2, "C. 一段很长很长的选项文本超过两档阈值")).toContain('class="wengu-option-fallback"');
    });

    it("正文为剥壳后的内联 HTML（$ 桥产出思源同款公式占位）", () => {
        const row = optionRowHtml(0, "A. $x$");
        expect(row).toContain('data-type="inline-math"');
        expect(row).not.toContain('class="p"');
        expect(row).not.toContain("protyle-attr");
    });

    it("复习行类与档类并存", () => {
        expect(optionRowHtml(0, "甲", "wengu-review-option")).toContain('class="wengu-review-option wengu-opt-s"');
    });

    it("静态输出全链路无 contenteditable=true（防误编辑，含剥壳失败的多块选项）", () => {
        expect(optionRowHtml(0, "A. 甲")).not.toContain('contenteditable="true"');
        // 空行分段 → 两个顶层块 → 剥壳失败整行独占，同样不可编辑
        expect(optionRowHtml(1, "B. 行一\n\n行二")).not.toContain('contenteditable="true"');
        expect(mdFragmentHtml("题干 $x$")).not.toContain('contenteditable="true"');
    });
});
