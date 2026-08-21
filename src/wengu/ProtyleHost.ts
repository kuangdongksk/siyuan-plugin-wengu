import {
    Lute,
    Protyle,
    ProtyleMethod,
} from "siyuan";
import type {App} from "siyuan";
import type {WenguQuestion} from "./types";
import {optionDisplayMd} from "./types";
import {esc} from "./ui";

/**
 * 题目内容的内嵌只读 Protyle 宿主（从 QuizView 拆出）。
 *
 * 逐卡串行挂载：并发多个 getDoc 会触发内核请求互相挂起（真机踩坑，
 * 12 张卡全部超时降级）；失败/超时（8s）退回 Lute HTML——降级路径
 * 必须显式 SetInlineMath(true)（编辑器默认关行级公式，不开则
 * `$...$` 原样输出），再 ProtyleMethod.mathRender 渲染 KaTeX。
 */
export class ProtyleHost {
    private readonly protyles = new Map<string, Protyle>();
    /** 挂载代数：destroy 时自增，让在途的异步挂载自动放弃。 */
    private mountGen = 0;

    constructor(private readonly app?: App) {}

    /** 渲染完成后挂载所有卡片；app 不可用时整体走降级。 */
    async mount(root: HTMLElement, list: WenguQuestion[]): Promise<void> {
        if (!this.app) {
            this.fallbackAll(root, list);
            return;
        }
        const gen = this.mountGen;
        for (const node of Array.from(root.querySelectorAll<HTMLElement>("[data-qprotyle]"))) {
            if (gen !== this.mountGen) return; // 重渲染已发生，放弃本轮
            const card = node.closest<HTMLElement>(".wengu-card");
            const q = list.find((x) => x.id === card?.dataset.qid);
            if (!q) continue;
            await this.mountOne(node, q, gen);
        }
    }

    private async mountOne(node: HTMLElement, q: WenguQuestion, gen: number): Promise<void> {
        try {
            const protyle = new Protyle(this.app!, node, {
                blockId: q.id,
                mode: "wysiwyg",
                render: {title: false, gutter: false, scroll: false, breadcrumb: false},
            });
            this.protyles.set(q.id, protyle);
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
            this.protyles.delete(q.id);
            node.innerHTML = this.fallbackHtml(q);
            renderMath(node);
        } catch (_) {
            node.innerHTML = this.fallbackHtml(q);
            renderMath(node);
        }
    }

    private fallbackAll(root: HTMLElement, list: WenguQuestion[]): void {
        for (const node of root.querySelectorAll<HTMLElement>("[data-qprotyle]")) {
            const card = node.closest<HTMLElement>(".wengu-card");
            const q = list.find((x) => x.id === card?.dataset.qid);
            if (q) node.innerHTML = this.fallbackHtml(q);
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

/** 把 kramdown 交给思源 Lute 渲染为块 DOM HTML。 */
function luteToHtml(md: string): string {
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    // 行级/块级公式必须显式开启（编辑器配置默认关，不开 $...$ 原样输出）
    lute.SetInlineMath(true);
    (lute as unknown as {SetMathBlock?: (b: boolean) => void;}).SetMathBlock?.(true);
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

/** 公式/代码高亮（降级渲染路径需要）。 */
function renderMath(el: HTMLElement): void {
    if ("mathRender" in ProtyleMethod) {
        ProtyleMethod.mathRender(el);
    }
    if ("highlightRender" in ProtyleMethod) {
        ProtyleMethod.highlightRender(el);
    }
}
