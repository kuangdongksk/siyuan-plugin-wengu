import { Protyle, ProtyleMethod } from "siyuan";
import type { App } from "siyuan";
import type { WenguMaterial, WenguQuestion } from "./types";
import { optionDisplayMd } from "./types";
import { esc } from "./ui";

/**
 * 题目内容的内嵌只读 Protyle 宿主（从 QuizView 拆出）。
 *
 * 逐卡串行挂载：并发多个 getDoc 会触发内核请求互相挂起（真机踩坑，
 * 12 张卡全部超时降级）；失败/超时（8s）退回 Lute HTML——降级路径
 * 必须显式 SetInlineMath(true)（编辑器默认关行级公式，不开则
 * `$...$` 原样输出），再 ProtyleMethod.mathRender 渲染 KaTeX。
 * 材料面板（E0）同样走这里：data-mprotyle 挂材料块，降级用 bodyMd。
 */
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
        return q ? this.fallbackHtml(q) : undefined;
    }

    /** 占位所属块 id：材料面板（材料组单元）取 data-mid，题卡取 data-qid。 */
    private nodeBlockId(node: HTMLElement): string {
        const holder = node.closest<HTMLElement>(".wengu-material, .wengu-gunit, .wengu-card");
        return holder?.dataset.mid || holder?.dataset.qid || "";
    }

    /** 题库（专题）模式的静态挂载：Lute 渲染题干/选项 + 解析容器
     *  （作答前由 CSS 随 wengu-graded 显隐，防剧透与文档模式同机制），
     *  块引用静态渲染为可点击跳转。材料面板按来源文档并集静态渲染。
     *  不碰内核，无串行约束。 */
    mountStatic(root: HTMLElement, list: WenguQuestion[], materials: WenguMaterial[] = []): void {
        for (const node of Array.from(root.querySelectorAll<HTMLElement>("[data-qprotyle]"))) {
            const card = node.closest<HTMLElement>(".wengu-card");
            const q = list.find((x) => x.id === card?.dataset.qid);
            if (!q) continue;
            const sol = [q.answer, q.solutionMd].filter(Boolean).join("\n\n");
            node.innerHTML =
                this.fallbackHtml(q) +
                (sol ? `<div class="wengu-static-sol" data-static-sol>${mdFragmentHtml(sol)}</div>` : "");
            renderMath(node);
        }
        for (const node of Array.from(root.querySelectorAll<HTMLElement>("[data-mprotyle]"))) {
            const mat = materials.find((x) => x.id === this.nodeBlockId(node));
            if (!mat?.bodyMd) continue;
            node.innerHTML = safeLute(mat.bodyMd);
            renderMath(node);
        }
    }

    private async mountOne(node: HTMLElement, blockId: string, fallback: string, gen: number): Promise<void> {
        try {
            const protyle = new Protyle(this.app!, node, {
                blockId,
                mode: "wysiwyg",
                render: { title: false, gutter: false, scroll: false, breadcrumb: false },
            });
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

    /** 降级渲染（题干+选项；选项去列表标记与字母标签）。 */
    private fallbackHtml(q: WenguQuestion): string {
        const parts: string[] = [];
        if (q.stemMd) parts.push(safeLute(q.stemMd));
        for (const md of q.optionMd ?? []) {
            parts.push(`<div class="wengu-option-fallback">${safeLute(optionDisplayMd(md))}</div>`);
        }
        return parts.join("");
    }

    /** 重渲染前调用：销毁全部 Protyle，代数自增。 */
    destroyAll(): void {
        this.mountGen++;
        for (const p of this.protyles.values()) {
            try {
                p.destroy();
            } catch (_) {
                // 忽略
            }
        }
        this.protyles.clear();
    }
}

/** 等 Protyle 把块 DOM 渲染进容器（出现 [data-node-id]），超时 false。 */
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

/** 把 kramdown 交给思源 Lute 渲染为块 DOM HTML。
 *  Lute 是 window 全局（app 逐窗口加载 lute.min.js），插件 API 模块
 *  「siyuan」并不导出它——import { Lute } from "siyuan" 拿到 undefined，
 *  New() 抛异常被 safeLute 吞掉后整体退成 <pre> 纯文本，公式显示为
 *  裸 $...$（20260825 真机踩坑，3.8.1 加载器实测确认）。 */
function luteToHtml(md: string): string {
    const lute = window.Lute.New();
    lute.SetKramdownIAL(true);
    // 行级/块级公式必须显式开启（编辑器配置默认关，不开 $...$ 原样输出）
    lute.SetInlineMath(true);
    (lute as unknown as { SetMathBlock?: (b: boolean) => void }).SetMathBlock?.(true);
    lute.SetInlineMathAllowDigitAfterOpenMarker(true);
    return lute.Md2BlockDOM(md);
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
