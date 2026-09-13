import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchedResult, ConvertProgress, ConvertProgressRecord } from "../run/ConvertBatch";

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
            async (
                docId: string,
                opts: {
                    signal: AbortSignal;
                    onProgress: (p: ConvertProgress) => void;
                    onCheckpoint?: (rec: unknown) => void;
                }
            ) => {
                calls.push(docId);
                // 每批落库后的断点检查点（Issue #62，仅队列内接）
                opts.onCheckpoint?.({
                    setId: `set-${docId}`,
                    title: docId,
                    offset: 100,
                    batches: 1,
                    total: 0,
                    count: 3,
                });
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
import { classifyQueueItem } from "../run/ConvertBatchQueue";
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
    checkpoints: { id: string; rec: unknown }[];
} {
    const statuses: string[] = [];
    const latest = new Map<string, string>();
    const progressSaved: string[] = [];
    const convFlags: boolean[] = [];
    const checkpoints: { id: string; rec: unknown }[] = [];
    const ev: ConvertRunEvents = {
        t: (k) => k,
        bank: {
            flush: (): Promise<void> => Promise.resolve(),
            // 跳过判定（Issue #62）起跑前一次 bank.all() 建 srcId→setId 映射
            all: (): Promise<{ sets: Record<string, { srcId?: string }> }> => Promise.resolve({ sets }),
        } as never,
        setConverting: (v) => convFlags.push(v),
        onStatus: (html) => statuses.push(html),
        onBatch: () => undefined,
        onStopChoice: () => undefined,
        onDone: () => undefined,
        saveProgress: (id, rec) => {
            // progressSaved 只记**清记录**（settleDone 的 undefined）——
            // 中断路写记录走 checkpoints / 各自的 saved 收集器
            if (rec) checkpoints.push({ id, rec });
            else progressSaved.push(id);
        },
        onBatchItem: (item) => latest.set(item.title, item.status),
        getProgress: (id) => records.get(id),
    };
    return {
        ev,
        statuses,
        finalStatus: (title: string): string | undefined => latest.get(title),
        progressSaved,
        convFlags,
        checkpoints,
    };
}

/** 题库已有题集（跳过判定）：srcId → setId。 */
let sets: Record<string, { srcId?: string }> = {};
/** 既有续跑记录（逐篇自查）：docId → 记录。 */
let records = new Map<string, ConvertProgressRecord>();

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
    sets = {};
    records = new Map();
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
        // 只收**收口**记录（失败续跑）：中途检查点 total 恒 0，见 Issue #62
        ev.saveProgress = (id, rec) => {
            if (rec && rec.total > 0) saved.push({ id, rec });
        };
        startConvertRun({ ...cfg, subDocs: REFS, batchTitle: "队列" }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(saved.map((x) => x.id)).toEqual([REFS[1].id]);
        // 失败篇的续跑记录带队列维度（面板「未完成记录」要标出第几篇）
        expect((saved[0].rec as { batch?: { index: number; total: number; groupTitle?: string } }).batch).toEqual({
            index: 1,
            total: 3,
            groupTitle: "队列",
            rootId: cfg.srcDocId, // Issue #62：面板「继续生成」据此恢复整个队列
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
        // 同上：只收收口的保留记录（中途检查点由「断点检查点」用例覆盖）
        ev.saveProgress = (id, rec) => {
            if (rec && rec.total > 0) saved.push({ id, rec });
        };
        startConvertRun({ ...cfg, subDocs: REFS, batchTitle: "队列" }, ev);
        await vi.waitFor(() => expect(convertRunSnapshot()?.pendingChoice).toBe(true));
        await keepConvertRun();
        expect(saved.map((x) => x.id)).toEqual([REFS[0].id]);
        expect((saved[0].rec as { batch?: { index: number; total: number } }).batch).toEqual({
            index: 0,
            total: 3,
            groupTitle: "队列",
            rootId: cfg.srcDocId,
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
            rootId: cfg.srcDocId, // Issue #62：队列根（cfg.srcDocId）
        });
    });

    it("重发队列跳过题库已有题集的篇（零 AI），勾「重转已转换过的篇」则照跑", async () => {
        // 三篇里第二篇题库里已有题集（=转换完成过），无续跑记录
        sets = { "set-2": { srcId: REFS[1].id } };
        for (const r of REFS) plan.set(r.id, async (id) => done(id));
        const { ev, finalStatus, statuses } = events();
        startConvertRun({ ...cfg, subDocs: REFS, batchTitle: "队列" }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(calls).toEqual([REFS[0].id, REFS[2].id]); // 第二篇零 AI 跳过
        expect(REFS.map((r) => finalStatus(r.title))).toEqual(["done", "skipped", "done"]);
        expect(statuses[statuses.length - 1]).toContain("convertBatchTailSkipped");
    });

    it("勾 reconvertDone 时即使题库已有题集也照常重转", async () => {
        sets = { "set-1": { srcId: REFS[1].id } };
        for (const r of REFS) plan.set(r.id, async (id) => done(id));
        const { ev, finalStatus, statuses } = events();
        startConvertRun({ ...cfg, subDocs: REFS, batchTitle: "队列", reconvertDone: true }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(calls).toEqual(REFS.map((r) => r.id));
        expect(REFS.map((r) => finalStatus(r.title))).toEqual(["done", "done", "done"]);
        expect(statuses[statuses.length - 1]).not.toContain("convertBatchTailSkipped");
    });

    it("有续跑记录的篇不受跳过影响（照旧从断点续跑）", async () => {
        sets = { "set-2": { srcId: REFS[1].id } };
        records = new Map([
            [
                REFS[1].id,
                {
                    setId: "set-2",
                    title: "02",
                    offset: 40,
                    batches: 1,
                    total: 1,
                    count: 1,
                },
            ],
        ]);
        for (const r of REFS) plan.set(r.id, async (id) => done(id));
        const { ev, finalStatus } = events();
        startConvertRun({ ...cfg, subDocs: REFS }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(calls).toEqual(REFS.map((r) => r.id)); // 续跑优先于跳过
        expect(REFS.map((r) => finalStatus(r.title))).toEqual(["done", "done", "done"]);
    });

    it("查库失败时全部按「无题集」处置：照常从头转（宁多烧不漏转）", async () => {
        for (const r of REFS) plan.set(r.id, async (id) => done(id));
        const { ev } = events();
        (ev.bank as unknown as { all: () => Promise<never> }).all = () => Promise.reject(new Error("boom"));
        startConvertRun({ ...cfg, subDocs: REFS.slice(0, 2) }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(calls).toEqual(REFS.slice(0, 2).map((r) => r.id));
    });

    it("队列全部完成后重发：全部跳过、零 AI（验收 3）", async () => {
        sets = {
            "set-1": { srcId: REFS[0].id },
            "set-2": { srcId: REFS[1].id },
            "set-3": { srcId: REFS[2].id },
        };
        for (const r of REFS) plan.set(r.id, async (id) => done(id));
        const { ev, finalStatus, statuses } = events();
        startConvertRun({ ...cfg, subDocs: REFS, batchTitle: "队列" }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(calls).toEqual([]); // 一次 AI 都没起
        expect(REFS.map((r) => finalStatus(r.title))).toEqual(["skipped", "skipped", "skipped"]);
        const tail = statuses[statuses.length - 1];
        expect(tail).toContain("convertBatchTailSkipped");
        expect(tail).not.toContain("convertBatchTailDone"); // 全跳过时不报「完成 0 篇」噪音
    });

    it("classifyQueueItem：有记录先续跑，其次看题集与重转开关", () => {
        const rec = { offset: 10, setId: "s" };
        expect(classifyQueueItem(rec, true, false)).toBe("resume");
        expect(classifyQueueItem(rec, true, true)).toBe("resume"); // 记录优先于跳过
        expect(classifyQueueItem(undefined, true, false)).toBe("skip");
        expect(classifyQueueItem(undefined, true, true)).toBe("fresh"); // 勾了重转
        expect(classifyQueueItem(undefined, false, false)).toBe("fresh");
        expect(classifyQueueItem({ offset: 0 }, true, false)).toBe("resume");
    });

    it("队列内逐批落断点检查点（带本篇 id + 队列维度）", async () => {
        for (const r of REFS) plan.set(r.id, async (id) => done(id));
        const { ev, checkpoints } = events();
        startConvertRun({ ...cfg, subDocs: REFS.slice(0, 2), batchTitle: "队列" }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(checkpoints.length).toBeGreaterThan(0);
        for (const cp of checkpoints) {
            const rec = cp.rec as { offset: number; batches: number; total: number; setId?: string };
            expect(cp.id).not.toBe(cfg.srcDocId);
            expect(rec.offset).toBe(100);
            expect(rec.batches).toBe(1); // 已落库批数口径
            expect(rec.total).toBe(0); // 中途未知（批数由 AI 的 @@TO 决定）
        }
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
