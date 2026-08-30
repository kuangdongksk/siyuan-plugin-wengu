import { describe, expect, it } from "vitest";
import { renderMdHtml } from "./MdRender";

/** 渲染自包含化（20260830，替代 window.Lute/Md2BlockDOM）：段落形态
 *  对齐（div.p）、$ 数学桥（思源同款占位形态喂 ProtyleMethod.mathRender）、
 *  IAL 残渣清理、块引用转「查看原文」链接、裸 HTML 转义。 */

describe("renderMdHtml：段落与常规语法", () => {
    it("段落输出 div.p（与 Lute 形态对齐，无 contenteditable 壳）", () => {
        const html = renderMdHtml("题干文本");
        expect(html).toBe('<div class="p">题干文本</div>');
        expect(html).not.toContain("contenteditable");
        expect(html).not.toContain("protyle-attr");
    });

    it("多段落多块，加粗斜体等行内语法生效", () => {
        const html = renderMdHtml("第一段\n\n第二段 **加粗**");
        expect(html).toContain('<div class="p">第一段</div>');
        expect(html).toContain("<strong>加粗</strong>");
    });

    it("源内裸 HTML 一律转义（html:false）", () => {
        const html = renderMdHtml('甲 <script>alert(1)</script> <img src=x onerror="y">');
        expect(html).not.toContain("<script>");
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;script&gt;");
    });
});

describe("renderMdHtml：数学桥（$ 占位形态）", () => {
    it("行内 $...$ → 思源同款 inline-math span（data-content 带源码）", () => {
        const html = renderMdHtml("求 $\\frac{\\pi}{6}$ 的值");
        expect(html).toContain('data-type="inline-math"');
        expect(html).toContain('data-content="\\frac{\\pi}{6}"');
        expect(html).toContain('class="render-node"');
    });

    it("块级 $$...$$ → NodeMathBlock 占位（单行与跨行）", () => {
        expect(renderMdHtml("$$x = 1$$")).toContain('data-type="NodeMathBlock"');
        expect(renderMdHtml("$$\nx = 1\ny = 2\n$$")).toContain('data-type="NodeMathBlock"');
    });

    it("未闭合 $ 不吞文本；空公式 $$ 不产出占位", () => {
        expect(renderMdHtml("价格 5$ 美元")).toContain("5$");
        expect(renderMdHtml("甲 $ 乙")).not.toContain("inline-math");
    });

    it("代码围栏内的 $ 不转公式（tokenizer 级规则优于后处理）", () => {
        const html = renderMdHtml("```\n$a$ = 1\n```");
        expect(html).not.toContain("inline-math");
    });

    it("data-content 属性转义（公式含引号不断属性）", () => {
        const html = renderMdHtml('$x \\text{"}$');
        expect(html).toMatch(/data-content="[^"]*&quot;/);
    });
});

describe("renderMdHtml：kramdown 残渣", () => {
    it("IAL 整行删行、行内尾随删片段（BankParse 同款清理）", () => {
        const html = renderMdHtml('- {: id="20260829000000-abc1234" updated="x"}A. 选项');
        expect(html).not.toContain("{:");
        expect(html).toContain("A. 选项");
    });

    it("块引用语法 → 查看原文 span（文本经 html:false 转义）", () => {
        const html = renderMdHtml('见 ((20260814063055-abcdefgh "极限 <定义>")) 一节');
        expect(html).toContain('class="wengu-blockref"');
        expect(html).toContain('data-wengu-blockref="20260814063055-abcdefgh"');
        expect(html).toContain("极限 &lt;定义&gt;");
    });

    it("普通括号文本不受块引用规则误伤", () => {
        expect(renderMdHtml("(甲) ((乙))")).not.toContain("wengu-blockref");
    });
});
