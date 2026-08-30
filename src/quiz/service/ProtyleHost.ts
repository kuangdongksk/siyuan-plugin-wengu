import { ProtyleMethod } from "siyuan";
import type { WenguMaterial, WenguQuestion } from "../../types";
import { optionDisplayMd, estimateOptWidth, LETTERS } from "../../types";
import { renderMdHtml } from "../../ui/MdRender";
import { yieldToBrowser } from "../../ui/shared";

/**
 * 题目静态渲染宿主（从 QuizView 拆出）。**内嵌只读 Protyle 轨已于
 * 20260830 退役**（题卡/材料全量走本静态管线，PROTYLE_INLINE_MAX
 * 分流删除）：每卡一个 Protyle 实例换来的是逐卡串行 getDoc、8s 装载
 * 等待与挂载竞态防护，而题卡本就 disable+锁只读——渲染保真由
 * markdown-it 产出与 Lute 对齐的形态（div.p 段落 / inline-math 占位，
 * 见 ui/MdRender.ts），KaTeX 仍走 ProtyleMethod.mathRender 惰性链。
 * 材料面板（E0）同管线：data-mprotyle 挂材料 md。
 */

/** mountStatic 分片渲染的帧预算（ms）：填满即 yield，滚动/点击在
 *  长卷成像期间保持可响应（静态管线逐单元插入同用它）。 */
export const STATIC_FRAME_BUDGET_MS = 16;

export class ProtyleHost {
    /** 挂载代数：destroy 时自增，让在途的异步分片自动放弃。 */
    private mountGen = 0;

    /** 全量静态挂载：MdRender 渲染题干/选项 + 解析容器（作答前由 CSS
     *  随 wengu-graded 显隐，防剧透），块引用渲染为「查看原文」链接
     *  （document 级委托跳转，见插件入口）。材料面板按来源文档并集
     *  静态渲染。不碰内核，无串行约束。
     *  分片异步（20260828 长卷卡顿）：~200 题整卷渲染+KaTeX 是数秒级
     *  单任务，逐卡填完一帧预算（16ms）就 yield 让 UI 呼吸，题卡按
     *  「…」占位渐次成像；整壳重渲染（mountGen 自增）放弃在途批次。 */
    async mountStatic(root: HTMLElement, list: WenguQuestion[], materials: WenguMaterial[] = []): Promise<void> {
        const gen = this.mountGen;
        let deadline = performance.now() + STATIC_FRAME_BUDGET_MS;
        const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-qprotyle], [data-mprotyle]"));
        for (const node of nodes) {
            if (gen !== this.mountGen) return; // 整壳已重建，放弃本轮
            if (performance.now() > deadline) {
                await yieldToBrowser();
                deadline = performance.now() + STATIC_FRAME_BUDGET_MS;
            }
            if (this.mountedStatic.has(node)) continue; // 已渲染过（组切换重扫）
            if (node.hasAttribute("data-mprotyle")) {
                const mat = materials.find((x) => x.id === this.nodeBlockId(node));
                if (!mat?.bodyMd) continue;
                node.innerHTML = renderMdHtml(mat.bodyMd);
            } else {
                const card = node.closest<HTMLElement>(".wengu-card");
                const q = list.find((x) => x.id === card?.dataset.qid);
                if (!q) continue;
                const sol = [q.answer, q.solutionMd].filter(Boolean).join("\n\n");
                node.innerHTML =
                    fallbackQuestionHtml(q) +
                    (sol ? `<div class="wengu-static-sol" data-static-sol>${renderMdHtml(sol)}</div>` : "");
            }
            this.mountedStatic.add(node);
            renderMathWhenVisible(node);
        }
    }

    /** 本轮已静态渲染的占位节点（重扫跳过，防覆写材料组切换态）。 */
    private readonly mountedStatic = new Set<HTMLElement>();

    /** 占位所属块 id：材料面板（材料组单元）取 data-mid，题卡取 data-qid。 */
    private nodeBlockId(node: HTMLElement): string {
        const holder = node.closest<HTMLElement>(".wengu-material, .wengu-gunit, .wengu-card");
        return holder?.dataset.mid || holder?.dataset.qid || "";
    }

    /** 重渲染前调用：代数自增放弃在途批次。root 是视图根——惰性
     *  数学观察器按根分份，只重置本视图的（两个刷题页签并存时互不
     *  干扰，模块级单例会被 A 的重建 disconnect 掉 B 的屏外锚点）。 */
    destroyAll(root?: HTMLElement): void {
        this.mountGen++;
        this.mountedStatic.clear();
        // 惰性数学观察器一并重置：在途锚点全属旧 DOM，不重置会扣住
        // 整棵旧卡片树（IO 强引用）跨渲染泄漏
        resetLazyMath(root);
    }

    /** 当前挂载代数（静态分片管线放弃在途批次用）。 */
    currentGen(): number {
        return this.mountGen;
    }
}

/** 选项行 HTML（静态渲染共用；复习详情也走它）：字母角标按位
 *  补画——选项文本经 optionDisplayMd 剥掉文档里的字母标签后，字母
 *  只能由页签自己画（types.ts 约定），否则作答 chip 无从对应。
 *  正文经 optionInline 剥壳成内联 HTML 并按估宽加紧凑档类
 *  （wengu-opt-s/m，多列排布见 card-render.scss）。 */
export function optionRowHtml(i: number, md: string, rowClass = "wengu-option-fallback"): string {
    const { body, tier } = optionInline(optionDisplayMd(md));
    const cls = tier ? `${rowClass} ${tier}` : rowClass;
    return `<div class="${cls}"><span class="wengu-opt-letter">${LETTERS[i] ?? ""}</span><div class="wengu-opt-body">${body}</div></div>`;
}

/** 静态渲染：题干 + 选项行。选项行包进 .wengu-opts 容器（flex-wrap
 *  多列排布的挂点）。 */
export function fallbackQuestionHtml(q: WenguQuestion): string {
    const parts: string[] = [];
    if (q.stemMd) parts.push(renderMdHtml(q.stemMd));
    const rows = (q.optionMd ?? []).map((md, i) => optionRowHtml(i, md)).join("");
    parts.push(rows ? `<div class="wengu-opts">${rows}</div>` : "");
    return parts.join("");
}

/** 紧凑档阈值（半角单位，docs/option-compact-layout.md 方案 C）：≤10
 *  一行 4 个（25%）、≤24 一行 2 个（50%）；估偏大安全侧。 */
const OPT_W_S = 10;
const OPT_W_M = 24;

/** 选项正文 + 紧凑档类（opt-compact，20260829）：渲染输出剥壳成纯
 *  内联 HTML（inline-math span 原样保留，KaTeX 惰性链零改动），估宽
 *  达标才给档类；剥壳失败（多块/代码块/畸形）一律 tier="" 整行独占。
 *  steps/slots 选项按钮与 match 候选池同用本函数分档。 */
export function optionInline(disp: string): { body: string; tier: string } {
    const block = renderMdHtml(disp);
    const inline = unwrapSingleBlock(block);
    if (inline === null) return { body: block, tier: "" };
    const w = estimateOptWidth(disp);
    return { body: inline, tier: w <= OPT_W_S ? "wengu-opt-s" : w <= OPT_W_M ? "wengu-opt-m" : "" };
}

/** 剥壳：渲染输出顶层恰一个段落（div.p）时取其内联正文（inline-math
 *  span 在其中，KaTeX 惰性链零改动）。字符串深度扫描不开 DOM（node
 *  测试环境无 document；只数 div 标签）；非单块/非段落（列表、代码块、
 *  标题、形态漂移）返回 null。20260830 起 MdRender 产出的段落是
 *  `<div class="p">内联正文</div>`（无 Lute 时代的 contenteditable 壳
 *  与 protyle-attr 尾巴——剥壳随之简化，兼容旧残渣形态）。 */
export function unwrapSingleBlock(html: string): string | null {
    const t = html.trim();
    if (!t.startsWith("<div") || !t.endsWith("</div>")) return null;
    const openEnd = t.indexOf(">");
    if (openEnd < 0) return null;
    if (!/class="p[" ]/.test(t.slice(0, openEnd + 1))) return null;
    // Lute 残渣形态（contenteditable 正文壳 + protyle-attr 尾巴）兼容
    const legacy = t.slice(openEnd + 1, t.length - 6).match(/^<div[^>]*>([\s\S]*)<\/div><div class="protyle-attr"/);
    if (legacy) return legacy[1];
    let depth = 0;
    const re = /<\/?div\b[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
        depth += m[0].startsWith("</") ? -1 : 1;
        // 首个顶层 div 闭合处必须正好到串尾——否则不止一个顶层块
        if (depth === 0) {
            if (m.index + m[0].length !== t.length) return null;
            return t.slice(openEnd + 1, m.index);
        }
    }
    return null;
}

/** 把一段 markdown（步骤引导语/选项）渲染为 HTML（畸形时退回纯文本）。 */
export function mdFragmentHtml(md: string): string {
    return renderMdHtml(md);
}

/** 公式/代码高亮（静态渲染路径需要）。 */
function renderMath(el: HTMLElement): void {
    if ("mathRender" in ProtyleMethod) {
        ProtyleMethod.mathRender(el);
    }
    if ("highlightRender" in ProtyleMethod) {
        ProtyleMethod.highlightRender(el);
    }
}

/** 对任意容器渲染公式/代码高亮（StepsFlow 填充步骤内容后调用）。 */
export function renderMathIn(el: HTMLElement): void {
    renderMath(el);
}

/** 惰性数学观察器：锚点（题卡/组单元）进入视口前 400px 才渲染公式。
 *  长卷整卷 KaTeX 是成像大头，与思源 Protyle 编辑器「滚到可视区才
 *  渲公式」同策略——静态路径只注入 HTML 字符串，公式按需补。
 *  观察目标取卡/组锚点而非 qprotyle 本体：content-visibility 跳过
 *  渲染的卡片内部无布局盒，IO 不触发；锚点盒子（intrinsic 尺寸）
 *  始终存在。观察器按视图根（.wengu-panel）分份：A 页签整壳重建
 *  只重置 A 的，不连坐 B 页签的屏外公式（20260829 审查）。 */
const lazyObservers = new WeakMap<HTMLElement, IntersectionObserver>();

/** KaTeX 惰性渲染入口（mountStatic 逐节点与预览装饰共用）。 */
export function renderMathWhenVisible(node: HTMLElement): void {
    if (typeof IntersectionObserver === "undefined") {
        renderMath(node); // 环境无 IO（老内核/测试）立即渲染
        return;
    }
    const anchor = node.closest<HTMLElement>(".wengu-card, .wengu-gunit") ?? node;
    const root = anchor.closest<HTMLElement>(".wengu-panel") ?? anchor;
    let obs = lazyObservers.get(root);
    if (!obs) {
        obs = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (!e.isIntersecting) continue;
                    obs!.unobserve(e.target);
                    if (e.target.isConnected) renderMath(e.target as HTMLElement);
                }
            },
            { rootMargin: "400px 0px" }
        );
        lazyObservers.set(root, obs);
    }
    obs.observe(anchor);
}

/** 整壳重建时重置惰性观察器（destroyAll 调）：在途锚点属旧 DOM，
 *  IO 强引用会扣住整棵旧卡片树跨渲染泄漏。 */
function resetLazyMath(root?: HTMLElement): void {
    if (root) {
        lazyObservers.get(root)?.disconnect();
        lazyObservers.delete(root);
    }
}
