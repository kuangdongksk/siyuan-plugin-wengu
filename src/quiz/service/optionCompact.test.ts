import { beforeAll, describe, expect, it } from "vitest";
import { estimateOptWidth } from "../../types";
import { mdFragmentHtml, optionRowHtml, unwrapSingleBlock } from "./ProtyleHost";

/**
 * 短选项紧凑排布（opt-compact，20260829；docs/option-compact-layout.md）：
 * ① unwrapSingleBlock 剥壳——真机段落形态（3.8.1 lute.min.js node 探针）：
 * `<div … class="p"><div contenteditable="true">正文</div><div class=
 * "protyle-attr">…</div></div>`，取正文壳的内联 HTML（luteToHtml 已先剥
 * contenteditable=true 防误编辑，故运行时壳多无该属性——两种形态都认）；
 * 多块/代码块/标题/pre 降级/形态漂移一律返回 null（整行独占）。
 * ② estimateOptWidth 估宽——公式段定值 8、全角 2、半角 1，档位
 * s≤10 / m≤24。optionRowHtml 的档类只在 Lute 可用（剥壳成功）时出现，
 * 故用 stub window.Lute 走真分支；与 ProtyleHost.test.ts 分文件——
 * vitest 按文件隔离模块级 sharedLute 缓存，互不污染。
 */

/** 真机段落壳模板（contenteditable 正文 + protyle-attr 尾巴）。 */
const pWrap = (inner: string) =>
    '<div data-node-id="20260829000000-abc1234" data-node-index="1" data-type="NodeParagraph" class="p">' +
    `<div contenteditable="true" spellcheck="false">${inner}</div>` +
    '<div class="protyle-attr" contenteditable="false">\u200B</div></div>';

describe("unwrapSingleBlock：Lute 输出剥壳", () => {
    it("单段落块取 contenteditable 正文（公式 span 原样保留）", () => {
        const inner =
            '甲<span data-type="inline-math" data-subtype="math" data-content="\\frac{\\pi}{6}" contenteditable="false" class="render-node"></span>';
        expect(unwrapSingleBlock(pWrap(inner))).toBe(inner);
    });

    it("内层属性实体化 &gt; 不干扰（深度扫描只数 div 标签）", () => {
        expect(unwrapSingleBlock(pWrap('<span data-content="&gt;">t</span>'))).toBe(
            '<span data-content="&gt;">t</span>'
        );
    });

    it("顶层 class 带附加类（p fn__flex）仍认段落", () => {
        const html =
            '<div class="p fn__flex" data-node-id="x"><div contenteditable="true" spellcheck="false">a</div>' +
            '<div class="protyle-attr" contenteditable="false">\u200B</div></div>';
        expect(unwrapSingleBlock(html)).toBe("a");
    });

    it("两个顶层块返回 null（多块选项整行独占）", () => {
        expect(unwrapSingleBlock(pWrap("a") + pWrap("b"))).toBeNull();
    });

    it("非段落块返回 null：列表/代码块/标题/pre 降级", () => {
        expect(unwrapSingleBlock('<div class="list"><div class="li">a</div></div>')).toBeNull();
        expect(
            unwrapSingleBlock('<div class="code-block" data-node-id="x"><div class="protyle-action">.</div></div>')
        ).toBeNull();
        expect(unwrapSingleBlock('<h1 data-node-id="x">题</h1>')).toBeNull();
        expect(unwrapSingleBlock("<pre>甲</pre>")).toBeNull();
        expect(unwrapSingleBlock("")).toBeNull();
    });

    it("形态漂移（正文壳整体缺失）返回 null 整行独占", () => {
        expect(unwrapSingleBlock('<div class="p">直接正文</div>')).toBeNull();
    });

    it("正文壳无属性（luteToHtml 已剥 contenteditable）仍可剥壳", () => {
        const stripped =
            '<div data-node-id="x" data-type="NodeParagraph" class="p"><div spellcheck="false">甲</div>' +
            '<div class="protyle-attr">\u200B</div></div>';
        expect(unwrapSingleBlock(stripped)).toBe("甲");
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

describe("optionRowHtml：估宽档类（stub Lute 走剥壳真分支）", () => {
    beforeAll(() => {
        // 对齐真机 Md2BlockDOM 段落形态（见文件头 pWrap）
        (globalThis as unknown as { window?: unknown }).window = {
            Lute: {
                New: () => ({
                    SetKramdownIAL() {},
                    SetInlineMath() {},
                    SetInlineMathAllowDigitAfterOpenMarker() {},
                    Md2BlockDOM: (md: string) => pWrap(md),
                }),
            },
        };
    });

    it("短选项加 s 档、中长加 m 档、长选项无档类", () => {
        expect(optionRowHtml(0, "- A. $x$")).toContain('class="wengu-option-fallback wengu-opt-s"');
        expect(optionRowHtml(1, "B、甲乙丙丁戊己")).toContain('class="wengu-option-fallback wengu-opt-m"');
        expect(optionRowHtml(2, "C. 一段很长很长的选项文本超过两档阈值")).toContain('class="wengu-option-fallback"');
    });

    it("正文为剥壳后的内联 HTML（无段落壳/protyle-attr）", () => {
        const row = optionRowHtml(0, "A. $x$");
        expect(row).toContain('<div class="wengu-opt-body">$x$</div>');
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
