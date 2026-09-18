import { describe, expect, it } from "vitest";
import { renderAiTextHtml } from "./agentPanel";

/**
 * 页内 AI 输出区的形态（Issue #177 验收 2）：**AI 正文走 markdown 渲染，
 * 加载/空回复/失败文案走纯文本**。
 *
 * 断言走 `renderAiTextHtml`（从 `runAgentTextOrPanel` 里抽出的纯函数）：
 * 该函数无 DOM 依赖，node 环境（vitest 不开 jsdom）可直接断言；
 * 「调用方真的把它写进 innerHTML」由源级断言锁（本文件末段）。
 */
describe("renderAiTextHtml：AI 正文 markdown 渲染", () => {
    it("**粗体** 出 <strong>（原来 textContent 是字面星号）", () => {
        const html = renderAiTextHtml("body", "**总评**：本轮不错。");
        expect(html).toContain("<strong>总评</strong>");
        expect(html).not.toContain("**");
    });

    it("列表出 ul/li（原来挤成一行；条目正文按 MdRender 惯例裹 div.p）", () => {
        const html = renderAiTextHtml("body", "- 极限：3 对 / 1 错\n- 导数：2 对 / 0 错");
        expect(html).toContain("<ul>");
        expect(html).toContain('<li><div class="p">极限：3 对 / 1 错</div></li>');
        expect(html.match(/<li>/g)?.length).toBe(2);
    });

    it("段落落 div.p（MdRender 形态，段距靠容器基线）", () => {
        expect(renderAiTextHtml("body", "第一段\n\n第二段")).toContain('<div class="p">第一段</div>');
    });

    it("AI 带入的裸 HTML 被转义（不因改 innerHTML 而放开）", () => {
        const html = renderAiTextHtml("body", '见 <img src=x onerror="y"> 与 <script>alert(1)</script>');
        expect(html).not.toContain("<img");
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
    });

    it("数学卷解析里的 $…$ 出思源同款公式占位（KaTeX 补渲不在本通道）", () => {
        expect(renderAiTextHtml("body", "由 $x^2$ 得")).toContain('data-type="inline-math"');
    });
});

describe("renderAiTextHtml：加载/空回复/失败仍纯文本", () => {
    it("三种文案不带 markdown 语义（星号原样保留）", () => {
        for (const kind of ["loading", "empty", "fail"] as const) {
            const html = renderAiTextHtml(kind, "**正在分析**");
            expect(html).toBe("**正在分析**");
        }
    });

    it("错误原文里的尖括号被转义（errText 可能含宿主原文）", () => {
        expect(renderAiTextHtml("fail", "AI 分析失败：<fetch failed>")).toBe("AI 分析失败：&lt;fetch failed&gt;");
    });

    it("多行纯文本换行转 <br>（容器不再 pre-wrap）", () => {
        expect(renderAiTextHtml("fail", "第一行\n第二行")).toBe("第一行<br>第二行");
    });
});

describe("接线（源级断言：改 innerHTML 不许改名、出错不许裸 textContent）", () => {
    /** `?raw` 取本模块源码（本仓无 @types/node，不用 node:fs）。 */
    const SRC =
        (
            import.meta.glob("./agentPanel.ts", { query: "?raw", import: "default", eager: true }) as Record<
                string,
                string
            >
        )["./agentPanel.ts"] ?? "";
    /** 剥注释：源码注释里成段复述了旧写法，不剥会误伤。 */
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    it("输出区三处写入都过 renderAiTextHtml（无裸 textContent 写入）", () => {
        expect(code).toContain('out.innerHTML = renderAiTextHtml("loading", opts.loadingText)');
        expect(code).toContain('renderAiTextHtml("body", body)');
        expect(code).toContain('renderAiTextHtml("fail", `${opts.failPrefix}${errText(e)}`)');
        expect(code).not.toMatch(/out\.textContent\s*=/);
    });

    it("AI 正文与加载/失败文案分流（renderAiTextHtml 的 kind 只有 body 走 markdown）", () => {
        const fn = code.slice(code.indexOf("export function renderAiTextHtml"));
        expect(fn.slice(0, fn.indexOf("}"))).toContain('kind === "body" ? renderMdHtml(text) : esc(text)');
    });
});
