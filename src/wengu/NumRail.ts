/**
 * 题号导航（从 QuizView 拆出）：点击平滑滚到对应卡片；滚动时联动
 * 高亮当前题。当前题下标通过 onActive 回调上报——逐题计时的计时
 * 对象跟随它，即使题号栏被设置关闭也保持滚动跟踪。
 */
export function bindNumRail(
    root: HTMLElement,
    opts: {onActive: (idx: number) => void;},
): void {
    const nav = root.querySelector<HTMLElement>("[data-nums]");
    // 点击导航后的平滑滚动期间暂停滚动跟踪回写：末尾卡片到不了视口
    // 顶部，「顶端最近」规则会把点击的题号翻回前面的题（真机踩坑）。
    let lockUntil = 0;
    const setActive = (n: number) => {
        opts.onActive(n - 1);
        if (!nav) return;
        nav.querySelectorAll(".wengu-num").forEach((b) => {
            b.classList.toggle("wengu-num-active", Number((b as HTMLElement).dataset.num) === n);
        });
    };
    if (nav) {
        for (const btn of nav.querySelectorAll<HTMLElement>(".wengu-num")) {
            btn.addEventListener("click", () => {
                const n = Number(btn.dataset.num);
                lockUntil = performance.now() + 800;
                root.querySelector<HTMLElement>(`.wengu-card[data-idx="${n - 1}"]`)
                    ?.scrollIntoView({behavior: "smooth", block: "center"});
                setActive(n);
            });
        }
    }
    const scroller = root.querySelector<HTMLElement>(".wengu-main");
    if (!scroller) return;
    let pending = false;
    scroller.addEventListener("scroll", () => {
        if (pending) return;
        pending = true;
        window.requestAnimationFrame(() => {
            pending = false;
            if (performance.now() < lockUntil) {
                // 平滑滚动仍在进行就续锁：长列表滚到末尾常超 800ms，
                // 固定锁过期后「顶端最近」规则会把点击的末题翻回前题
                lockUntil = performance.now() + 200;
                return;
            }
            const cards = Array.from(root.querySelectorAll<HTMLElement>(".wengu-card"));
            if (cards.length === 0) return;
            const top = scroller.getBoundingClientRect().top + 24;
            let best = 0;
            let bestDist = Infinity;
            cards.forEach((c, i) => {
                const d = Math.abs(c.getBoundingClientRect().top - top);
                if (d < bestDist) {
                    bestDist = d;
                    best = i;
                }
            });
            setActive(best + 1);
        });
    }, {passive: true});
    setActive(1);
}
