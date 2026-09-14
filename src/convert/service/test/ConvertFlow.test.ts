import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiFlowSnapshot, resetAiFlow } from "../../../ai/core/FlowRegistry";

/**
 * 转换族 × 流级横幅（Issue #77，回归测试 3）：横幅订阅 ConvertRun 的
 * **既有状态机**（快照）单向同步——本用例直接驱动 ConvertRunState 的
 * 槽位（active/aborted）与 notifyState，断言横幅的四个阶段（起流/进度/
 * 待抉择/收口）与「待抉择按钮 → keep/discard」的接线。
 *
 * keep/discard 用 mock：本文件只验**接线**（点哪个钮调到哪个导出函数），
 * 落库/回收的语义由 ConvertRun 自己的用例覆盖。
 */
vi.mock("../run/ConvertRun", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../run/ConvertRun")>();
    return {
        ...actual,
        keepConvertRun: vi.fn(async () => undefined),
        discardConvertRun: vi.fn(() => undefined),
    };
});

import { discardConvertRun, keepConvertRun, type ConvertRunCfg } from "../run/ConvertRun";
import { attachConvertFlow, detachConvertFlow, CONVERT_FLOW_ID } from "../run/ConvertFlow";
import { setAborted, setActive, notifyState } from "../run/ConvertRunState";

/** 取词替身：给出**带占位符的真实模板**（t 直接返回键名的话 fmt 无从填空，
 *  断言只能落在键名上、锁不住「填的是这几个数」）。 */
const TEMPLATES: Record<string, string> = {
    convertStepProgress: "已读 {p}% · 累计 {c} 题",
    convertLastBatch: "上批 +{k}",
    convertBatchHead: "第 {i}/{n} 篇 · {title}",
    convertStopped: "已终止：{c} 题",
    // 副标题/统计/分篇行的取词（Issue #85）
    aiFlowSubBatch: "批量队列",
    aiFlowSubSingle: "单篇",
    aiFlowSub: "{head} ·《{title}》",
    aiFlowStatAt: "第",
    aiFlowStatStoppedAt: "停在第",
    aiFlowStatRead: "本篇已读",
    aiFlowStatTotal: "累计",
    aiFlowStatBatches: "已生成",
    aiFlowChipDone: "完成",
    aiFlowChipQueued: "排队",
    aiFlowRowNoteRead: "本篇已读 {p}%",
    aiFlowRowNoteFailed: "不阻塞后续篇",
    aiFlowRowNoteDone: "已写入题集",
    aiFlowRowNoteBatch: "累计 {c} 题",
    aiFlowRowMetricCount: "{c} 题",
    aiFlowRowMetricRead: "已读 {p}%",
    aiFlowUnitItem: "篇",
    aiFlowUnitQ: "题",
    aiFlowUnitBatch: "批",
    aiFlowStopBatch: "停止整批转换",
    aiFlowStopSingle: "停止转换",
};
const t = (k: string): string => TEMPLATES[k] ?? k;

const CFG: ConvertRunCfg = {
    srcDocId: "doc-1",
    modelId: "m",
    fillToChoice: false,
    bigToSteps: false,
    parallel: 1,
    knowRoots: [],
};

/** 事件替身（转换编排侧回调；本用例只驱动状态机，全部空动作）。 */
const noop = (): void => undefined;
const EV = {
    t,
    setConverting: noop,
    onStatus: noop,
    onBatch: noop,
    onStopChoice: noop,
    onDone: noop,
    saveProgress: noop,
};

const keepMock = vi.mocked(keepConvertRun);
const discardMock = vi.mocked(discardConvertRun);

beforeEach(() => {
    resetAiFlow();
    detachConvertFlow();
    setActive(undefined);
    setAborted(undefined);
    keepMock.mockClear();
    discardMock.mockClear();
});

describe("转换流的流级横幅", () => {
    it("起跑：占槽即起流，进度摘要取既有文案（与页内条同源）+ 两行标题 + 富统计", () => {
        attachConvertFlow(t);
        expect(aiFlowSnapshot()).toBeUndefined(); // 空闲时无横幅
        setActive({
            cfg: CFG,
            ev: EV,
            abort: () => undefined,
            title: "卷名",
            progress: { phase: "generating", batch: 0, total: 0, count: 7, lastBatch: 2, readPct: 30 },
        });
        notifyState();
        const snap = aiFlowSnapshot();
        expect(snap).toMatchObject({
            id: CONVERT_FLOW_ID,
            title: "aiFlowTitleRunning",
            subtitle: "单篇 ·《卷名》",
            phase: "running",
        });
        // 文案走页内**同一条**函数与同一份模板（口径一致，不是两套数字）
        expect(snap?.progress).toContain("已读 30%");
        expect(snap?.progress).toContain("累计 7 题");
        // 富统计：数字单独拎出来给渲染侧强调（设计稿 fb-stats）；单位词后缀
        // 自带前导空格（照稿「累计 148 题」），而「/24 篇」是斜杠紧贴数字
        expect(snap?.stats?.fields).toEqual([
            { hint: "本篇已读", value: "30%" },
            { hint: "累计", value: "7", tail: " 题" },
        ]);
        // 单流态进度条（无队列维度时走 bar 而不是 seg）
        expect(snap?.bar).toMatchObject({ pct: 30 });
        expect(snap?.queue).toBeUndefined();
        expect(snap?.stop).toBeTypeOf("function"); // 停止句柄在场（横幅出钮）
    });

    it("批量队列：结构化队列维度（**六态含 queued**）+ 副标题 + 分篇行", () => {
        attachConvertFlow(t);
        setActive({
            cfg: {
                ...CFG,
                subDocs: [
                    { id: "a", title: "A" },
                    { id: "b", title: "B" },
                ],
                batchTitle: "队列",
            },
            ev: EV,
            abort: () => undefined,
            batchTitle: "队列",
            items: [
                { index: 0, total: 2, docId: "a", title: "A", status: "done", count: 3 },
                { index: 1, total: 2, docId: "b", title: "B", status: "running", count: 1 },
            ],
        });
        notifyState();
        const snap = aiFlowSnapshot();
        expect(snap?.progress).toContain("第 2/2 篇 · 队列"); // 队列总行（当前=进行中那篇）
        expect(snap?.subtitle).toBe("批量队列 ·《队列》");
        // 队列维度：通用形态（不含任何 convert 类型），六态计数**含 queued**
        expect(snap?.queue).toMatchObject({
            title: "队列",
            total: 2,
            current: 2,
            counts: { done: 1, skipped: 0, running: 1, failed: 0, cancelled: 0, queued: 0, stopped: 0 },
        });
        expect(snap?.queue?.items).toEqual([
            { index: 1, name: "A", state: "done", reason: undefined, note: "已写入题集", metric: "3 题" },
            {
                index: 2,
                name: "B",
                state: "running",
                reason: undefined,
                note: "", // 快照未带 progress ⇒ 备注/指标列只剩题数
                metric: "1 题",
            },
        ]);
        expect(snap?.bar).toBeUndefined(); // 有队列维度 ⇒ 不出单流条
        // 「累计 c 题」在队列屏 = **队列累计**（各篇之和 3+1=4），不是当前篇的
        // 1 题——设计稿队列屏写 148 = 9 篇完成 + 46 + 32 + …，直接拿快照
        // progress.count 会把「累计」写成一篇的量。
        expect(snap?.stats?.fields).toContainEqual({ hint: "累计", value: "4", tail: " 题" });
    });

    it("停止钮范围词随粒度（批量「停止整批转换」/ 单篇「停止转换」）", () => {
        attachConvertFlow(t);
        setActive({ cfg: CFG, ev: EV, abort: () => undefined });
        notifyState();
        expect(aiFlowSnapshot()?.stopKey).toBe("aiFlowStopSingle");
        // 换批量：起新流（先收口再重起），范围词跟着换成批量词
        setActive(undefined);
        notifyState();
        setActive({
            cfg: { ...CFG, subDocs: [{ id: "a", title: "A" }], batchTitle: "队列" },
            ev: EV,
            abort: () => undefined,
            batchTitle: "队列",
            items: [{ index: 0, total: 1, docId: "a", title: "A", status: "queued", count: 0 }],
        });
        notifyState();
        expect(aiFlowSnapshot()?.stopKey).toBe("aiFlowStopBatch");
    });

    it("停止态：构成条/计数/清单保持可见（待抉择不清结构化载荷）", () => {
        attachConvertFlow(t);
        setAborted({
            r: {
                status: "aborted",
                message: "",
                setId: "set-1",
                count: 5,
                batches: 2,
                total: 2,
                doneOffset: 10,
                writtenQids: ["q1"],
            },
            cfg: CFG,
            ev: EV,
            items: [
                {
                    index: 0,
                    total: 2,
                    docId: "a",
                    title: "A",
                    status: "stopped",
                    count: 5,
                    progress: { phase: "generating", batch: 1, total: 0, count: 5, lastBatch: 5, readPct: 42 },
                },
                { index: 1, total: 2, docId: "b", title: "B", status: "cancelled", count: 0 },
            ],
        });
        notifyState();
        const snap = aiFlowSnapshot();
        expect(snap).toMatchObject({ phase: "choice", stopped: true });
        expect(snap?.queue).toMatchObject({
            total: 2,
            current: 1,
            counts: { stopped: 1, cancelled: 1, queued: 0 },
        });
        expect(snap?.stats?.fields?.[0]).toEqual({ hint: "停在第", value: "1", tail: "/2 篇" });
        // ⚠️ 停止态快照**不带 progress**（aborted 槽只留 pending + items）——
        // 富统计必须从「被停的那篇」与 pending 取数，否则停止屏只剩首段
        //（设计稿的停止屏是四段：停在第 i/N 篇 · 本篇已读 % · 累计 c 题 ·
        // 已生成 b 批）。回归锁：这里逐段断言四段齐。
        expect(snap?.stats?.fields).toEqual([
            { hint: "停在第", value: "1", tail: "/2 篇" },
            { hint: "本篇已读", value: "42%" }, // 取被停那篇的 readPct
            { hint: "累计", value: "5", tail: " 题" }, // pending.count
            { hint: "已生成", value: "2", tail: " 批" }, // pending.batches
        ]);
    });

    it("待抉择：转 choice 态、停止钮撤下、保留/丢弃按钮接既有导出函数", () => {
        attachConvertFlow(t);
        setAborted({
            r: {
                status: "aborted",
                message: "",
                setId: "set-1",
                count: 5,
                batches: 2,
                total: 2,
                doneOffset: 10,
                writtenQids: ["q1"],
            },
            cfg: CFG,
            ev: EV,
        });
        notifyState();
        const snap = aiFlowSnapshot();
        expect(snap).toMatchObject({ phase: "choice", stop: undefined });
        expect(snap?.progress).toContain("已终止：5 题");
        snap?.choice?.keep();
        snap?.choice?.discard();
        expect(keepMock).toHaveBeenCalledTimes(1);
        expect(discardMock).toHaveBeenCalledTimes(1);
    });

    it("收口：快照消失即 end（横幅不残留，end 语义由状态机收敛保证）", () => {
        attachConvertFlow(t);
        setActive({ cfg: CFG, ev: EV, abort: () => undefined });
        notifyState();
        expect(aiFlowSnapshot()).toBeDefined();
        setActive(undefined);
        notifyState();
        expect(aiFlowSnapshot()).toBeUndefined();
    });

    it("不重叠：已在别的流上时转换横幅不起（注册表的单条约束照旧生效）", async () => {
        const { beginAiFlow } = await import("../../../ai/core/FlowRegistry");
        beginAiFlow({ id: "other", title: "匹配" });
        attachConvertFlow(t);
        setActive({ cfg: CFG, ev: EV, abort: () => undefined });
        notifyState();
        expect(aiFlowSnapshot()).toMatchObject({ id: "other", title: "匹配" });
    });
});
