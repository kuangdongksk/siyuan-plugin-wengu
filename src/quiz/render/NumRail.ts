/**
 * 题号导航（从 QuizView 拆出）：点击平滑滚到对应卡片；滚动时联动
 * 高亮当前题。当前题下标通过 onActive 回调上报——逐题计时的计时
 * 对象跟随它，即使题号栏被设置关闭也保持滚动跟踪。
 *
 * 长卷性能（20260828）：可见题卡列表缓存 + MutationObserver 失效
 * （hidden 翻转/子树重建才重扫，滚动帧内不再全树 querySelectorAll，
 * ~200 题卷每帧省一次 8000+ 节点扫描）；active 差分更新只动前后
 * 两个按钮，同题号重复上报直接跳过。
 */
export function bindNumRail(
    root: HTMLElement,
    opts: { onActive: (idx: number) => void; onFocus?: (idx: number) => void }
): void {
    const nav = root.querySelector<HTMLElement>("[data-nums]");
    // 点击导航后的平滑滚动期间暂停滚动跟踪回写：末尾卡片到不了视口
    // 顶部，「顶端最近」规则会把点击的题号翻回前面的题（真机踩坑）。
    let lockUntil = 0;
    let lastN = -1;
    let activeBtn: HTMLElement | null = null;
    const setActive = (n: number) => {
        if (n === lastN) return;
        lastN = n;
        opts.onActive(n - 1);
        if (!nav) return;
        const next = nav.querySelector<HTMLElement>(`.wengu-num[data-num="${n}"]`);
        if (next === activeBtn) return;
        activeBtn?.classList.remove("wengu-num-active");
        next?.classList.add("wengu-num-active");
        activeBtn = next;
    };
    if (nav) {
        for (const btn of nav.querySelectorAll<HTMLElement>(".wengu-num")) {
            btn.addEventListener("click", () => {
                const n = Number(btn.dataset.num);
                lockUntil = performance.now() + 800;
                if (opts.onFocus) {
                    // 材料组一次一题：点击组内题号由视图切题并滚到组单元
                    opts.onFocus(n - 1);
                } else {
                    root.querySelector<HTMLElement>(`.wengu-card[data-idx="${n - 1}"]:not([hidden])`)?.scrollIntoView({
                        behavior: "smooth",
                        block: "center",
                    });
                }
                setActive(n);
            });
        }
    }
    const scroller = root.querySelector<HTMLElement>(".wengu-main");
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
        const max = `${Math.max(160, scroller.clientHeight - headH - 8)}px`;
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
                let best = 0;
                let bestDist = Infinity;
                for (const c of cards) {
                    const d = Math.abs(c.getBoundingClientRect().top - top);
                    if (d < bestDist) {
                        bestDist = d;
                        best = Number(c.dataset.idx ?? 0);
                    }
                }
                setActive(best + 1);
            });
        },
        { passive: true }
    );
    setActive(1);
}
