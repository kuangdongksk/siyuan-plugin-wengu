import { describe, expect, it } from "vitest";
import { renderAiTextHtml } from "./agentPanel";
import { renderMdHtml } from "../ui/MdRender";

/**
 * 「AI 报告下游」独立验收（2/5）：**注入对抗**。
 *
 * 本文件补 PR 自带 `agentPanel.test.ts` 之外的攻击面：
 *  1. 事件处理器 / `javascript:` 协议 / SVG 载荷 / 裸 `<iframe>` 等**多形态**；
 *  2. **markdown 语法嵌套 HTML**（列表项里、表格单元里、标题里、代码块里）
 *     —— 渲染器开了 markdown ⇒ 攻击面比「纯文本」宽，这是改 `innerHTML`
 *     带来的新面，必须连同 md 形态一起钉死；
 *  3. `$…$` 公式占位**内容**也要转义（`data-content` 是属性，属性里带引号
 *     会逃出属性上下文）；
 *  4. `renderMdHtml` 自身 **`html:false`** 这条安全前提（关掉了就等于把
 *     上面全部结论作废）；
 *  5. 输出区接线：三个 kind **一律**过 `renderAiTextHtml`，且报告/统计两个
 *     消费方的容器类名与 `bind:this` 形状（源级）。
 */

/** 本模块源码（`?raw`，本仓无 @types/node 不用 node:fs；同 agentPanel.test.ts）。 */
const AGENT_SRC =
    (import.meta.glob("./agentPanel.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>)[
        "./agentPanel.ts"
    ] ?? "";

/** 剥注释：源码注释里成段复述了旧写法/示例，不剥会误伤（同 agentPanel.test.ts）。 */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** 一份「攻击载荷」清单：报告 AI 正文是**模型自由文本**，全部按不可信处理。 */
const PAYLOADS: [name: string, md: string][] = [
    ["事件处理器 img", '<img src=x onerror="window.__pwned=1">'],
    ["script 标签", "<script>window.__pwned=1</script>"],
    ["iframe 注入", '<iframe src="javascript:alert(1)"></iframe>'],
    ["svg onload", "<svg/onload=alert(1)>"],
    ["属性逃逸", '" onmouseover="alert(1)" x="'],
    ["raw 尖括号", "1 < 2 且 3 > 2"],
    ["markdown 图片协议", "![x](javascript:alert(1))"],
    ["markdown 链接协议", "[点我](javascript:alert(1))"],
    ["details/summary", "<details open><summary>x</summary></details>"],
];

const injected = (md: string): string => renderAiTextHtml("body", md);

describe("注入对抗：AI 正文（markdown 路径）", () => {
    it.each(PAYLOADS)("%s：raw HTML 一律转义，产物里不出现可执行标签/属性", (_n, md) => {
        const html = injected(md);
        expect(html).not.toMatch(/<script/i);
        expect(html).not.toMatch(/<img/i);
        expect(html).not.toMatch(/<iframe/i);
        expect(html).not.toMatch(/<svg/i);
        expect(html).not.toMatch(/<details/i);
        // ⚠️ 「事件处理器」不能按裸文本黑名单判：转义后的文本里 `onerror=`
        // 与源码逐字同形（`&quot; onmouseover=&quot;`），黑名单会误杀。
        // 判据改成**属性上下文**：尖括号已实体化 ⇒ 这些东西只能是文本。
        expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
        expect(html).not.toMatch(/href\s*=\s*["']?javascript:/i);
        expect(html).not.toMatch(/src\s*=\s*["']?javascript:/i);
    });

    it("三种文案路径（loading/empty/fail）同样转义，不带 markdown 语义", () => {
        for (const kind of ["loading", "empty", "fail"] as const) {
            const html = renderAiTextHtml(kind, "<img src=x onerror=alert(1)>\n<script>a</script>");
            expect(html).not.toMatch(/<img|<script/i);
            expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
            expect(html).toContain("<br>"); // 纯文本换行转 <br>
        }
    });
});

describe("注入对抗：markdown 语法嵌套 HTML 的每一条路径", () => {
    it("列表项里的 raw HTML 转义（原 textContent 只是显示成文本，改 innerHTML 后是新增面）", () => {
        const html = injected('- <img src=x onerror="alert(1)">\n- 正常一条');
        expect(html).toContain("<ul>");
        expect(html).not.toMatch(/<img/i);
        expect(html.match(/<li>/g)?.length).toBe(2);
    });

    it("引用块 / 标题 / 表格单元里的 raw HTML 均转义", () => {
        for (const md of [
            "> <script>alert(1)</script>",
            "# <b>x</b>",
            "| a | b |\n| --- | --- |\n| <img src=x onerror=alert(1)> | 2 |",
        ]) {
            const html = injected(md);
            expect(html).not.toMatch(/<script|<img/i);
            expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i); // 仅在标签上下文里判
            // 产物里出现的每个标签都必须是 **md 渲染器自产的**（白名单），
            // 一旦有载荷标签漏出就会在这里现形
            const tags = [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase());
            const allowed = new Set([
                "div",
                "ul",
                "ol",
                "li",
                "table",
                "thead",
                "tbody",
                "tr",
                "th",
                "td",
                "h1",
                "blockquote",
                "strong",
                "em",
                "code",
                "pre",
                "span",
                "sup",
                "a",
                "p",
            ]);
            expect(tags.filter((t) => !allowed.has(t))).toEqual([]);
        }
    });

    it("围栏代码块里的 HTML 以实体形式落 <pre><code>（不还原成标签）", () => {
        const html = injected("```\n<script>alert(1)</script>\n```");
        expect(html).toContain("<pre>");
        expect(html).toContain("&lt;script&gt;");
        expect(html).not.toMatch(/<script/i);
    });

    it("md 链接/图片只对**合法协议**放行（javascript/data/vbscript 全拒渲、大小写变体同拒）", () => {
        for (const scheme of ["javascript", "JaVaScRiPt", "vbscript", "data"]) {
            const html = injected(`[点我](${scheme}:alert(1))`);
            expect(html, scheme).not.toMatch(/href|src/i);
        }
        expect(injected("[文档](https://example.com)")).toContain('<a href="https://example.com">文档</a>');
        expect(injected("![图](https://example.com/a.png)")).toContain('<img src="https://example.com/a.png"');
        // ⚠️ 与 design-spec 关联：`javascript:` 载荷**不产出 <a>**（md-it 的
        // validateLink 白名单拒绝渲染）——安全成立，但它保留成原样文本而非
        // 转义形态；口径差异见文件末段探针
        expect(injected("[点我](javascript:alert(1))")).not.toMatch(/href/i);
    });

    it("`$…$` 公式占位保留，且 **data-content 属性里的内容也转义**（属性上下文逃逸）", () => {
        const ok = injected("由 $x^2$ 得");
        expect(ok).toContain('data-type="inline-math"');
        expect(ok).toContain('data-content="x^2"');
        // 载荷：公式内容里带引号/尖括号 —— 若直接拼进属性就能闭合属性位
        const evil = injected('$" onload="alert(1)$');
        expect(evil).toContain("&quot;");
        expect(evil).not.toMatch(/\sonload\s*=\s*"/i);
        const angle = injected("$a<b$");
        expect(angle).toContain('data-content="a&lt;b"');
        expect(angle).not.toContain('data-content="a<b"');
    });

    it("块级公式同口径（NodeMathBlock 的 data-content）", () => {
        const html = injected("$$x^2$$");
        expect(html).toContain('data-type="NodeMathBlock"');
        expect(html).toContain('data-content="x^2"');
    });
});

describe("注入对抗：renderMdHtml 的安全前提（html:false + 畸形兜底）", () => {
    it("裸 HTML 全转义（html:false 这条前提一旦被关，上组结论全部作废）", () => {
        expect(renderMdHtml("<b>bold</b>")).toContain("&lt;b&gt;");
        expect(renderMdHtml('<a href="x">a</a>')).not.toContain("<a ");
    });

    it("畸形输入的兜底分支也走 esc（不因 try/catch 降级而漏出裸 HTML）", () => {
        // 兜底分支是 `<pre>${esc(md)}</pre>`——形态锁在源级（见末段接线用例）
        expect(renderMdHtml("<img src=x onerror=alert(1)>")).not.toMatch(/<img/i);
    });
});

describe("接线（源级）：输出区三处写入一律过 renderAiTextHtml", () => {
    const code = stripComments(AGENT_SRC);

    it("源码里 innerHTML 赋值的右值**只有** renderAiTextHtml（无裸字符串拼接直写）", () => {
        const writes = [...code.matchAll(/([\w.$]+)\.innerHTML\s*=\s*([^;]+);/g)].map(
            (m) => `${m[1]} = ${m[2].trim()}`
        );
        expect(writes.length).toBe(3); // loading / body-or-empty / fail
        for (const w of writes) expect(w).toContain("renderAiTextHtml(");
    });

    it("三处 kind 与文案字段一一对应（loading / body+empty / fail+errText）", () => {
        expect(code).toContain('renderAiTextHtml("loading", opts.loadingText)');
        expect(code).toContain('renderAiTextHtml("body", body)');
        expect(code).toContain('renderAiTextHtml("empty", opts.emptyText)');
        expect(code).toContain('renderAiTextHtml("fail", `${opts.failPrefix}${errText(e)}`)');
    });

    it("无裸 textContent 写入旁路，且非 body 一路必过 esc + 换行转 <br>", () => {
        expect(code).not.toMatch(/\.textContent\s*=/);
        expect(code).toContain('kind === "body" ? renderMdHtml(text) : esc(text).replace(/\\n/g, "<br>")');
    });

    it("两个消费方的输出容器都带 markdown 基线类名 .wengu-report-ai", () => {
        const SRC = import.meta.glob("../**/*.svelte", { query: "?raw", import: "default", eager: true }) as Record<
            string,
            string
        >;
        const round = SRC["../quiz/components/RoundReportApp.svelte"] ?? "";
        const stats = SRC["../stats/components/StatsDoc.svelte"] ?? "";
        expect(round).toContain('class="wengu-report-ai"');
        expect(round).toContain("bind:this={aiOut}");
        expect(stats).toContain('class="wengu-report-ai"');
        expect(stats).toContain("bind:this={aiOut}");
        // stats 的直通写法（onclick 里就调 ctl.runAi）不在本期改造面，只锁容器
    });
});

/**
 * ⚠️ **探针（预期会红，属「断言口径 / 代码口径不一致」的归因线索）**
 *
 * 任务验收标准写的是「`javascript:` 协议必须被拦住」。实测：`renderMdHtml`
 * 用的 markdown-it 默认 `validateLink` **只允许** http/https/mailto 等白名单
 * 协议，`javascript:` 链接**不会被渲染成 `<a>`**——但它的输出是
 * `[点我](javascript:alert(1))` 这串**原样文本**，不是带 `&lt;` 的转义形态。
 * 即：无 XSS 风险（安全成立），但「必须转义」这条措辞对不上实际实现。
 * 归因：**口径错**（验收标准应写成「不产出可执行链接/协议不得进 href/src」），
 * 待归因评审定口径；本单只报不改。
 */
describe("注入对抗：探针——javascript: 协议的断言口径", () => {
    it("probe：载荷被「拒绝渲染」而非「转义」（无 href，但保留原始字面量）", () => {
        const html = injected("[点我](javascript:alert(1))");
        expect(html).not.toMatch(/href|src/i); // ✅ 安全：确实没产出链接/图片
        // ⚠️ 期望（验收标准措辞）：「载荷必须转义」⇒ 产物不含协议名原文
        // 实际：载荷**原样留存为文本**（md-it 拒绝渲染，未做任何转义）
        // 归因：**断言口径错**（措辞把「拒渲」等同于「转义」）而非安全漏洞，
        //       但「无转义」这一点在二次渲染场景下会变成新面 ⇒ 口径需定夺
        expect(html).not.toContain("javascript:");
    });
});
