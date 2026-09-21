import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BankData, QuestionBank } from "../../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../../bank/data/QuestionBank";

/**
 * 转换质检的**端到端接线**（Issue #184 验收 1 与 3）：
 *  - 无 key / 总开关关 → 转换链**零变化**（不发任何判定请求、结果无 `qc` 键）；
 *  - 配了 key → 判定发生在**落库之前**，存疑项随结果 `qc` 与完成消息尾巴出来，
 *    而题库记录**一条不少**（只标不删的机械证明）。
 *
 * 与 `ConvertBatchCount.test.ts` 同款：内核 IO 全 mock、题库用内存实现；
 * Jev 判定走注入 transport（`siyuan/query` 的 forwardProxy 层被 mock 掉），
 * **不碰真网络**。
 */

(globalThis as { window?: unknown }).window ??= globalThis;

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
vi.mock("../../../ai/client", () => ({
    newAiGroupId: () => "g-test",
    aiStopHandle: (signal: AbortSignal) => ({ signal, onSid: (): void => undefined }),
    agentChatOnce: vi.fn(async () => REPLY_Q),
}));

const DOC = ["# 第一章 极限", "", "本节讲极限定义与等价无穷小。" + "正文-".repeat(120), ""].join("\n");
const REPLY_Q = `CAN_CONVERT: yes
REASON: 覆盖本章
@@Q type=single
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

/** 判定请求的证据（本文件唯一的「是否发请求」事实源）与可换的响应体。 */
const jev = { calls: 0, body: "", payloads: [] as string[] };

/** 判定传输注入：**替换真网络**——记录调用次数，并回给定的响应体。 */
vi.mock("../../../ai/jev/transport", async (importOriginal) => {
    const mod = (await importOriginal()) as Record<string, unknown>;
    return {
        ...mod,
        kernelProxyTransport: async (req: { payload: string }) => {
            jev.calls++;
            jev.payloads.push(req.payload);
            return { status: 200, body: jev.body };
        },
    };
});

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

/** 五项全部合格的响应体（按名对象，与 client 的线格式一致）。 */
const okBody = JSON.stringify({
    answers: {
        q0: { noul: 0.95 },
        q1: { noul: 0.9 },
        q2: { noul: 0.92 },
        q3: { noul: 0.88 },
        q4: { score: 5, confidence: 0.9 },
    },
});
/** 「可推出」明确踩雷（0.1）的响应体。 */
const badBody = JSON.stringify({
    answers: {
        q0: { noul: 0.95 },
        q1: { noul: 0.1 },
        q2: { noul: 0.92 },
        q3: { noul: 0.88 },
        q4: { score: 5, confidence: 0.9 },
    },
});

/** 转换的公共入参（各用例只差在设置与响应体）。 */
async function run(settings?: { jevKey?: string; jevEnabled?: boolean }) {
    const bank = newBank();
    const r = await convertDocBatched("20260910000000-abcdefg", {
        t: (k) => k,
        modelId: "m",
        fillToChoice: false,
        bigToSteps: false,
        parallel: 1,
        bank,
        onProgress: () => undefined,
        ...(settings ? { settingsOf: () => settings } : {}),
    });
    return { r, bank };
}

beforeEach(() => {
    jev.calls = 0;
    jev.body = okBody;
    jev.payloads = [];
});

describe("转换质检接线：无 key / 总开关关 = 零行为变化", () => {
    it("没配 key：结果无 `qc` 键、完成消息与改造前同形、题库照常落库", async () => {
        // 未接线设置 ⇒ 与改造前的调用方逐字一致
        const { r } = await run();
        expect(r.status).toBe("done");
        expect(r.count).toBeGreaterThan(0);
        expect("qc" in r).toBe(false); // 无存疑/未启用 ⇒ 载荷里没有这个键
        expect(r.message).not.toContain("jevQc");
        expect(jev.calls).toBe(0); // 一次判定请求都没发
    });

    it("配了 key 但总开关显式关：同样零请求、零留痕", async () => {
        const { r } = await run({ jevKey: "sk-test", jevEnabled: false });
        expect("qc" in r).toBe(false);
        expect(jev.calls).toBe(0);
    });

    it("判定失败（响应形状不对）：静默跳过，转换照常完成、题一条不少", async () => {
        jev.body = JSON.stringify({ answers: {} }); // 缺名 ⇒ 协议错 ⇒ 本模块接住
        const { r, bank } = await run({ jevKey: "sk-test" });
        expect(r.status).toBe("done");
        expect("qc" in r).toBe(false);
        const data = await bank.all();
        expect(Object.keys(data.records).length).toBe(r.count); // 题全在
    });
});

describe("转换质检接线：配了 key 的判定路径", () => {
    it("五问全过：发了一次请求（一次请求问完五项）、结果仍无 `qc` 键", async () => {
        const { r } = await run({ jevKey: "sk-test" });
        expect(r.status).toBe("done");
        expect(jev.calls).toBeGreaterThan(0);
        // 一批一次请求，且线上是「按名对象 + 五项」（不是逐题、不是数组）
        const sent = JSON.parse(jev.payloads[0]) as { questions: Record<string, unknown>; state: string };
        expect(Object.keys(sent.questions)).toEqual(["q0", "q1", "q2", "q3", "q4"]);
        expect(sent.state).toContain("第 1 题");
        expect("qc" in r).toBe(false); // 全过 ⇒ 不加噪（与未启用同形）
    });

    it("明确踩雷：随结果带 `qc`、完成消息带质检尾巴，而题**一条不少**（只标不删）", async () => {
        jev.body = badBody; // 「可推出」= 0.1
        const { r, bank } = await run({ jevKey: "sk-test" });
        expect(r.status).toBe("done");
        expect(r.qc?.suspects).toEqual([{ reason: "derive", clear: true, items: [] }]);
        expect(r.qc?.checked).toBeGreaterThan(0);
        expect(r.message).toContain("jevQcSuspect");
        expect(r.message).toContain("jevQcDerive");
        // 只标不删的机械证明：库内记录数 == 报告题数（没有任何回收动作）
        const data = await bank.all();
        expect(Object.keys(data.records).length).toBe(r.count);
        expect(r.count).toBeGreaterThan(0);
    });

    it("低置信（noul 0.5）：同样只标，且标成「拿不准」而非明确踩雷", async () => {
        jev.body = JSON.stringify({
            answers: {
                q0: { noul: 0.95 },
                q1: { noul: 0.5 },
                q2: { noul: 0.92 },
                q3: { noul: 0.88 },
                q4: { score: 5, confidence: 0.9 },
            },
        });
        const { r, bank } = await run({ jevKey: "sk-test" });
        expect(r.qc?.suspects).toEqual([{ reason: "derive", clear: false, items: [] }]);
        const data = await bank.all();
        expect(Object.keys(data.records).length).toBe(r.count);
    });

    it("判定先于落库：题集里的记录数是 `qc` 之外照旧（判定不改落库字节）", async () => {
        const { r, bank } = await run({ jevKey: "sk-test" });
        const data = await bank.all();
        const set = r.setId ? data.sets?.[r.setId] : undefined;
        expect(set?.qids.length).toBe(r.count);
        // 判定结果不落盘：题库里没有 QC 字段（形状与改造前一致）
        for (const qid of set?.qids ?? []) {
            const rec = data.records[qid];
            expect(Object.keys(rec)).not.toContain("jev");
            expect(rec.kramdown).not.toContain("jevQc");
        }
    });
});
