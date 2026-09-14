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
    aiFlowBatchCounts: "完成 {d} · 跳过 {k} · 中断 {s} · 失败 {f} · 取消 {c}",
    convertStopped: "已终止：{c} 题",
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
    it("起跑：占槽即起流，进度摘要取既有文案（与页内条同源）", () => {
        attachConvertFlow(t);
        expect(aiFlowSnapshot()).toBeUndefined(); // 空闲时无横幅
        setActive({
            cfg: CFG,
            ev: EV,
            abort: () => undefined,
            progress: { phase: "generating", batch: 0, total: 0, count: 7, lastBatch: 2, readPct: 30 },
        });
        notifyState();
        const snap = aiFlowSnapshot();
        expect(snap).toMatchObject({ id: CONVERT_FLOW_ID, title: "convertBtn", phase: "running" });
        // 文案走页内**同一条**函数与同一份模板（口径一致，不是两套数字）
        expect(snap?.progress).toContain("已读 30%");
        expect(snap?.progress).toContain("累计 7 题");
        expect(snap?.stop).toBeTypeOf("function"); // 停止句柄在场（横幅出钮）
    });

    it("批量队列：进度摘要带六态计数（完成/跳过/中断/失败/取消）", () => {
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
        expect(snap?.progress).toContain("完成 1 · 跳过 0 · 中断 0 · 失败 0 · 取消 0"); // 六态计数
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
