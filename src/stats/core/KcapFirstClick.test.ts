import { describe, expect, it } from "vitest";
import { StatsCtl } from "./StatsCtl";
import type { StatsPanelDeps } from "../index";
import type { StatsUi } from "./StatsUi";

/**
 * 考点 chip 的**首次点击**路径（Issue #135 §7.a）。
 *
 * `searchKcapFor` 的语义是「面板没开就顺手开一个、再按考点检索」，但
 * 面板的 `attach` 挂在组件的 onMount 上（Svelte 把 onMount 排进微任务），
 * 于是那一次 `loadKcap` 必然跑在 attach 之前——此刻 `this.ui` 还是
 * undefined。没有 pending 兜底就会**静默丢掉首次点击**：浮层开了、却停在
 * 常规详情页，用户得再点一次 chip（本单修的真机缺陷）。
 */

function deps(fullList: { id: string; knowledge?: string; chapter?: string }[]): StatsPanelDeps {
    return {
        el: { appendChild: (): void => undefined } as unknown as HTMLElement,
        t: (k: string): string => k,
        docs: [],
        docId: "d1",
        fullList: fullList as unknown as StatsPanelDeps["fullList"],
        switchDoc: (): void => undefined,
        enterReview: (): void => undefined,
        aiModelId: "",
        tab: "doc",
    };
}

function uiOf(): StatsUi {
    return { tab: "doc", phase: "loading" };
}

describe("StatsCtl.loadKcap · 首点（面板未挂载）", () => {
    it("面板未挂载时记下检索词，attach 后补做（不静默丢弃）", () => {
        const ctl = new StatsCtl();
        ctl.loadKcap("线性相关");
        expect(ctl.pendingKcapNow()).toBe("线性相关");

        const ui = uiOf();
        ctl.attach(ui, deps([{ id: "q1", knowledge: "线性相关" }]));
        expect(ctl.pendingKcapNow()).toBeUndefined(); // 已消费
        expect(ui.kcap).toBe("线性相关");
        expect(ui.kcapRows?.map((r) => r.qid)).toEqual(["q1"]);
        ctl.detach();
    });

    it("挂载后正常检索；切 tab 清视图；detach 清挂起词", () => {
        const ctl = new StatsCtl();
        const ui = uiOf();
        ctl.attach(
            ui,
            deps([
                { id: "q1", knowledge: "秩判别" },
                { id: "q2", knowledge: "秩判别" },
            ])
        );
        ctl.loadKcap("秩判别");
        expect(ui.kcapRows?.map((r) => r.qid)).toEqual(["q1", "q2"]);
        ctl.setTab("overview");
        expect(ui.kcap).toBeUndefined();
        ctl.detach();
        expect(ctl.pendingKcapNow()).toBeUndefined();

        const ctl2 = new StatsCtl();
        ctl2.loadKcap("考点A");
        ctl2.detach();
        expect(ctl2.pendingKcapNow()).toBeUndefined();
    });

    it("空词直接 no-op（不污染挂起态）", () => {
        const ctl = new StatsCtl();
        ctl.loadKcap("");
        expect(ctl.pendingKcapNow()).toBeUndefined();
    });
});
