import { Protyle, ProtyleMethod } from "siyuan";
import type { App } from "siyuan";
import type { WenguMaterial, WenguQuestion } from "../../types";
import { optionDisplayMd, estimateOptWidth, LETTERS } from "../../types";
import { esc, yieldToBrowser } from "../../ui/shared";

/**
 * 题目内容的内嵌只读 Protyle 宿主（从 QuizView 拆出）。
 *
 * 逐卡串行挂载：并发多个 getDoc 会触发内核请求互相挂起（真机踩坑，
 * 12 张卡全部超时降级）；失败/超时（8s）退回 Lute HTML——降级路径
 * 必须显式 SetInlineMath(true)（编辑器默认关行级公式，不开则
 * `$...$` 原样输出），再 ProtyleMethod.mathRender 渲染 KaTeX。
 * 材料面板（E0）同样走这里：data-mprotyle 挂材料块，降级用 bodyMd。
 */
/** 内嵌 Protyle 逐卡串行挂载的题量上限：超过改走静态渲染
 *  （mountStatic，题库模式同路径 Lute+KaTeX）——长卷（193 题）
 *  串行挂 N 个 Protyle 实例是真机卡死主源（每个还有 8s 等待上限）。 */
export const PROTYLE_INLINE_MAX = 50;

/** mountStatic 分片渲染的帧预算（ms）：填满即 yield，滚动/点击在
 *  长卷成像期间保持可响应（静态管线逐单元插入同用它）。 */
export const STATIC_FRAME_BUDGET_MS = 16;

export class ProtyleHost {
    private readonly protyles = new Map<string, Protyle>();
    /** 挂载代数：destroy 时自增，让在途的异步挂载自动放弃。 */
    private mountGen = 0;

    constructor(private readonly app?: App) {}
    /** 渲染完成后挂载所有卡片与材料面板；app 不可用时整体走降级。 */
    async mount(root: HTMLElement, list: WenguQuestion[], materials: WenguMaterial[] = []): Promise<void> {
        if (!this.app) {
            this.fallbackAll(root, list, materials);
            return;
        }
        const gen = this.mountGen;
        const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-qprotyle], [data-mprotyle]"));
        for (const node of nodes) {
            if (gen !== this.mountGen) return; // 重渲染已发生，放弃本轮
            const blockId = this.nodeBlockId(node);
            // 组内题一次一题：隐藏的题卡不挂载（MaterialFlow 切换显示后增量挂载）
            if (node.closest(".wengu-card[hidden]")) continue;
            // 组内题一次一题切换时增量挂载：已挂载的跳过（材料与当前题）
            if (this.protyles.has(blockId)) continue;
            const fallback = this.nodeFallback(node, list, materials);
            if (fallback === undefined) continue;
            await this.mountOne(node, blockId, fallback, gen);
        }
    }

    /** DOM 顺序里该占位对应哪个块、降级 HTML 是什么；不归属任何块返回 undefined。 */
    private nodeFallback(node: HTMLElement, list: WenguQuestion[], materials: WenguMaterial[]): string | undefined {
        if (node.hasAttribute("data-mprotyle")) {
            const mat = materials.find((x) => x.id === this.nodeBlockId(node));
            return mat?.bodyMd ? safeLute(mat.bodyMd) : "";
        }
        const q = list.find((x) => x.id === this.nodeBlockId(node));
        return q ? fallbackQuestionHtml(q) : undefined;
    }

    /** 占位所属块 id：材料面板（材料组单元）取 data-mid，题卡取 data-qid。 */
    private nodeBlockId(node: HTMLElement): string {
        const holder = node.closest<HTMLElement>(".wengu-material, .wengu-gunit, .wengu-card");
        return holder?.dataset.mid || holder?.dataset.qid || "";
    }

    /** 题库（专题）模式与长卷（>PROTYLE_INLINE_MAX）的静态挂载：Lute
     *  渲染题干/选项 + 解析容器（作答前由 CSS 随 wengu-graded 显隐，
     *  防剧透与文档模式同机制），块引用静态渲染为可点击跳转。材料
     *  面板按来源文档并集静态渲染。不碰内核，无串行约束。
     *  分片异步（20260828 长卷卡顿）：~200 题整卷 Lute+KaTeX 是数秒级
     *  单任务，逐卡填完一帧预算（16ms）就 yield 让 UI 呼吸，题卡按
     *  「…」占位渐次成像；整壳重渲染（mountGen 自增）放弃在途批次，
     *  材料组切换已挂真 Protyle 的节点跳过（防静态内容覆写挂载实例）。 */
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
            if (this.protyles.has(this.nodeBlockId(node))) continue; // 已挂真 Protyle
            if (node.hasAttribute("data-mprotyle")) {
                const mat = materials.find((x) => x.id === this.nodeBlockId(node));
                if (!mat?.bodyMd) continue;
                node.innerHTML = safeLute(mat.bodyMd);
            } else {
                const card = node.closest<HTMLElement>(".wengu-card");
                const q = list.find((x) => x.id === card?.dataset.qid);
                if (!q) continue;
                const sol = [q.answer, q.solutionMd].filter(Boolean).join("\n\n");
                node.innerHTML =
                    fallbackQuestionHtml(q) +
                    (sol ? `<div class="wengu-static-sol" data-static-sol>${mdFragmentHtml(sol)}</div>` : "");
            }
            renderMathWhenVisible(node);
        }
    }

    private async mountOne(node: HTMLElement, blockId: string, fallback: string, gen: number): Promise<void> {
        try {
            const protyle = new Protyle(this.app!, node, {
                blockId,
                mode: "wysiwyg",
                render: { title: false, gutter: false, scroll: false, breadcrumb: false },
            });
            lockWysiwyg(node); // 构造即锁：8s 装载等待期内也不可编辑
            this.protyles.set(blockId, protyle);
            const loaded = await waitForBlockNode(node, 8000);
            if (gen !== this.mountGen) {
                try {
                    protyle.destroy();
                } catch (_) {
                    // 忽略
                }
                return;
            }
            if (loaded) {
                protyle.disable();
                lockWysiwyg(node); // 再刷一遍：防装载期间属性被 protyle 内部重置
                return;
            }
            try {
                protyle.destroy();
            } catch (_) {
                // 忽略
            }
            this.protyles.delete(blockId);
            node.innerHTML = fallback;
            renderMath(node);
        } catch (_) {
            node.innerHTML = fallback;
            renderMath(node);
        }
    }

    private fallbackAll(root: HTMLElement, list: WenguQuestion[], materials: WenguMaterial[]): void {
        for (const node of root.querySelectorAll<HTMLElement>("[data-qprotyle], [data-mprotyle]")) {
            const fallback = this.nodeFallback(node, list, materials);
            if (fallback !== undefined) node.innerHTML = fallback;
        }
        renderMath(root);
    }

    /** 重渲染前调用：销毁全部 Protyle，代数自增。root 是视图根——惰性
     *  数学观察器按根分份，只重置本视图的（两个刷题页签并存时互不
     *  干扰，模块级单例会被 A 的重建 disconnect 掉 B 的屏外锚点）。 */
    destroyAll(root?: HTMLElement): void {
        this.mountGen++;
        // 惰性数学观察器一并重置：在途锚点全属旧 DOM，不重置会扣住
        // 整棵旧卡片树（IO 强引用）跨渲染泄漏
        resetLazyMath(root);
        for (const p of this.protyles.values()) {
            try {
                p.destroy();
            } catch (_) {
                // 忽略
            }
        }
        this.protyles.clear();
    }

    /** 当前挂载代数（静态分片管线放弃在途批次用）。 */
    currentGen(): number {
        return this.mountGen;
    }
}

/** 等 Protyle 把块 DOM 渲染进容器（出现 [data-node-id]），超时 false。 */
/** 3.8.1 真机（前端源码核实）：Wysiwyg 构造在桌面端无条件
 *  contenteditable="true"，protyle.disable() 只置内部标志——题卡选项块
 *  仍可被就地编辑。照搬思源自家只读面（agent chat body）的配方：
 *  contenteditable="false" + data-readonly="true" 双保险；点击作答与
 *  文本选择不受影响。 */
function lockWysiwyg(node: HTMLElement): void {
    node.querySelectorAll<HTMLElement>(".protyle-wysiwyg").forEach((el) => {
        el.setAttribute("contenteditable", "false");
        el.setAttribute("data-readonly", "true");
    });
}

function waitForBlockNode(node: HTMLElement, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
            if (node.querySelector("[data-node-id]")) {
                resolve(true);
                return;
            }
            if (Date.now() - start >= timeoutMs) {
                resolve(false);
                return;
            }
            window.setTimeout(check, 120);
        };
        check();
    });
}

/** 复用的 Lute 单例（懒建）：长卷静态渲染一次要跑上千个 kramdown
 *  片段（题干/选项/解析 × ~200 题），每次 Lute.New() 重初始化解析器
 *  是纯浪费——Md2BlockDOM 单次调用无状态，思源前端自身也是整窗
 *  复用一个实例。 */
let sharedLute: LuteLike | undefined;

/** Lute 实例的用到的最小面（window.Lute 的结构类型收窄）。 */
interface LuteLike {
    SetKramdownIAL(b: boolean): void;
    SetInlineMath(b: boolean): void;
    SetInlineMathAllowDigitAfterOpenMarker(b: boolean): void;
    Md2BlockDOM(md: string): string;
}

/** 把 kramdown 交给思源 Lute 渲染为块 DOM HTML。
 *  Lute 是 window 全局（app 逐窗口加载 lute.min.js），插件 API 模块
 *  「siyuan」并不导出它——import { Lute } from "siyuan" 得到 undefined，
 *  New() 抛异常被 safeLute 吞掉后整体退成 <pre> 纯文本，公式显示为
 *  裸 $...$（20260825 真机踩坑，3.8.1 加载器实测确认）。 */
function luteToHtml(md: string): string {
    if (!sharedLute) {
        sharedLute = window.Lute.New() as LuteLike;
        sharedLute.SetKramdownIAL(true);
        // 行级/块级公式必须显式开启（编辑器配置默认关，不开 $...$ 原样输出）
        sharedLute.SetInlineMath(true);
        (sharedLute as unknown as { SetMathBlock?: (b: boolean) => void }).SetMathBlock?.(true);
        sharedLute.SetInlineMathAllowDigitAfterOpenMarker(true);
    }
    // Md2BlockDOM 输出带 contenteditable="true"（编辑器 DOM 形态）——
    // 静态渲染是纯展示，剥掉该属性防误编辑（20260829 用户反馈「还是
    // 可以编辑」：题干/选项/解析/材料全链路都从这里走，一处收口）
    return sharedLute.Md2BlockDOM(md).replace(/ contenteditable="true"/g, "");
}

/** 选项行 HTML（静态/降级渲染共用；复习详情也走它）：字母角标按位
 *  补画——选项文本经 optionDisplayMd 剥掉文档里的字母标签后，字母
 *  只能由页签自己画（types.ts 约定），否则作答 chip 无从对应。
 *  正文经 optionInline 剥壳成内联 HTML 并按估宽加紧凑档类
 *  （wengu-opt-s/m，多列排布见 card-render.scss）。 */
export function optionRowHtml(i: number, md: string, rowClass = "wengu-option-fallback"): string {
    const { body, tier } = optionInline(optionDisplayMd(md));
    const cls = tier ? `${rowClass} ${tier}` : rowClass;
    return `<div class="${cls}"><span class="wengu-opt-letter">${LETTERS[i] ?? ""}</span><div class="wengu-opt-body">${body}</div></div>`;
}

/** 降级渲染：题干 + 选项行（静态挂载与 Protyle 失败降级共用）。
 *  选项行包进 .wengu-opts 容器（flex-wrap 多列排布的挂点）。 */
export function fallbackQuestionHtml(q: WenguQuestion): string {
    const parts: string[] = [];
    if (q.stemMd) parts.push(safeLute(q.stemMd));
    const rows = (q.optionMd ?? []).map((md, i) => optionRowHtml(i, md)).join("");
    parts.push(rows ? `<div class="wengu-opts">${rows}</div>` : "");
    return parts.join("");
}

/** 紧凑档阈值（半角单位，docs/option-compact-layout.md 方案 C）：≤10
 *  一行 4 个（25%）、≤24 一行 2 个（50%）；估偏大安全侧。 */
const OPT_W_S = 10;
const OPT_W_M = 24;

/** 选项正文 + 紧凑档类（opt-compact，20260829）：Lute 输出剥壳成纯
 *  内联 HTML（inline-math span 原样保留，KaTeX 惰性链零改动），估宽
 *  达标才给档类；剥壳失败（多块/代码块/畸形）一律 tier="" 整行独占。
 *  steps/slots 选项按钮与 match 候选池同用本函数分档。 */
export function optionInline(disp: string): { body: string; tier: string } {
    const block = safeLute(disp);
    const inline = unwrapSingleBlock(block);
    if (inline === null) return { body: block, tier: "" };
    const w = estimateOptWidth(disp);
    return { body: inline, tier: w <= OPT_W_S ? "wengu-opt-s" : w <= OPT_W_M ? "wengu-opt-m" : "" };
}

/** 剥壳：Lute 输出顶层恰一个段落 div（class="p"）时取其正文。真机
 *  段落形态（3.8.1 lute.min.js node 探针，20260829）：p 块内是
 *  `<div contenteditable="true">正文</div><div class="protyle-attr">…</div>`
 *  ——正文才是内联 HTML（inline-math span 在其中，KaTeX 惰性链零改
 *  动），contenteditable 壳与 protyle-attr 尾巴都剥掉。字符串深度扫描
 *  不开 DOM（node 测试环境无 document；只数 div 标签，段落 div 属性
 *  无用户内容、内层 span 的 data-content 即便实体化 &gt; 也不影响）；
 *  非单块/非段落（列表、代码块、pre 降级、标题、形态漂移）返回 null。 */
export function unwrapSingleBlock(html: string): string | null {
    const t = html.trim();
    if (!t.startsWith("<div") || !t.endsWith("</div>")) return null;
    const openEnd = t.indexOf(">");
    if (openEnd < 0) return null;
    if (!/class="p[" ]/.test(t.slice(0, openEnd + 1))) return null;
    let depth = 0;
    const re = /<\/?div\b[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
        depth += m[0].startsWith("</") ? -1 : 1;
        // 首个顶层 div 闭合处必须正好到串尾——否则不止一个顶层块
        if (depth === 0) {
            if (m.index + m[0].length !== t.length) return null;
            const inner = t.slice(openEnd + 1, m.index);
            // 正文壳的首 div 不认属性（luteToHtml 已剥 contenteditable，
            // 壳可能是 <div spellcheck="false">；兼容未剥形态）
            const body = inner.match(/^<div[^>]*>([\s\S]*)<\/div><div class="protyle-attr"/);
            return body ? body[1] : null;
        }
    }
    return null;
}

/** Lute 渲染降级：个别畸形 kramdown 会让 Lute 抛异常，退回纯文本。 */
function safeLute(md: string): string {
    try {
        return luteToHtml(md);
    } catch (_) {
        return `<pre>${esc(md)}</pre>`;
    }
}

/** 把一段 markdown（步骤引导语/选项）渲染为 HTML（畸形时退回纯文本）。 */
export function mdFragmentHtml(md: string): string {
    return safeLute(md);
}

/** 公式/代码高亮（降级渲染路径需要）。 */
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
 *  渲公式」同策略——静态路径只注入 Lute HTML 字符串，公式按需补。
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
