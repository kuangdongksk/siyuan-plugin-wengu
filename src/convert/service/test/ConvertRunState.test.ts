import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchedResult } from "../run/ConvertBatch";

/**
 * ConvertRun 单例状态机（Issue #115）：ConvertBatchQueue/ConvertFlow 已覆盖
 * 队列与横幅，但**单篇**这条主链的槽位语义（起跑占槽、第二次被拒、终止后
 * keep/discard 各清哪些账）只在真机上被验证过。批次循环整体 mock（内核 IO/
 * AI 不进单测），这里锁四件事：
 *  ① 单例槽：有在途运行/待抉择时 startConvertRun 一律 false；
 *  ② 收到 done/failed 清槽 + 清本篇进度记录；意外异常同样清槽（防永久卡死）；
 *  ③ aborted 且已落库 → 转抉择态（槽交给抉择持有，进度记录保留）；
 *  ④ keep 落进度记录 + 收尾；discard 回收题库 + 清进度 + 复位，两者都清抉择槽。
 */

/** convertDocBatched 替身：按 docId 回放预设结果。 */
const plan = new Map<string, () => Promise<BatchedResult>>();
const calls: string[] = [];
vi.mock("../run/ConvertBatch", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../run/ConvertBatch")>();
    return {
        ...orig,
        convertDocBatched: vi.fn(async (docId: string) => {
            calls.push(docId);
            const fn = plan.get(docId);
            if (!fn) throw new Error(`no plan for ${docId}`);
            return fn();
        }),
    };
});

/** SetWriter 替身：只记「丢弃了哪个题集、哪些 qid」。 */
const discards: { setId: string; qids: string[] }[] = [];
vi.mock("../output/SetWriter", () => ({
    SetWriter: class {
        discard(setId: string, qids: string[]): Promise<void> {
            discards.push({ setId, qids });
            return Promise.resolve();
        }
    },
}));

/** 通知层替身（单测环境无浮层）。 */
vi.mock("../../../ui/Notify", () => ({
    notifyError: vi.fn(),
    notifyInfo: vi.fn(),
    initNotify: (): void => undefined,
}));

import {
    convertRunActive,
    convertRunSnapshot,
    discardConvertRun,
    keepConvertRun,
    startConvertRun,
    startExclusiveConvertRun,
    stopConvertRun,
    subscribeConvertRun,
    type ConvertRunCfg,
    type ConvertRunEvents,
} from "../run/ConvertRun";
import { setAborted, setActive } from "../run/ConvertRunState";

const cfg: ConvertRunCfg = {
    srcDocId: "doc-1",
    modelId: "m",
    fillToChoice: false,
    bigToSteps: false,
    parallel: 1,
    knowRoots: [],
};

const done = (setId = "set-1"): BatchedResult => ({
    status: "done",
    message: "",
    setId,
    title: "题集",
    count: 3,
    batches: 1,
    total: 1,
    doneOffset: 100,
    writtenQids: [`${setId}-q1`, `${setId}-q2`],
});

const aborted = (setId: string | undefined): BatchedResult => ({
    status: "aborted",
    message: "",
    setId,
    title: "题集",
    count: 2,
    batches: 1,
    total: 0,
    doneOffset: 60,
    writtenQids: [`${setId}-q1`],
});

const failed = (patch: Partial<BatchedResult> = {}): BatchedResult => ({
    status: "failed",
    message: "网络异常",
    setId: "set-1",
    title: "题集",
    count: 1,
    batches: 1,
    total: 0,
    doneOffset: 30,
    writtenQids: ["set-1-q1"],
    ...patch,
});

/** 事件替身：收集状态条/抉择/收尾/进度记录。 */
function events(): {
    ev: ConvertRunEvents;
    saved: { id: string; rec: unknown }[];
    choices: unknown[];
    convFlags: boolean[];
    statuses: string[];
    done: unknown[];
    cancels: number;
} {
    const saved: { id: string; rec: unknown }[] = [];
    const choices: unknown[] = [];
    const convFlags: boolean[] = [];
    const statuses: string[] = [];
    const doneOut: unknown[] = [];
    const state = { cancels: 0 };
    const ev: ConvertRunEvents = {
        t: (k) => k,
        bank: { flush: (): Promise<void> => Promise.resolve() } as never,
        setConverting: (v) => convFlags.push(v),
        onStatus: (html) => statuses.push(html),
        onBatch: () => undefined,
        onStopChoice: (info) => choices.push(info),
        onCancel: () => state.cancels++,
        onDone: (r) => doneOut.push(r),
        saveProgress: (id, rec) => saved.push({ id, rec }),
    };
    return {
        ev,
        saved,
        choices,
        convFlags,
        statuses,
        done: doneOut,
        get cancels() {
            return state.cancels;
        },
    } as unknown as {
        ev: ConvertRunEvents;
        saved: { id: string; rec: unknown }[];
        choices: unknown[];
        convFlags: boolean[];
        statuses: string[];
        done: unknown[];
        cancels: number;
    };
}

beforeEach(() => {
    plan.clear();
    calls.length = 0;
    discards.length = 0;
    setActive(undefined);
    setAborted(undefined);
});

describe("单例槽 · 起跑与拒绝", () => {
    it("空闲时起跑占槽：返回 true、setConverting(true)、状态条先给「转换中」", () => {
        plan.set("doc-1", async () => done());
        const e = events();
        expect(startConvertRun(cfg, e.ev)).toBe(true);
        expect(convertRunActive()).toBe(true);
        expect(e.convFlags[0]).toBe(true);
        expect(e.statuses[0]).toBe("converting");
        expect(convertRunSnapshot()).toMatchObject({ running: true, pendingChoice: false, srcDocId: "doc-1" });
    });

    it("在途运行时第二次起跑被拒（false，不新起一笔）", async () => {
        let release!: () => void;
        plan.set("doc-1", async () => {
            await new Promise<void>((r) => (release = r));
            return done();
        });
        const e = events();
        expect(startConvertRun(cfg, e.ev)).toBe(true);
        expect(startConvertRun({ ...cfg, srcDocId: "doc-2" }, events().ev)).toBe(false);
        expect(calls).toEqual(["doc-1"]); // 第二笔根本没起
        release();
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
    });

    it("终止待抉择（aborted）时同样被拒——旧抉择不许悬空", async () => {
        plan.set("doc-1", async () => aborted("set-1"));
        const e = events();
        startConvertRun(cfg, e.ev);
        await vi.waitFor(() => expect(convertRunSnapshot()?.pendingChoice).toBe(true));
        expect(startConvertRun(cfg, events().ev)).toBe(false);
    });

    it("独占槽（增量流程）也吃同一把锁：起了独占槽后普通起跑被拒", () => {
        const e = events();
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        expect(
            startExclusiveConvertRun(e.ev, "doc-9", async () => {
                await gate;
            })
        ).toBe(true);
        expect(convertRunActive()).toBe(true);
        expect(startConvertRun(cfg, events().ev)).toBe(false);
        release();
    });

    it("独占槽执行体结束后自动释放（含异常路径）", async () => {
        const e = events();
        expect(startExclusiveConvertRun(e.ev, "doc-9", async () => Promise.reject(new Error("boom")))).toBe(true);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(e.statuses.at(-1)).toContain("boom"); // 异常也走 err 终态
    });
});

describe("收口 · done / failed", () => {
    it("done：清槽 + 复位「转换中」+ 清本篇进度记录 + 收尾回调", async () => {
        plan.set("doc-1", async () => done());
        const e = events();
        startConvertRun(cfg, e.ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(e.saved).toEqual([{ id: "doc-1", rec: undefined }]); // 清残留进度
        expect(e.convFlags.at(-1)).toBe(false);
        expect(e.done).toEqual([{ setId: "set-1", title: "题集", count: 3, message: "" }]);
    });

    it("failed：清槽 + 记本篇续跑进度（可「继续生成」）+ 状态条 err 终态", async () => {
        plan.set("doc-1", async () => failed());
        const e = events();
        startConvertRun(cfg, e.ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(e.saved.length).toBe(1);
        expect(e.saved[0]).toMatchObject({
            id: "doc-1",
            rec: { setId: "set-1", offset: 30, batches: 1, count: 1 },
        });
        expect(e.done).toEqual([]); // 失败不收尾
    });

    it("failed 且 count=0 但 doneOffset>0：仍写记录（续跑第一批判定就挂，断点不许蒸发，Issue #208）", async () => {
        plan.set("doc-1", async () => failed({ count: 0, doneOffset: 120, writtenQids: [] }));
        const e = events();
        startConvertRun(cfg, e.ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(e.saved).toEqual([{ id: "doc-1", rec: expect.objectContaining({ setId: "set-1", offset: 120 }) }]);
    });

    it("failed 且 setId 为空 + 零断点：仍不写记录（零产物失败现状不变）", async () => {
        plan.set("doc-1", async () => failed({ setId: undefined, count: 0, doneOffset: 0 }));
        const e = events();
        startConvertRun(cfg, e.ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(e.saved).toEqual([]);
    });

    it("failed 且 setId 为空但 doneOffset>0（异常残留断点）：不写（无题集可续）", async () => {
        plan.set("doc-1", async () => failed({ setId: undefined, count: 0, doneOffset: 30 }));
        const e = events();
        startConvertRun(cfg, e.ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(e.saved).toEqual([]);
    });

    it("意外异常：同样清槽（否则「开始转换」永久不可用）", async () => {
        plan.set("doc-1", async () => {
            throw new Error("崩了");
        });
        const e = events();
        expect(startConvertRun(cfg, e.ev)).toBe(true);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(e.convFlags.at(-1)).toBe(false);
        expect(e.statuses.at(-1)).toContain("崩了");
        expect(startConvertRun(cfg, events().ev)).toBe(true); // 能再起一笔（槽确实清了）
    });
});

describe("aborted · 抉择态与 keep / discard", () => {
    it("首批前零产物终止：直接终态，不起抉择", async () => {
        plan.set("doc-1", async () => aborted(undefined));
        const e = events();
        startConvertRun(cfg, e.ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(e.choices).toEqual([]);
        expect(e.statuses.at(-1)).toBe("convertStoppedEmpty");
    });

    it("有产物终止：转抉择态，快照带待抉择题数，进度记录此刻**不写**", async () => {
        plan.set("doc-1", async () => aborted("set-1"));
        const e = events();
        startConvertRun(cfg, e.ev);
        await vi.waitFor(() => expect(convertRunSnapshot()?.pendingChoice).toBe(true));
        const snap = convertRunSnapshot()!;
        expect(snap.running).toBe(false);
        expect(snap.pending).toEqual({ count: 2, batches: 1, total: 0 });
        expect(e.choices.length).toBe(1);
        expect(e.saved).toEqual([]); // 抉择未落定前不记进度
    });

    it("keep：落进度记录（含断点）→ 收尾 → 清抉择槽", async () => {
        plan.set("doc-1", async () => aborted("set-1"));
        const e = events();
        startConvertRun(cfg, e.ev);
        await vi.waitFor(() => expect(convertRunSnapshot()?.pendingChoice).toBe(true));
        await keepConvertRun();
        expect(e.saved).toEqual([
            { id: "doc-1", rec: { setId: "set-1", title: "题集", offset: 60, batches: 1, total: 0, count: 2 } },
        ]);
        expect(e.done.length).toBe(1);
        expect(convertRunSnapshot()).toBeUndefined(); // 抉择槽已清
        expect(convertRunActive()).toBe(false);
    });

    it("discard：按本次写入 qid 回收题库 + 清进度 + 页面复位 + 清抉择槽", async () => {
        plan.set("doc-1", async () => aborted("set-1"));
        const e = events();
        startConvertRun(cfg, e.ev);
        await vi.waitFor(() => expect(convertRunSnapshot()?.pendingChoice).toBe(true));
        discardConvertRun();
        expect(discards).toEqual([{ setId: "set-1", qids: ["set-1-q1"] }]);
        expect(e.saved).toEqual([{ id: "doc-1", rec: undefined }]); // 清进度
        expect(e.cancels).toBe(1); // 页面复位
        expect(e.done).toEqual([]); // 丢弃不收尾
        expect(convertRunSnapshot()).toBeUndefined();
    });

    it("keep / discard 在无抉择态时是空动作（幂等，不误伤）", async () => {
        const e = events();
        await keepConvertRun();
        discardConvertRun();
        expect(e.saved).toEqual([]);
        expect(discards).toEqual([]);
    });
});

describe("stopConvertRun · 停止入口", () => {
    it("在途运行点停 → 走 aborted 收口（无产物则直接终态）", async () => {
        plan.set("doc-1", async () => {
            stopConvertRun(); // 用户点停（abort 带 AI_STOPPED 理由）
            return aborted(undefined);
        });
        const e = events();
        startConvertRun(cfg, e.ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(e.statuses.at(-1)).toBe("convertStoppedEmpty");
    });

    it("空闲时点停零动作（不崩、不造抉择）", () => {
        stopConvertRun();
        expect(convertRunSnapshot()).toBeUndefined();
    });
});

describe("订阅 · 状态变化广播", () => {
    it("进度推进/收口都广播；退订后不再收", async () => {
        plan.set("doc-1", async () => done());
        const e = events();
        let hits = 0;
        const off = subscribeConvertRun(() => hits++);
        startConvertRun(cfg, e.ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(hits).toBeGreaterThan(0);
        off();
        const before = hits;
        startConvertRun({ ...cfg, srcDocId: "doc-1" }, e.ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(hits).toBe(before);
    });
});

describe("快照 · 无在途状态", () => {
    it("空闲返回 undefined（面板据此隐藏进度行）", () => {
        expect(convertRunSnapshot()).toBeUndefined();
        expect(convertRunActive()).toBe(false);
    });
});
