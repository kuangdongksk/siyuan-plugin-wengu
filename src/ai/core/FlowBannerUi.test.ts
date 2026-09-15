import { beforeEach, describe, expect, it } from "vitest";
import {
    bannerViewOf,
    flowChips,
    flowListFoot,
    flowSegLabel,
    flowSegs,
    listWindowOf,
    LIST_WINDOW,
} from "./FlowBannerUi";
import {
    aiFlowSnapshot,
    beginAiFlow,
    endAiFlow,
    progressAiFlow,
    resetAiFlow,
    type AiFlowQueue,
    type AiFlowSnapshot,
} from "./FlowRegistry";

/**
 * 流级横幅的展示判定（Issue #85）：构成条分段（篇数→flex 权重）、六态
 * 计数与零值压暗、分篇清单窗口、单流态（无队列维度即不出 seg/counts/
 * 清单）、停止态视觉。**断言的是渲染侧真吃的字段**，不是实现细节。
 */

/** 取词替身：把键原样当词（本用例只验**结构与数值**，文案由 i18n 负责）。 */
const t = (k: string): string => k;

/** 六态计数构造（默认全零，按需覆盖）。 */
function counts(over: Partial<AiFlowQueue["counts"]> = {}): AiFlowQueue["counts"] {
    return { done: 0, skipped: 0, running: 0, failed: 0, cancelled: 0, queued: 0, ...over };
}

/** 队列维度构造（items 由 counts 之外的入口另给）。 */
function queue(over: Partial<AiFlowQueue> = {}): AiFlowQueue {
    return { title: "卷", total: 24, current: 12, counts: counts(), items: [], ...over };
}

/** 造 items：n 项，状态由 pick 决定。 */
function items(n: number, pick: (i: number) => AiFlowQueue["items"][number]["state"]) {
    return Array.from({ length: n }, (_, i) => ({ index: i + 1, name: `T${i + 1}`, state: pick(i) }));
}

/** 取词替身（本套断言落在**结构**上，模板只需有占位符可填）。 */
const tpl = (k: string): string =>
    ({
        aiFlowSegLabel: "队列构成：{parts}，共 {n} 篇",
        aiFlowSegJoin: "、",
        aiFlowUnitItem: "篇",
        aiFlowChipDone: "完成",
        aiFlowChipQueued: "排队",
    })[k] ?? k;

describe("构成条分段（篇数 → flex 权重）", () => {
    it("按篇数分段、零篇的段不出（出零权重会挤出 2px 缝）", () => {
        const segs = flowSegs(queue({ counts: counts({ done: 9, skipped: 1, failed: 1, queued: 12 }) }));
        expect(segs).toEqual([
            { cls: "done", weight: 9 },
            { cls: "skip", weight: 1 },
            { cls: "fail", weight: 1 },
            { cls: "queued", weight: 12 },
        ]);
    });

    it("段序照稿：done→skip→fail→run/stop→cancel→queued（红段在主题段之前）", () => {
        const segs = flowSegs(
            queue({
                counts: counts({ done: 1, cancelled: 1, failed: 1, queued: 1, running: 1, skipped: 1 }),
            })
        );
        // 设计稿跑动屏 DOM：s-done / s-skip / s-fail / s-run / s-queued
        expect(segs.map((s) => s.cls)).toEqual(["done", "skip", "fail", "run", "cancel", "queued"]);
    });

    it("停止态：stopped 单列一段（run 段扣掉被停的那篇）+ 取消段", () => {
        const segs = flowSegs(
            queue({
                counts: counts({ done: 9, skipped: 1, running: 1, stopped: 1, failed: 1, cancelled: 12 }),
            })
        );
        // running=1 且 stopped=1 ⇒ 跑动段为 0（被停的那篇归 stop 段）；
        // 段序同为设计稿的 DOM 序（停止屏：…/s-fail/s-stop/s-cancel）
        expect(segs).toEqual([
            { cls: "done", weight: 9 },
            { cls: "skip", weight: 1 },
            { cls: "fail", weight: 1 },
            { cls: "stop", weight: 1 },
            { cls: "cancel", weight: 12 },
        ]);
    });

    it("无队列/总篇数 0 ⇒ 不出条（空数组）", () => {
        expect(flowSegs(undefined)).toEqual([]);
        expect(flowSegs(queue({ total: 0 }))).toEqual([]);
    });

    it("aria-label：逐态「词 + 数 篇」+ 末尾「共 N 篇」（role=img 的可读替代）", () => {
        const q = queue({ counts: counts({ done: 9, queued: 15 }) });
        expect(flowSegLabel(tpl, q)).toBe("队列构成：完成 9 篇、排队 15 篇，共 24 篇"); // 照稿成品串
        expect(flowSegLabel(tpl, undefined)).toBe("");
    });
});

describe("六态计数 chips（零值压暗）", () => {
    it("顺序固定、零值 isZero 压暗（设计稿 chip.is-zero）", () => {
        const chips = flowChips(counts({ done: 9, skipped: 1, failed: 1, queued: 12 }));
        // 跑动期不出「停止」chip（该位恒 0 会多一条噪音零值 chip）
        expect(chips.map((c) => [c.key, c.n, c.isZero])).toEqual([
            ["aiFlowChipDone", 9, false],
            ["aiFlowChipSkipped", 1, false],
            ["aiFlowChipRunning", 0, true],
            ["aiFlowChipFailed", 1, false],
            ["aiFlowChipCancelled", 0, true],
            ["aiFlowChipQueued", 12, false],
        ]);
    });

    it("停止态：出「停止」而**不列零值「进行中」**——两屏各 6 chip（设计稿逐屏计数）", () => {
        const chips = flowChips(counts({ done: 9, skipped: 1, stopped: 1, failed: 1, cancelled: 12 }));
        expect(chips.map((c) => [c.key, c.n, c.isZero])).toEqual([
            ["aiFlowChipDone", 9, false],
            ["aiFlowChipSkipped", 1, false],
            ["aiFlowChipStopped", 1, false],
            ["aiFlowChipFailed", 1, false],
            ["aiFlowChipCancelled", 12, false],
            ["aiFlowChipQueued", 0, true],
        ]);
    });

    it("跑动态：出「进行中」（取消零值照常列、压暗）——同为 6 chip", () => {
        const chips = flowChips(counts({ done: 9, skipped: 1, running: 1, failed: 1, queued: 12 }));
        expect(chips.map((c) => c.key)).toEqual([
            "aiFlowChipDone",
            "aiFlowChipSkipped",
            "aiFlowChipRunning",
            "aiFlowChipFailed",
            "aiFlowChipCancelled",
            "aiFlowChipQueued",
        ]);
    });

    it("**queued 在场**（#79 遗留偏差：五态缺它——排队恰是跑动期最该看到的一态）", () => {
        const chips = flowChips(counts({ done: 1, queued: 20 }));
        expect(chips.some((c) => c.key === "aiFlowChipQueued" && c.n === 20)).toBe(true);
    });
});

describe("分篇清单窗口", () => {
    it("当前行落在窗口第 4 位（设计稿第 12 篇 → 第 9–14 篇）", () => {
        expect(listWindowOf(24, 12)).toEqual({ from: 9, to: 14 });
    });

    it("贴边时向另一端补齐（起点不 <1、终点不 >总数）", () => {
        expect(listWindowOf(24, 1)).toEqual({ from: 1, to: LIST_WINDOW });
        expect(listWindowOf(24, 24)).toEqual({ from: 24 - LIST_WINDOW + 1, to: 24 });
    });

    it("总数不足窗口 ⇒ 全出", () => {
        expect(listWindowOf(3, 2)).toEqual({ from: 1, to: 3 });
    });
});

describe("清单尾行汇总（gap-list A11）", () => {
    const tplFoot = (k: string): string =>
        k === "aiFlowListFoot" ? "已出结果 {done} 篇 · 失败 {fail} 篇 · 取消 {cancel} 篇 · 共 {n} 篇" : k;

    it("按六态计数出「已出结果 / 失败 / 取消 / 共 N 篇」（与 counts 行同一份数字）", () => {
        const foot = flowListFoot(
            tplFoot,
            queue({ counts: counts({ done: 9, skipped: 1, failed: 1, cancelled: 12 }) })
        );
        // 已出结果 = done + skipped（跳过也算「有结果」——已有题集）
        expect(foot).toBe("已出结果 10 篇 · 失败 1 篇 · 取消 12 篇 · 共 24 篇");
    });

    it("无队列/总篇数 0 ⇒ 不出（空串）", () => {
        expect(flowListFoot(tplFoot, undefined)).toBe("");
        expect(flowListFoot(tplFoot, queue({ total: 0 }))).toBe("");
    });

    it("view 模型只在有队列时带 listFoot", () => {
        const snap = (ov: Partial<AiFlowSnapshot> = {}): AiFlowSnapshot => ({
            id: "f",
            title: "转换运行中",
            phase: "running",
            ...ov,
        });
        expect(bannerViewOf(snap(), false, false, tplFoot)!.listFoot).toBe("");
        expect(
            bannerViewOf(snap({ queue: queue({ counts: counts({ done: 3, queued: 21 }) }) }), false, false, tplFoot)!
                .listFoot
        ).toBe("已出结果 3 篇 · 失败 0 篇 · 取消 0 篇 · 共 24 篇");
    });
});

describe("视图模型：三态与结构化载荷", () => {
    /** 造一条注册表快照（默认 running、无结构化载荷）。 */
    const snapshot = (ov: Partial<AiFlowSnapshot> = {}): AiFlowSnapshot => ({
        id: "f",
        title: "转换运行中",
        phase: "running",
        ...ov,
    });

    it("空快照 ⇒ 无横幅", () => {
        expect(bannerViewOf(undefined, false)).toBeUndefined();
    });

    it("单流态（无队列维度）：bar 在场、无 seg/counts/清单/展开入口", () => {
        const view = bannerViewOf(
            snapshot({
                subtitle: "单篇 · 卷",
                stats: { fields: [{ hint: "本篇已读", value: "38%" }] },
                bar: { pct: 38, label: "本篇已读 38%" },
                stop: (): void => undefined,
            }),
            false,
            false,
            t
        )!;
        expect(view.bar).toBe(38);
        expect(view.segs).toEqual([]);
        expect(view.chips).toEqual([]);
        expect(view.rows).toEqual([]);
        expect(view.expandable).toBe(false);
        expect(view.stopping).toBe(true);
        expect(view.stopped).toBe(false);
        expect(view.stats).toEqual([{ hint: "本篇已读", value: "38%", tail: "" }]);
    });

    it("批量队列跑动中：segs/counts/展开入口齐备；展开出窗口内 6 行", () => {
        const q = queue({
            counts: counts({ done: 9, queued: 15 }),
            items: items(24, (i) => (i === 11 ? "running" : i < 9 ? "done" : "queued")),
        });
        const view = bannerViewOf(snapshot({ queue: q }), false, true, t)!;
        expect(view.bar).toBeUndefined(); // 有队列 ⇒ 不出单流条
        expect(view.segs.length).toBeGreaterThan(0);
        expect(view.chips.length).toBeGreaterThan(0);
        expect(view.rows).toHaveLength(LIST_WINDOW);
        expect(view.rows.map((r) => r.idx)).toEqual(["09", "10", "11", "12", "13", "14"]);
        expect(view.listWindow).toMatchObject({ from: 9, to: 14, total: 24 });
        expect(view.rows[3].current).toBe(true); // 第 12 篇=当前行
        expect(view.expanded).toBe(true);
    });

    it("收起时不出行（清单默认收起，展开是用户动作）", () => {
        const q = queue({ counts: counts({ done: 1 }), items: items(24, () => "done") });
        const view = bannerViewOf(snapshot({ queue: q }), false, false, t)!;
        expect(view.rows).toEqual([]);
        expect(view.expandable).toBe(true);
    });

    it("取消行的篇名删除线（is-cancel 由 state=cancelled 推）", () => {
        const q = queue({
            total: 2,
            current: 1,
            counts: counts({ done: 1, cancelled: 1 }),
            items: [
                { index: 1, name: "A", state: "done" },
                { index: 2, name: "B", state: "cancelled" },
            ],
        });
        const view = bannerViewOf(snapshot({ queue: q }), false, true, t)!;
        expect(view.rows[0].cancelled).toBe(false);
        expect(view.rows[1].cancelled).toBe(true);
    });

    it("失败行出原因（状态词 · 原因），其余行不出", () => {
        const q = queue({
            total: 1,
            current: 1,
            counts: counts({ failed: 1 }),
            items: [{ index: 1, name: "A", state: "failed", reason: "超时" }],
        });
        const view = bannerViewOf(snapshot({ queue: q }), false, true, t)!;
        expect(view.rows[0].stateText).toBe("aiFlowChipFailed · 超时");
        expect(view.rows[0].stateCls).toBe("st-fail");
    });

    it("停止态：stopped=true、停止钮撤下（改出保留/丢弃 + badge + 抉择链）", () => {
        const view = bannerViewOf(
            snapshot({
                queue: queue({ counts: counts({ done: 9, cancelled: 12, stopped: 1 }) }),
                phase: "choice",
                stopped: true,
            }),
            false,
            false,
            t
        )!;
        expect(view.stopped).toBe(true);
        expect(view.choosing).toBe(true);
        expect(view.stopping).toBe(false);
    });

    it("停止钮取词：范围词由登记侧给（动作名即范围），armed 时换确认文案", () => {
        const single = snapshot({ stop: (): void => undefined, stopKey: "aiFlowStopSingle" });
        expect(bannerViewOf(single, false, false, t)?.stopKey).toBe("aiFlowStopSingle");
        expect(bannerViewOf(single, true, false, t)?.stopKey).toBe("aiFlowStopConfirm");
        const batch = snapshot({ stop: (): void => undefined, stopKey: "aiFlowStopBatch" });
        expect(bannerViewOf(batch, false, false, t)?.stopKey).toBe("aiFlowStopBatch");
        // 六批流不登记范围词 ⇒ 通用「停止」（**不许**按有无队列维度猜）
        const batchFlow = snapshot({ id: "match", title: "匹配知识文档", stop: (): void => undefined });
        expect(bannerViewOf(batchFlow, false, false, t)?.stopKey).toBe("aiFlowStop");
    });
});

describe("注册表结构化载荷透传（不泄漏 convert 类型）", () => {
    beforeEach(() => resetAiFlow());

    it("progress 只覆盖本次传了的键（漏传不擦掉构成条）", () => {
        beginAiFlow({ id: "f", title: "转换运行中" });
        progressAiFlow("f", "p1", undefined, {
            subtitle: "批量队列 · 卷",
            queue: queue({ counts: counts({ done: 1, queued: 23 }) }),
        });
        expect(aiFlowSnapshot()).toMatchObject({
            subtitle: "批量队列 · 卷",
            queue: { total: 24, counts: { queued: 23 } },
        });
        // 后续只推进度（旧口径的纯文本调用）——结构性字段必须原样保留
        progressAiFlow("f", "p2");
        const snap = aiFlowSnapshot();
        expect(snap?.progress).toBe("p2");
        expect(snap?.subtitle).toBe("批量队列 · 卷");
        expect(snap?.queue?.counts.queued).toBe(23);
        endAiFlow("f");
        expect(aiFlowSnapshot()).toBeUndefined();
    });

    it("结构化形态只含通用键（state/name/note/metric + 六态计数）", () => {
        beginAiFlow({ id: "f", title: "x" });
        progressAiFlow("f", undefined, undefined, {
            queue: queue({
                items: [{ index: 1, name: "A", state: "failed", reason: "超时", note: "已重试", metric: "0 题" }],
            }),
        });
        const item = aiFlowSnapshot()?.queue?.items[0];
        expect(Object.keys(item ?? {}).sort()).toEqual(["index", "metric", "name", "note", "reason", "state"]);
        endAiFlow("f");
    });
});
