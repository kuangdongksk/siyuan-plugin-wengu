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
                root.querySelector<HTMLElement>(`.wengu-card[data-idx="${n - 1}"]`)
                    ?.scrollIntoView({behavior: "smooth", block: "start"});
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
