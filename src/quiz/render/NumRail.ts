/**
 * 题号导航（从 QuizView 拆出）：点击平滑滚到对应卡片；滚动时联动
 * 高亮当前题。当前题下标通过 onActive 回调上报——逐题计时的计时
 * 对象跟随它，即使题号栏被设置关闭也保持滚动跟踪。
 *
 * Svelte 化（20260830）：渲染与标色状态在 component/NumRailApp.svelte
 * （三写收敛：初始态/判分描色/已答态原散在 renderNumsHtml、
 * FlowDom.markNum、AnswerFlow.markNumAnswered 三处直改 DOM，现统一为
 * 组件 marks 响应态），本文件保留全部实测调优的行为代码——滚动跟踪/
 * 追赶滚动/吸顶封顶实测不动。
 *
 * 长卷性能（20260828）：可见题卡列表缓存 + MutationObserver 失效
 * （hidden 翻转/子树重建才重扫，滚动帧内不再全树 querySelectorAll，
 * ~200 题卷每帧省一次 8000+ 节点扫描）；active 差分上报只过前后
 * 两个题号，同题号重复上报直接跳过。
 */
/* ── 追赶式滚动（题号导航专用）──
 * scrollIntoView(smooth) 的目标像素在调用瞬间定死，而长卷滚动路径上
 * 布局还在变：内嵌 Protyle 逐卡串行挂载、content-visibility 屏外卡
 * 260px 占位到近视口才真实化，上方卡片持续撑高——动画停在过时像素，
 * 30 题卷第一题点末题落到中途（20260830 真机）。改 rAF 逐帧按目标卡
 * 当前几何位置重算目标 scrollTop 逼近，撑高多少追多少；用户滚轮/
 * 拖动（wheel/pointerdown）即刻让路，目标卡被整壳重建摘除即止。 */

import type { WenguQuestion } from "../../types";
import { numState } from "./CardHtml";
import { mountSvelteApp, type MountedSvelteApp } from "../../ui/mountApp";
import NumRailApp from "../component/NumRailApp.svelte";

interface Chase {
    stop: () => void;
}

const chases = new WeakMap<HTMLElement, Chase>();

/** 滚动跟踪回写的闸：追赶进行中题号栏不按「顶端最近」规则翻高亮。 */
export function isChasingActive(scroller: HTMLElement): boolean {
    return chases.has(scroller);
}

/** 追赶滚动到目标元素。block 语义对齐 scrollIntoView：start=顶对齐
 *  （+scroll-margin-top，实测不猜值），center=居中。 */
export function chaseScrollIntoView(scroller: HTMLElement, card: HTMLElement, block: "start" | "center"): void {
    chases.get(scroller)?.stop();
    const ac = new AbortController();
    const state: Chase = {
        stop: (): void => {
            ac.abort();
            if (chases.get(scroller) === state) chases.delete(scroller);
        },
    };
    chases.set(scroller, state);
    for (const type of ["wheel", "pointerdown"] as const) {
        scroller.addEventListener(type, () => state.stop(), { signal: ac.signal, passive: true });
    }
    const marginTop = parseFloat(getComputedStyle(card).scrollMarginTop) || 0;
    let stable = 0;
    const deadline = performance.now() + 10000; // 兜底防 rAF 死循环（挂载撑高一般 1~2s 收敛）
    const step = (): void => {
        if (ac.signal.aborted || !card.isConnected) {
            state.stop();
            return;
        }
        const sTop = scroller.getBoundingClientRect().top;
        const c = card.getBoundingClientRect();
        const slack = block === "start" ? marginTop : (scroller.clientHeight - c.height) / 2;
        const goal = scroller.scrollTop + (c.top - sTop) - slack;
        const cur = scroller.scrollTop;
        if (Math.abs(goal - cur) < 1) {
            // 连续 ~130ms 目标稳定才算落位：挂载尾程的撑高随时再追
            if (++stable >= 8) {
                state.stop();
                return;
            }
        } else {
            stable = 0;
            scroller.scrollTop = cur + (goal - cur) * 0.2;
        }
        if (performance.now() > deadline) state.stop();
        requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

/* ── 题号栏组件实例（*.svelte 环境声明不带实例导出类型，这里收口） ── */

interface NumRailExports {
    setActive(n: number): void;
    markAnswered(n: number): void;
    markResult(n: number, ok: boolean): void;
}

let numsApp: MountedSvelteApp<NumRailExports> | undefined;

/** 卸载题号栏（renderQuizShellFor 整壳重建前与 QuizView.destroy 兜底）。 */
export function detachNumRail(): void {
    numsApp?.unmount();
    numsApp = undefined;
}

/** 判分后题号描色（FlowDom.markNum 收口至此；未挂栏=无操作）。 */
export function markNumRailResult(n: number, ok: boolean): void {
    numsApp?.app.markResult(n, ok);
}

/** after 模式已答标记（AnswerFlow.markNumAnswered 收口至此）。 */
export function markNumRailAnswered(n: number): void {
    numsApp?.app.markAnswered(n);
}

export function bindNumRail(
    root: HTMLElement,
    list: WenguQuestion[],
    opts: {
        onActive: (idx: number) => void;
        onFocus?: (idx: number) => void;
        numsTitle: string;
        showNums: boolean;
        showPast: boolean;
    }
): void {
    // 题号栏组件挂载：壳在 .wengu-body 里放 [data-nums-anchor] 锚
    // （renderNumsHtml 退役），anchor 法插入保住 sticky 直接子元素
    // 布局；设置关闭/无题时壳不放锚=不挂栏（旧 renderNumsHtml 同款）
    if (opts.showNums && list.length > 0) {
        detachNumRail();
        const anchor = root.querySelector("[data-nums-anchor]");
        const body = root.querySelector<HTMLElement>(".wengu-body");
        if (anchor && body) {
            numsApp = mountSvelteApp(
                NumRailApp,
                body,
                { initialStates: list.map((q) => numState(q, opts.showPast).trim()), title: opts.numsTitle },
                { anchor }
            ) as MountedSvelteApp<NumRailExports>;
            anchor.remove();
        }
    }
    const nav = root.querySelector<HTMLElement>("[data-nums]");
    // 点击导航后的平滑滚动期间暂停滚动跟踪回写：末尾卡片到不了视口
    // 顶部，「顶端最近」规则会把点击的题号翻回前面的题（真机踩坑）。
    let lockUntil = 0;
    let lastN = -1;
    const setActive = (n: number) => {
        if (n === lastN) return;
        lastN = n;
        opts.onActive(n - 1);
        numsApp?.app.setActive(n); // 高亮进组件响应态（旧 activeBtn 差分退役）
    };
    const scroller = root.querySelector<HTMLElement>(".wengu-main");
    if (nav) {
        for (const btn of nav.querySelectorAll<HTMLElement>(".wengu-num")) {
            btn.addEventListener("click", () => {
                const n = Number(btn.dataset.num);
                lockUntil = performance.now() + 800;
                if (opts.onFocus) {
                    // 材料组一次一题：点击组内题号由视图切题并滚到组单元
                    opts.onFocus(n - 1);
                } else if (scroller) {
                    const card = root.querySelector<HTMLElement>(`.wengu-card[data-idx="${n - 1}"]:not([hidden])`);
                    if (card) chaseScrollIntoView(scroller, card, "center");
                }
                setActive(n);
            });
        }
    }
    if (!scroller) return;
    // 头部吸顶后题号栏让位到头下：实测头部实际高度（窄窗折行会更高），
    // 每次渲染后刷新到滚动容器上；题号栏封顶 = 滚动可视区 − 头下缘，
    // 同样实测写入（--wengu-nums-max）——固定 100vh-N 的页签 chrome
    // 余量在两台机器/主题间差几像素，猜值两轮真机反馈都不准
    // （20260829「题号没占满」→「又装不下，只差几像素」）
    const head = root.querySelector<HTMLElement>(".wengu-head");
    const applyHeights = (): void => {
        if (!head) return;
        const headH = head.offsetHeight + 8;
        scroller.style.setProperty("--wengu-head-h", `${headH}px`);
        // 底部留白=滚动容器 padding-bottom + 题号栏自身 margin-bottom
        // （都从布局实读，不猜数字）；栏内衬/列间距见 cards.scss——
        // 间距全部由布局表达，JS 只测量不决定
        const padB = parseFloat(getComputedStyle(scroller).paddingBottom) || 8;
        const railM = nav ? parseFloat(getComputedStyle(nav).marginBottom) || 0 : 0;
        const max = `${Math.max(160, scroller.clientHeight - headH - padB - railM)}px`;
        if (scroller.style.getPropertyValue("--wengu-nums-max") !== max) {
            scroller.style.setProperty("--wengu-nums-max", max);
        }
    };
    applyHeights();
    // 可见题卡缓存：静态渲染分片填 innerHTML、材料组切 hidden 都会
    // 改子树——观察到了才重扫，滚动帧内用缓存
    const visibleCards = () => Array.from(root.querySelectorAll<HTMLElement>(".wengu-card:not([hidden])"));
    let cards = visibleCards();
    let dirty = false;
    const body = root.querySelector<HTMLElement>(".wengu-body");
    if (body) {
        new MutationObserver(() => {
            dirty = true;
        }).observe(body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
    }
    let pending = false;
    scroller.addEventListener(
        "scroll",
        () => {
            if (pending) return;
            pending = true;
            window.requestAnimationFrame(() => {
                pending = false;
                applyHeights(); // 窗口缩放后随滚动自愈（值没变时零开销）
                if (isChasingActive(scroller)) return; // 追赶滚动期间不回写（见文件头）
                if (performance.now() < lockUntil) {
                    // 平滑滚动仍在进行就续锁：长列表滚到末尾常超 800ms，
                    // 固定锁过期后「顶端最近」规则会把点击的末题翻回前题
                    lockUntil = performance.now() + 200;
                    return;
                }
                if (dirty) {
                    cards = visibleCards();
                    dirty = false;
                }
                if (cards.length === 0) return;
                const top = scroller.getBoundingClientRect().top + 24;
                // 当前题 = 顶端参考线落在其卡身内的最后一张可见卡（包含
                // 规则）。原「取距参考线最近的卡顶」在高题卡（数学卡
                // 300px+）中段作答时会被下一题反超——题号高亮与逐题计时
                // 跟着错位（「可见序数错位」挂账，20260829）。
                let best = -1;
                for (const c of cards) {
                    if (c.getBoundingClientRect().top <= top) best = Math.max(best, Number(c.dataset.idx ?? 0));
                }
                if (best < 0) best = Number(cards[0].dataset.idx ?? 0);
                setActive(best + 1);
            });
        },
        { passive: true }
    );
    setActive(1);
}
