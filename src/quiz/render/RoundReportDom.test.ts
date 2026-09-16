import { describe, expect, it } from "vitest";
import { enterSummaryView, exitSummaryView, isSummaryView, reportScrolled, scrollReportTop } from "./RoundReport";

/**
 * 收卷总结视图的 **DOM 行为**（Issue #147 追加 1/2/3）。
 *
 * 本仓 vitest 是 node 环境、无 jsdom（vitest.config），但追加 2 的可见反馈
 * 全靠 `scrollTop` / `scrollTo` 这条**真 DOM 行为**判分派（「报告是否已滚离
 * 顶部」）。纯源码断言拦不住「判据写反」「scrollTo 目标选错」这类错，故这里
 * 用**极简 DOM 桩**（只实现被调到的 API，白名单见下）做真行为断言：
 *
 *   - 桩实现：`classList` / `querySelector`（单段类选择器与 `[attr]` /
 *     后代链）/ `scrollTop` / `scrollTo` / `addEventListener`；
 *   - 桩**不实现**的（`innerHTML` / 挂载 / CSS 布局）仍由
 *     `RoundReport.view.test.ts` 的源级与编译产物断言覆盖——本文件只补
 *     「判据与分支方向」这一层。
 */

const ATTRS = Symbol("attrs");
type Attrs = Set<string>;

class FakeClassList {
    private s = new Set<string>();
    add(c: string): void {
        this.s.add(c);
    }
    remove(c: string): void {
        this.s.delete(c);
    }
    contains(c: string): boolean {
        return this.s.has(c);
    }
}

class FakeEl {
    classList = new FakeClassList();
    children: FakeEl[] = [];
    parent?: FakeEl;
    scrollTop = 0;
    scrolls: number[] = [];
    [ATTRS]: Attrs = new Set();
    private listeners = new Map<string, Array<() => void>>();

    attr(name: string): this {
        this[ATTRS].add(name);
        return this;
    }
    setAttribute(name: string): void {
        this[ATTRS].add(name);
    }
    removeAttribute(name: string): void {
        this[ATTRS].delete(name);
    }
    hasAttribute(name: string): boolean {
        return this[ATTRS].has(name);
    }
    add(...kids: FakeEl[]): this {
        for (const k of kids) {
            k.parent = this;
            this.children.push(k);
        }
        return this;
    }
    scrollTo(o: { top: number }): void {
        this.scrolls.push(o.top);
        this.scrollTop = o.top;
    }
    addEventListener(kind: string, fn: () => void): void {
        this.listeners.set(kind, [...(this.listeners.get(kind) ?? []), fn]);
    }
    fire(kind: string): void {
        for (const fn of this.listeners.get(kind) ?? []) fn();
    }
    private flat(out: FakeEl[] = []): FakeEl[] {
        for (const c of this.children) {
            out.push(c);
            c.flat(out);
        }
        return out;
    }
    querySelector<T>(sel: string): T | null {
        for (const node of this.flat()) if (matches(node, sel)) return node as unknown as T;
        return null;
    }
}

/** 后代链匹配（单段：`.cls` / `[attr]` / 标签名；空格分隔的后代链）。 */
function segMatch(el: FakeEl, seg: string): boolean {
    if (seg.startsWith(".")) return el.classList.contains(seg.slice(1));
    const attr = /^\[([a-z-]+)\]$/.exec(seg);
    if (attr) return el[ATTRS].has(attr[1]);
    return false;
}
function matches(node: FakeEl, sel: string): boolean {
    const parts = sel.trim().split(/\s+/);
    if (!segMatch(node, parts[parts.length - 1])) return false;
    let chain = parts.slice(0, -1);
    let cur: FakeEl | undefined = node.parent;
    while (cur && chain.length > 0) {
        if (segMatch(cur, chain[chain.length - 1])) chain = chain.slice(0, -1);
        cur = cur.parent;
    }
    return chain.length === 0;
}

/** 还原真壳形态：el > main.wengu-main > ([data-report] > scroll > report, .wengu-body)。 */
function shell(): { root: FakeEl; main: FakeEl; scroll: FakeEl; report: FakeEl } {
    const report = new FakeEl();
    report.classList.add("wengu-report");
    const scroll = new FakeEl().attr("data-report-scroll").add(report);
    // host 初值即 hidden（CardHtml 的 `<div data-report hidden>`）
    const host = new FakeEl().attr("data-report").attr("hidden").add(scroll);
    const body = new FakeEl();
    body.classList.add("wengu-body");
    const main = new FakeEl();
    main.classList.add("wengu-main");
    main.add(host, body);
    const root = new FakeEl().add(main);
    return { root, main, scroll, report };
}

const asRoot = (el: FakeEl): HTMLElement => el as unknown as HTMLElement;

describe("收卷总结视图（Issue #147 追加 1）", () => {
    it("进总结态＝主区带类；退出＝摘类（DOM 逐字节回原状）", () => {
        const { root, main } = shell();
        expect(isSummaryView(asRoot(root))).toBe(false);
        enterSummaryView(asRoot(root));
        expect(isSummaryView(asRoot(root))).toBe(true);
        expect(main.classList.contains("wengu-summary-view")).toBe(true);
        exitSummaryView(asRoot(root));
        expect(isSummaryView(asRoot(root))).toBe(false);
    });

    it("总结态与报告宿主显隐**成对**：进态摘 hidden、退态设回 hidden", () => {
        // 只摘类不设 hidden ⇒「返回题卷」后报告卡仍压在卷首（没真收起）；
        // 只设 hidden 不摘类 ⇒ CSS 特异性压过 [hidden]，报告照显
        const { root, report } = shell();
        const host = report.parent?.parent as FakeEl; // scroll.report -> host
        expect(host.hasAttribute("hidden")).toBe(true);
        enterSummaryView(asRoot(root));
        expect(host.hasAttribute("hidden")).toBe(false);
        exitSummaryView(asRoot(root));
        expect(host.hasAttribute("hidden")).toBe(true);
    });

    it("类挂在 **.wengu-main** 上（不是报告块）——CSS 选择器前缀同源", () => {
        const { root, main, report } = shell();
        enterSummaryView(asRoot(root));
        expect(main.classList.contains("wengu-summary-view")).toBe(true);
        expect(report.classList.contains("wengu-summary-view")).toBe(false);
    });

    it("无主区时不抛（渲染兜底壳/错误态下点不到报告）", () => {
        const bare = new FakeEl();
        expect(() => enterSummaryView(asRoot(bare))).not.toThrow();
        expect(() => exitSummaryView(asRoot(bare))).not.toThrow();
        expect(isSummaryView(asRoot(bare))).toBe(false);
    });
});

describe("报告已滚离顶部的判据（Issue #147 追加 2）", () => {
    it("scrollTop=0 ⇒ 贴顶；>0 ⇒ 已滚离", () => {
        const { root, scroll } = shell();
        expect(reportScrolled(asRoot(root))).toBe(false);
        scroll.scrollTop = 420;
        expect(reportScrolled(asRoot(root))).toBe(true);
    });

    it("微小抖动的容差：>4px 才算「已滚离」（免得每次点都闪）", () => {
        const { root, scroll } = shell();
        scroll.scrollTop = 4;
        expect(reportScrolled(asRoot(root))).toBe(false);
        scroll.scrollTop = 5;
        expect(reportScrolled(asRoot(root))).toBe(true);
    });

    it("无报告（未出总结）⇒ 不算已滚离，不误发光效", () => {
        const bare = new FakeEl();
        expect(reportScrolled(asRoot(bare))).toBe(false);
        expect(() => scrollReportTop(asRoot(bare))).not.toThrow();
    });
});

describe("滑回总结顶部 + 高亮脉冲（Issue #147 追加 2）", () => {
    it("滚动窗归零并叠脉冲类；animationend 自摘（连点幂等）", () => {
        const { root, scroll, report } = shell();
        scroll.scrollTop = 300;
        scrollReportTop(asRoot(root));
        expect(scroll.scrolls).toEqual([0]);
        expect(report.classList.contains("wengu-report-pulse")).toBe(true);
        report.fire("animationend");
        expect(report.classList.contains("wengu-report-pulse")).toBe(false);
    });

    it("滚动目标选的是**报告滚动窗**，不是主区（主区在总结态已不滚）", () => {
        const { root, scroll } = shell();
        scrollReportTop(asRoot(root));
        // 打到滚动窗（[data-report-scroll]）上，而非 .wengu-main
        expect(scroll.scrolls.length).toBe(1);
    });

    it("旧形态（桩 + 组件窗并存）下回顶确实失效——这是那条源码闸的行为侧证据", () => {
        // 复原病灶形态：宿主里先放一个空的 [data-report-scroll] 桩，组件那
        // 个真窗排在它后面（Svelte 无 anchor 挂载 append 到 host 末尾）。
        // 两个 `.wengu-report-scroll` 都吃总结态的 `flex:1` ⇒ 面板被劈成
        // 「一半空白 + 一半报告」；更要命的是 querySelector 命中的是**排在前
        // 面的空桩**：翻真窗的 scrollTop 判不出「已滚离顶部」、scrollTo 也
        // 打不到真窗 ⇒「重开总结滚回顶部」静默失效。
        const real = new FakeEl();
        real.classList.add("wengu-report");
        const realScroll = new FakeEl().attr("data-report-scroll").add(real);
        const stub = new FakeEl().attr("data-report-scroll"); // 空桩，排在前
        const host = new FakeEl().attr("data-report").add(stub, realScroll);
        const main = new FakeEl();
        main.classList.add("wengu-main");
        main.add(host);
        const root = new FakeEl().add(main);

        realScroll.scrollTop = 300; // 真窗明明已滚离顶部
        expect(reportScrolled(asRoot(root))).toBe(false); // 却判成「贴顶」
        scrollReportTop(asRoot(root));
        expect(realScroll.scrolls).toEqual([]); // 回顶也没打到真窗
        // 故修法是**别造那个桩**（标记唯一来源＝组件），由源码闸兜住
    });
});
