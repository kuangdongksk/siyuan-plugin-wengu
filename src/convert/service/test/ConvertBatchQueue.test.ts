import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchedResult, ConvertProgress } from "../run/ConvertBatch";

/**
 * 批量转换串行队列（Issue #37）：跑通 ConvertBatchQueue 的编排层——
 * convertDocBatched 整体 mock（内核 IO/AI 不进单测），断言四条硬口径：
 *  1. 逐篇**串行**（上一篇 resolve 之后才起下一篇）；
 *  2. 队列全程占住 active 槽，篇与篇之间不释放（convertRunActive 恒真）；
 *  3. 单篇失败**不打断队列**（记失败继续下一篇），终态汇总含清单；
 *  4. 「停止」= 当前篇终止 + 剩余篇全部 cancelled。
 */

const calls: string[] = [];
/** 每篇的行为：done / failed / aborted（返回该篇的 BatchedResult）。 */
const plan = new Map<string, (docId: string, signal: AbortSignal) => Promise<BatchedResult>>();

vi.mock("../run/ConvertBatch", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../run/ConvertBatch")>();
    return {
        ...orig,
        convertDocBatched: vi.fn(
            async (docId: string, opts: { signal: AbortSignal; onProgress: (p: ConvertProgress) => void }) => {
                calls.push(docId);
                opts.onProgress({
                    phase: "generating",
                    batch: 1,
                    total: 0,
                    count: 3,
                    lastBatch: 3,
                    readPct: 50,
                    setId: `set-${docId}`,
                });
                const fn = plan.get(docId);
                if (!fn) throw new Error(`no plan for ${docId}`);
                return fn(docId, opts.signal);
            }
        ),
    };
});

const done = (docId: string): BatchedResult => ({
    status: "done",
    message: "",
    setId: `set-${docId}`,
    title: docId,
    count: 3,
    batches: 1,
    total: 1,
    doneOffset: 100,
    writtenQids: [`q-${docId}`],
});
const failed = (docId: string): BatchedResult => ({
    status: "failed",
    message: "网络异常",
    setId: `set-${docId}`,
    title: docId,
    count: 1,
    batches: 1,
    total: 1,
    doneOffset: 40,
    writtenQids: [`q-${docId}`],
});

import {
    convertRunActive,
    convertRunSnapshot,
    discardConvertRun,
    keepConvertRun,
    startConvertRun,
    stopConvertRun,
} from "../run/ConvertRun";
import { batchMetaOf } from "../run/ConvertRunState";
import type { ConvertRunCfg, ConvertRunEvents } from "../run/ConvertRun";

/** onBatchItem 会推「running→终态」多次，测试只关心每篇的**最终**状态：
 *  按 title 记最后一次。 */
/** 每篇的**最终**状态（onBatchItem 会推 running→终态多次，取最后一次）。 */
function events(): {
    ev: ConvertRunEvents;
    statuses: string[];
    finalStatus: (title: string) => string | undefined;
    progressSaved: string[];
    convFlags: boolean[];
} {
    const statuses: string[] = [];
    const latest = new Map<string, string>();
    const progressSaved: string[] = [];
    const convFlags: boolean[] = [];
    const ev: ConvertRunEvents = {
        t: (k) => k,
        bank: { flush: (): Promise<void> => Promise.resolve() } as never,
        setConverting: (v) => convFlags.push(v),
        onStatus: (html) => statuses.push(html),
        onBatch: () => undefined,
        onStopChoice: () => undefined,
        onDone: () => undefined,
        saveProgress: (id) => progressSaved.push(id),
        onBatchItem: (item) => latest.set(item.title, item.status),
        getProgress: () => undefined,
    };
    return {
        ev,
        statuses,
        finalStatus: (title: string): string | undefined => latest.get(title),
        progressSaved,
        convFlags,
    };
}

const REFS = [
    { id: "20260828145730-aaaaaaaa", title: "01-马原-题解" },
    { id: "20260828145731-bbbbbbbb", title: "02-毛中特-题解" },
    { id: "20260828145732-cccccccc", title: "03-史纲-题解" },
];

const cfg: ConvertRunCfg = {
    srcDocId: "20260828145729-00000000", // 根（文件夹式文档自身，非队列元素）
    modelId: "m",
    fillToChoice: false,
    bigToSteps: false,
    parallel: 1,
    knowRoots: [],
};

beforeEach(async () => {
    calls.length = 0;
    plan.clear();
    // 上一测试若终止在抉择态，落定它，避免 aborted 残留挡下一次 start
    if (convertRunSnapshot()?.pendingChoice) await keepConvertRun().catch((): void => undefined);
    discardConvertRun();
});

describe("ConvertBatchQueue", () => {
    it("逐篇串行跑完，队列全程占槽", async () => {
        for (const r of REFS) plan.set(r.id, async (id) => done(id));
        const { ev, finalStatus } = events();
        expect(startConvertRun({ ...cfg, subDocs: REFS, batchTitle: "肖秀荣1000题-题解版" }, ev)).toBe(true);
        // 起跑瞬间即占槽
        expect(convertRunActive()).toBe(true);
        await vi.waitFor(() => expect(calls.length).toBe(REFS.length));
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(calls).toEqual(REFS.map((r) => r.id)); // 串行且按队列序
        expect(REFS.map((r) => finalStatus(r.title))).toEqual(["done", "done", "done"]);
    });

    it("中途一篇失败不打断队列（其余照常完成，终态含清单）", async () => {
        plan.set(REFS[0].id, async (id) => done(id));
        plan.set(REFS[1].id, async () => failed(REFS[1].id));
        plan.set(REFS[2].id, async (id) => done(id));
        const { ev, statuses, finalStatus } = events();
        startConvertRun({ ...cfg, subDocs: REFS, batchTitle: "队列" }, ev);
        await vi.waitFor(() => expect(calls.length).toBe(3));
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(REFS.map((r) => finalStatus(r.title))).toEqual(["done", "failed", "done"]);
        const tail = statuses[statuses.length - 1];
        expect(tail).toContain("convertBatchTailFail");
    });

    it("「停止」= 当前篇终止 + 剩余篇全部 cancelled", async () => {
        plan.set(REFS[0].id, async (id) => {
            stopConvertRun(); // 跑第一篇时用户点停止
            return { ...done(id), status: "aborted", count: 2 } as BatchedResult;
        });
        for (const r of REFS.slice(1)) plan.set(r.id, async (id) => done(id));
        const { ev, finalStatus } = events();
        startConvertRun({ ...cfg, subDocs: REFS, batchTitle: "队列" }, ev);
        // 有产物则进抉择态（convertRunActive 保持 true——抉择未落定）
        await vi.waitFor(() => expect(convertRunSnapshot()?.pendingChoice).toBe(true));
        expect(calls).toEqual([REFS[0].id]); // 剩余篇一篇都没跑
        // 被终止那篇=stopped（待抉择），未跑的剩余篇=cancelled
        expect(REFS.map((r) => finalStatus(r.title))).toEqual(["stopped", "cancelled", "cancelled"]);
    });

    it("逐篇 done 各自清自己那篇的进度记录（不误清根）", async () => {
        for (const r of REFS) plan.set(r.id, async (id) => done(id));
        const { ev, progressSaved } = events();
        startConvertRun({ ...cfg, subDocs: REFS }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        // settleDone 对**本篇**清记录（undefined 表示删键）——不是根 id
        expect(progressSaved).toEqual(REFS.map((r) => r.id));
        expect(progressSaved).not.toContain(cfg.srcDocId);
    });

    it("失败篇记的是自己那篇的续跑进度（带批量维度、按篇 id）", async () => {
        plan.set(REFS[0].id, async (id) => done(id));
        plan.set(REFS[1].id, async () => failed(REFS[1].id));
        plan.set(REFS[2].id, async (id) => done(id));
        const saved: { id: string; rec: unknown }[] = [];
        const { ev } = events();
        ev.saveProgress = (id, rec) => {
            if (rec) saved.push({ id, rec });
        };
        startConvertRun({ ...cfg, subDocs: REFS, batchTitle: "队列" }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(saved.map((x) => x.id)).toEqual([REFS[1].id]);
        // 失败篇的续跑记录带队列维度（面板「未完成记录」要标出第几篇）
        expect((saved[0].rec as { batch?: { index: number; total: number; groupTitle?: string } }).batch).toEqual({
            index: 1,
            total: 3,
            groupTitle: "队列",
        });
    });

    it("不传 subDocs（单篇流程）不走队列：无分篇行", async () => {
        plan.set(cfg.srcDocId, async (id) => done(id));
        const { ev, finalStatus } = events();
        startConvertRun(cfg, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(calls).toEqual([cfg.srcDocId]);
        expect(convertRunSnapshot()?.batch).toBeUndefined();
        expect(finalStatus(REFS[0].title)).toBeUndefined();
    });

    it("停止后剩余篇的 items 真翻「已取消」（不许只算总数不改状态）", async () => {
        plan.set(REFS[0].id, async (id) => {
            stopConvertRun(); // 跑第一篇时用户点停止（首篇也零产物 → 队列直接收口）
            return { ...done(id), status: "aborted", setId: undefined, count: 0 } as BatchedResult;
        });
        for (const r of REFS.slice(1)) plan.set(r.id, async (id) => done(id));
        const { ev, statuses, finalStatus } = events();
        startConvertRun({ ...cfg, subDocs: REFS, batchTitle: "队列" }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(calls).toEqual([REFS[0].id]);
        // 首篇零产物被中止=stopped，剩余两篇=cancelled，不留「排队中」残影
        expect(REFS.map((r) => finalStatus(r.title))).toEqual(["stopped", "cancelled", "cancelled"]);
        const tail = statuses[statuses.length - 1];
        expect(tail).toContain("convertBatchTailCancel");
        expect(tail).toContain("convertBatchTailStopped");
        // 一篇没成时不报「完成 0 篇」的噪音段
        expect(tail).not.toContain("convertBatchTailDone");
    });

    it("换篇时复位「转换中」标记（内层失败收口会把它清掉，队列要占回来）", async () => {
        plan.set(REFS[0].id, async () => failed(REFS[0].id));
        plan.set(REFS[1].id, async (id) => done(id));
        const { ev, convFlags } = events();
        startConvertRun({ ...cfg, subDocs: REFS.slice(0, 2), batchTitle: "队列" }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        // 不变量：任何时刻「还有篇要跑」就不该停在 setConverting(false)
        const firstFalse = convFlags.indexOf(false);
        if (firstFalse >= 0) expect(convFlags.slice(firstFalse)).toContain(true);
        expect(convFlags[0]).toBe(true);
        expect(convFlags[convFlags.length - 1]).toBe(false);
    });

    it("「保留已生成」按**当前篇**落 batch 维度（单篇不带该键）", async () => {
        plan.set(REFS[0].id, async (id) => {
            stopConvertRun();
            return { ...done(id), status: "aborted", setId: `set-${id}`, count: 2 } as BatchedResult;
        });
        const saved: { id: string; rec: unknown }[] = [];
        const { ev } = events();
        ev.saveProgress = (id, rec) => {
            if (rec) saved.push({ id, rec });
        };
        startConvertRun({ ...cfg, subDocs: REFS, batchTitle: "队列" }, ev);
        await vi.waitFor(() => expect(convertRunSnapshot()?.pendingChoice).toBe(true));
        await keepConvertRun();
        expect(saved.map((x) => x.id)).toEqual([REFS[0].id]);
        expect((saved[0].rec as { batch?: { index: number; total: number } }).batch).toEqual({
            index: 0,
            total: 3,
            groupTitle: "队列",
        });
    });

    it("batchMetaOf：单篇/队列外/空队列一律 undefined", () => {
        expect(batchMetaOf(cfg, cfg.srcDocId)).toBeUndefined();
        expect(batchMetaOf({ ...cfg, subDocs: REFS }, "20260828145739-ffffffff")).toBeUndefined();
        expect(batchMetaOf({ ...cfg, subDocs: [] }, cfg.srcDocId)).toBeUndefined();
        expect(batchMetaOf({ ...cfg, subDocs: REFS, batchTitle: "队列" }, REFS[2].id)).toEqual({
            index: 2,
            total: 3,
            groupTitle: "队列",
        });
    });

    it("快照在队列运行中给出分篇进度行", async () => {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        plan.set(REFS[0].id, async (id) => {
            await gate;
            return done(id);
        });
        for (const r of REFS.slice(1)) plan.set(r.id, async (id) => done(id));
        const { ev } = events();
        startConvertRun({ ...cfg, subDocs: REFS, batchTitle: "队列" }, ev);
        await vi.waitFor(() => expect(calls.length).toBe(1));
        const snap = convertRunSnapshot();
        expect(snap?.batch?.title).toBe("队列");
        expect(snap?.batch?.items[0].status).toBe("running");
        expect(snap?.batch?.items[1].status).toBe("queued");
        release();
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
    });
});
