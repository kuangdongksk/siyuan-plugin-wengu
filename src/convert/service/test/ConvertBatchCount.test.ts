import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BankData, QuestionBank } from "../../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../../bank/data/QuestionBank";
import type { ConvertProgress } from "../run/ConvertBatch";

/**
 * 批数口径回归（Issue #7）：转换结果/进度记录的 `batches/total` 必须是
 * **实际 AI 调用批数**，不能把「已落库批数」再叠一遍——20260910 分片并行
 * 改造（f94efb9）曾把两种口径累进同一个变量，面板与终止提示的批数约为
 * 实际值两倍。这里跑通编排层（内核 IO 全部 mock，题库用内存实现），
 * 用 mock 自己记的调用次数当事实源锁死口径。
 */

// node 测试环境无 window，题库 markDirty/flush 的防抖定时器走 globalThis 顶上
(globalThis as { window?: unknown }).window ??= globalThis;

/** 源卷：标题链清晰，保证 planShards 能切出多片（并发度 2 → 目标 4 片）。 */
const DOC = Array.from({ length: 12 }, (_, i) =>
    [
        `# 第${i + 1}章 单元${i + 1}`,
        "",
        `本章共 ${60} 个知识点。` + `题干文字${i}-`.repeat(90),
        "",
        `## ${i + 1}.1 小节`,
        "",
        `小节正文${i}-`.repeat(90),
        "",
    ].join("\n")
).join("\n");

vi.mock("../../../siyuan/query", () => ({
    KernelQuery: {
        rows: vi.fn(async () => [{ id: "20260910000000-abcdefg", box: "nb", content: "测试卷" }] as unknown[]),
        rowsAll: vi.fn(async (): Promise<unknown[]> => []),
    },
}));
vi.mock("../../../siyuan/doc", () => ({
    KernelDoc: { hPath: vi.fn(async () => ({ code: 0, data: "/讲义/测试卷" })) },
}));
vi.mock("../../../siyuan/block", () => ({
    KernelBlock: { kramdown: vi.fn(async () => ({ code: 0, data: { kramdown: DOC } })) },
}));

/** 每次 AI 调用：默认回一道可解析的单选 + @@TO: END（整窗处理完）；每第
 *  3 次回「零产物批」（无 @@Q）——该类批**计数但落库零批**，正是两种口径
 *  的分水岭。mock 自身记下真实调用次数与产物批数，供断言当事实源。 */
const ai = { calls: 0, zeroCalls: 0, products: 0 };
const REPLY_Q = `CAN_CONVERT: yes
REASON: 覆盖本章
@@Q type=single knowledge=极限 chapter=第一章
@@P stem
求 $\\lim_{x \\to 0}\\frac{\\sin x}{x}$。
@@P opt
$1$
@@P opt
$0$
@@P ans
A
@@P sol
等价无穷小。
@@END
@@TO: END`;
vi.mock("../../../ai/client", () => ({
    newAiGroupId: () => "g-test",
    // 面板「停止」接线（Issue #72）：本用例只锁批数口径，句柄给个恒等实现
    aiStopHandle: (signal: AbortSignal, stop: () => void) => ({
        signal,
        onSid: (): void => void stop,
    }),
    agentChatOnce: vi.fn(async () => {
        ai.calls++;
        if (ai.calls % 3 === 0) {
            ai.zeroCalls++;
            return "CAN_CONVERT: yes\nREASON: 本批无可出题内容\n@@TO: END";
        }
        ai.products++;
        return REPLY_Q;
    }),
}));

import { convertDocBatched } from "../run/ConvertBatch";

function newBank(): QuestionBank {
    let cache: BankData | undefined;
    return new Bank(
        async () =>
            (cache ??= {
                version: 1,
                records: {},
                collections: [],
                migratedDocs: [],
                hashed: {},
                knowRoots: [],
                folders: [],
                knowHidden: [],
                docStats: {},
                sets: {},
                materials: {},
            } as BankData),
        async (v) => {
            cache = v;
        }
    );
}

beforeEach(() => {
    ai.calls = 0;
    ai.zeroCalls = 0;
    ai.products = 0;
});

describe("转换批数口径（并行编排）", () => {
    it("结果 batches/total = 实际 AI 调用批数，与已落库批数分开计数", async () => {
        const bank = newBank();
        const progress: ConvertProgress[] = [];
        const r = await convertDocBatched("20260910000000-abcdefg", {
            t: (k) => k,
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 2,
            bank,
            onProgress: (p) => progress.push(p),
        });

        expect(r.status).toBe("done");
        // 编排确实跑了多片多批（否则这条回归测不到并行下的累计）
        expect(ai.calls).toBeGreaterThan(3);
        expect(ai.zeroCalls).toBeGreaterThan(0); // 口径分水岭：计数但零产物
        expect(ai.products).toBeLessThan(ai.calls); // 两口径确实不相等
        // 口径 B：结果批数 = 实际 AI 调用批数（含零产物批）——修复前这里约两倍
        expect(r.batches).toBe(ai.calls);
        expect(r.total).toBe(ai.calls);
        // 口径 A：进度回调 batch 恒为「已落库批数」（不含零产物批，恒 ≤ 调用批数）
        expect(progress.length).toBeGreaterThan(0);
        for (const p of progress) expect(p.batch).toBeLessThanOrEqual(ai.products);
        expect(Math.max(...progress.map((p) => p.batch))).toBe(ai.products);
    });

    it("进度记录的 batches/total 同样是 AI 调用批数（终止后可续跑口径）", async () => {
        const bank = newBank();
        const progress: ConvertProgress[] = [];
        const ctl = new AbortController();
        const r = await convertDocBatched("20260910000000-abcdefg", {
            t: (k) => k,
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 1,
            signal: ctl.signal,
            bank,
            onProgress: (p) => {
                progress.push(p);
                if (p.batch >= 1) ctl.abort(); // 首批落库即终止：走保留记录路径
            },
        });

        expect(r.status).toBe("aborted");
        expect(r.batches).toBe(ai.calls);
        expect(r.total).toBe(ai.calls);
        // 终止那一刻已落库批数是 1（首批），仍小于 AI 调用批数
        expect(Math.max(...progress.map((p) => p.batch))).toBe(ai.products);
    });
});
