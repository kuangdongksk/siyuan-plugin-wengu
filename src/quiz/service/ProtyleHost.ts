import { ProtyleMethod } from "siyuan";
import type { WenguMaterial, WenguQuestion } from "../../types";
import { optionDisplayMd, normalizeOptionLabels, estimateOptWidth, LETTERS } from "../../types";
import { renderMdHtml } from "../../ui/MdRender";
import { decorateMaterialEntry } from "./MaterialDecorate";
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
     *  随 wengu-revealed 显隐，防剧透），块引用渲染为「查看原文」链接
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
                // Issue #53 三期：材料装饰走**唯一出口**（数据层入口）——
                // 基础渲染 → 权威节点表 → 词形联动 → 轮间重算映射 →
                // 线索 mark 坐标施工五步全在出口内（挂载顺序是实现保证，
                // 不再是「词表 → 线索」的调用侧约定）。线索锚点由调用侧
                // （视图/组单元）在挂载后过统一后处理施工，这里不带线索
                // （保持本通道只读材料正文）。
                decorateMaterialEntry(node, { md: mat.bodyMd });
            } else {
                const card = node.closest<HTMLElement>(".wengu-card");
                const q = list.find((x) => x.id === card?.dataset.qid);
                if (!q) continue;
                node.innerHTML = fallbackQuestionHtml(q) + solutionHtml(q);
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
    // Issue #176 双字母剥净（渲染侧**兜底**）。实查口径（20260918 复核，
    // 记准免得后人误判主因）：
    //   - **真机样本 `- A. A. 时空…` 早在 #163（20260916）就剥干净了**
    //     ——`optionDisplayMd` 内部已连续剥层、封顶 3，故这一层对它是**空
    //     操作**（复核实测：≤3 层标签下与不叠完全等价）。
    //   - 叠它的唯一实际作用面是 **≥4 层标签的畸形存量**（真机天花板形态），
    //     那里 plain 会剩一层标签。
    //   - **主修在落库**：`QuestionDraft.renderUnit` 的选项拼接处
    //     （库里本就不该存双字母——实查确有，故那里才是根因落点）。
    //   与 #163 的「`A. B. 两本书名` 别过度剥」边界**不冲突**：该形态在两
    //   种写法下都收成「两本书名」，剥层数差异只出现在 4 层以上的畸形。
    const { body, tier } = optionInline(optionDisplayMd(normalizeOptionLabels(md)));
    const cls = tier ? `${rowClass} ${tier}` : rowClass;
    return `<div class="${cls}"><span class="wengu-opt-letter">${LETTERS[i] ?? ""}</span><div class="wengu-opt-body">${body}</div></div>`;
}

/** 选项行 HTML（选项容器 `.wengu-opts` 是多列排布挂点；无选项返回空串）。
 *  Issue #52 二期起题卡题干走装饰出口，选项/解析**不是原文**（非权威区），
 *  由调用侧作为尾部件拼在同一容器里——故拆成独立入口供两处复用。 */
export function optionsHtml(q: WenguQuestion): string {
    const rows = (q.optionMd ?? []).map((md, i) => optionRowHtml(i, md)).join("");
    return rows ? `<div class="wengu-opts">${rows}</div>` : "";
}

/** 答案解析区 HTML（揭示前由 CSS 随 `wengu-revealed` 显隐，Issue #12；
 *  无答案/解析返回空串）。与选项同属**非权威区**，同样在装饰出口之外。 */
export function solutionHtml(q: WenguQuestion): string {
    const sol = [q.answer, q.solutionMd].filter(Boolean).join("\n\n");
    return sol ? `<div class="wengu-static-sol" data-static-sol>${renderMdHtml(sol)}</div>` : "";
}

/** 静态渲染：题干 + 选项行。选项行包进 .wengu-opts 容器（flex-wrap
 *  多列排布的挂点）。 */
export function fallbackQuestionHtml(q: WenguQuestion): string {
    const parts: string[] = [];
    if (q.stemMd) parts.push(renderMdHtml(q.stemMd));
    parts.push(optionsHtml(q));
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
    // 剥壳两条并行的顶层形态（互斥，都不中则整行独占）：单项列表壳
    // （题库里 optionMd 常有 `- A. xxx` 列表形态，Issue #105——不作两级
    // 嵌套串联：`unwrapSingleBlock` 对顶层 `ul` 返 null，串起来会把
    // 列表这一支短路掉）→ 单段落壳。列表整条不剥会把列表圆点渲进选项行，
    // 字母圆圈旁出现游离「•」+ 双重字母标。
    const unwrapped = unwrapSingleListItem(block);
    const inline = unwrapped === block ? unwrapSingleBlock(block) : unwrapped;
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

/** 剥壳（列表形态，Issue #105）：题干/选项的 markdown 常写成单项列表
 *  （`- A. xxx`），渲染成 `<ul><li><div class="p">…</div></li></ul>`——此时
 *  `unwrapSingleBlock` 对顶层 `ul` 返回 null，整条列表（含圆点）会渲进
 *  选项行。本函数在**恰一个 li、且 li 内恰一个段落**时剥出段落内联正文；
 *  多项列表（真语义清单）与 li 内多块（含嵌套列表）一律返回原串不动。
 *  传入 null（上一级已剥壳）原样透传。 */
export function unwrapSingleListItem(html: string | null): string | null {
    if (html === null) return null;
    const t = html.trim();
    if (!t.startsWith("<ul") && !t.startsWith("<ol")) return html;
    const tag = t.startsWith("<ul") ? "ul" : "ol";
    const openEnd = t.indexOf(">");
    if (openEnd < 0) return html;
    // 开/闭合标签定位：渲染输出尾部可能有换行（renderMdHtml 不 trim），
    // 不假定闭合标签贴串尾；闭合标签之前的内容才是列表正文。
    const closeAt = t.lastIndexOf(`</${tag}>`);
    if (closeAt < openEnd) return html;
    const inner = t.slice(openEnd + 1, closeAt);
    // 闭合标签之后只允许空白（防 `</ul>` 后面还拖着别的顶层块）。
    if (t.slice(closeAt + `</${tag}>`.length).trim() !== "") return html;
    // 顶层 li 扫描：exec 的 index 恒落在标签 "<" 上——开标签取其 index
    // （列表正文里 li 之前的位置）、li 正文起点 = index + 标签长度、闭标签
    // 取其 index（= li 正文终点）。恰一个 li 才剥；并列 li 与未闭合的畸形
    // 一律原样返回。
    let liDepth = 0;
    let liOpen = -1;
    let liStart = -1;
    let liEnd = -1;
    let liCount = 0;
    const liRe = /<\/?li\b[^>]*>/g;
    let m: RegExpExecArray | null;
    while ((m = liRe.exec(inner))) {
        if (m[0].startsWith("</")) {
            liDepth -= 1;
            if (liDepth === 0) {
                liCount += 1;
                liEnd = m.index;
            }
        } else if (liDepth === 0) {
            liOpen = m.index;
            liStart = m.index + m[0].length;
            liDepth += 1;
        } else {
            liDepth += 1;
        }
    }
    // 多项列表（liCount > 1）与畸形（liCount 0 / 未闭合）一律原样返回。
    if (liCount !== 1 || liStart < 0 || liEnd < 0) return html;
    // 单 li 必须吃掉整个列表正文：开标签之前与闭合标签之后都只剩空白。
    if (inner.slice(0, liOpen).trim() !== "") return html;
    const after = inner.slice(liEnd).replace(/^<\/li\b[^>]*>/, "");
    if (after.trim() !== "") return html;
    const stripped = unwrapSingleBlock(inner.slice(liStart, liEnd));
    return stripped === null ? html : stripped;
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
