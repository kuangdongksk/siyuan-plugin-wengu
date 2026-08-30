import MarkdownIt from "markdown-it";
import { stripIal } from "../bank/data/BankParse";
import { esc } from "./shared";

// State/Options 类型从实例类型反推：主 tsconfig（node10）与
// svelte-check（bundler）解析到 markdown-it 的两套声明（CJS stub /
// ESM 具名），命名空间限定与深路径 import 都只兼容一边——
// Parameters/ConstructorParameters 两边同源成立。
type InlineRuleFn = Parameters<MarkdownIt["inline"]["ruler"]["after"]>[2];
type BlockRuleFn = Parameters<MarkdownIt["block"]["ruler"]["after"]>[2];
type StateInline = Parameters<InlineRuleFn>[0];
type StateBlock = Parameters<BlockRuleFn>[0];
type MdOptions = ConstructorParameters<typeof MarkdownIt>[0];

/**
 * 自包含 markdown 渲染（20260830 起，替代前端 window.Lute/Md2BlockDOM
 * 的读方向——写方向仍由内核 Lute 落盘，不受影响）。Lute 退役动机：
 * 插件加载器不注入 Lute 必须 window 全局、SetInlineMath 忘配则公式
 * 原样输出、Md2BlockDOM 段落裹 contenteditable 壳要剥——全是真机
 * 踩过的宿主耦合（详见 AGENTS.md「内核坑」）。
 *
 * 与旧形态的三处刻意对齐（CSS/剥壳/KaTeX 链零改动）：
 * - 段落输出 `<div class="p">`（Md2BlockDOM 同款类名，视觉基线一致，
 *   unwrapSingleBlock 剥壳继续可用）；
 * - `$...$`/`$$...$$` 由 tokenizer 规则转成思源同款占位（inline-math
 *   span / NodeMathBlock div，data-content 带公式源码）——KaTeX 渲染
 *   仍走 ProtyleMethod.mathRender 惰性链，不引 katex 依赖；
 * - kramdown 残渣（IAL 属性行/块引用）在源文本级清理或转译。
 */

/** 思源同款行内公式占位（mathRender 扫 data-type=inline-math 渲染）。 */
function inlineMathHtml(content: string): string {
    return `<span data-type="inline-math" data-subtype="math" data-content="${esc(
        content
    )}" contenteditable="false" class="render-node"></span>`;
}

/** 思源同款块级公式占位（NodeMathBlock）。 */
function blockMathHtml(content: string): string {
    return `<div class="render-node" data-type="NodeMathBlock" data-content="${esc(content)}"></div>`;
}

/** 行内 `$...$` 规则：不跨行、内容非空、`$$` 让位块规则。 */
function mathInline(state: StateInline, silent: boolean): boolean {
    const start = state.pos;
    if (state.src[start] !== "$") return false;
    if (state.src[start + 1] === "$") return false;
    let pos = start + 1;
    let found = -1;
    const max = state.posMax;
    while (pos < max) {
        const ch = state.src[pos];
        if (ch === "\\") pos += 2;
        else if (ch === "$") {
            found = pos;
            break;
        } else if (ch === "\n")
            break; // 行内公式不跨行（Lute 同款）
        else pos++;
    }
    if (found < 0) return false;
    const content = state.src.slice(start + 1, found);
    if (!content.trim()) return false;
    if (!silent) state.push("wengu_math_inline", "", 0).content = content;
    state.pos = found + 1;
    return true;
}

/** 块级 `$$...$$` 规则：独立成块（单行 `$$x$$` 或跨行闭合）。 */
function mathBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean {
    let pos = state.bMarks[startLine] + state.tShift[startLine];
    let max = state.eMarks[startLine];
    if (pos + 2 > max) return false;
    if (state.src.slice(pos, pos + 2) !== "$$") return false;
    pos += 2;
    let firstLine = state.src.slice(pos, max).trim();
    if (silent) return true;
    let lastLine = "";
    let found = false;
    let nextLine = startLine;
    if (firstLine.endsWith("$$")) {
        firstLine = firstLine.slice(0, -2);
        found = true;
    }
    while (!found) {
        nextLine++;
        if (nextLine >= endLine) break;
        pos = state.bMarks[nextLine] + state.tShift[nextLine];
        max = state.eMarks[nextLine];
        const line = state.src.slice(pos, max).trim();
        if (line.endsWith("$$")) {
            lastLine = line.slice(0, -2);
            found = true;
        }
    }
    if (!found) return false; // 未闭合按普通文本走（不吞段落）
    state.line = nextLine + 1;
    const token = state.push("wengu_math_block", "", 0);
    token.content = [firstLine, lastLine].filter(Boolean).join("\n");
    token.map = [startLine, state.line];
    token.markup = "$$";
    return true;
}

/** 块引用占位符的内控标记（markdown-it html:false 下占位符按纯文本
 *  直通，渲染后再置换回安全构造的 span——esc 已在构造时做过）。 */
const WBR = "\u0001";

/** kramdown 块引用 `((20260814-abcdefgh "标题"))` → 查看原文链接。 */
const BLOCK_REF = /\(\(([0-9]{14}-[a-z0-9]+)\s+"([^"\n]*)"\)\)/g;

function preProcess(md: string): string {
    return stripIal(md).replace(BLOCK_REF, (_m, id: string, text: string): string => `${WBR}${id}:${text}${WBR}`);
}

function postProcess(html: string): string {
    return html.replace(
        new RegExp(`${WBR}([0-9]{14}-[a-z0-9]+):([\\s\\S]*?)${WBR}`, "g"),
        (_m, id: string, text: string): string =>
            `<span class="wengu-blockref" data-wengu-blockref="${id}">${text}</span>`
    );
}

let sharedMd: MarkdownIt | undefined;

function renderer(): MarkdownIt {
    if (sharedMd) return sharedMd;
    const opts: MdOptions = { html: false, breaks: false, linkify: false };
    sharedMd = new MarkdownIt(opts);
    // 段落与 Lute 形态对齐（div.p，类名承载基线样式）
    sharedMd.renderer.rules.paragraph_open = (): string => '<div class="p">';
    sharedMd.renderer.rules.paragraph_close = (): string => "</div>";
    sharedMd.renderer.rules.wengu_math_inline = (tokens, idx): string => inlineMathHtml(tokens[idx].content);
    sharedMd.renderer.rules.wengu_math_block = (tokens, idx): string => blockMathHtml(tokens[idx].content);
    sharedMd.inline.ruler.after("escape", "wengu_math_inline", mathInline);
    sharedMd.block.ruler.after("blockquote", "wengu_math_block", mathBlock, { alt: ["paragraph", "reference"] });
    return sharedMd;
}

/** markdown → 块 DOM HTML（旧 safeLute/mdFragmentHtml 的替代入口；
 *  输出可直接 innerHTML——源内裸 html 一律转义，仅自产占位安全置换）。 */
export function renderMdHtml(md: string): string {
    try {
        return postProcess(renderer().render(preProcess(md)));
    } catch (_) {
        return `<pre>${esc(md)}</pre>`; // 畸形输入兜底（对齐旧 safeLute 降级）
    }
}
