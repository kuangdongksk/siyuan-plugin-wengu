import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BankData, QuestionBank } from "../../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../../bank/data/QuestionBank";
import { advanceSegs, hashContent, planReimportBySegs } from "../source/SetSegments";

/**
 * 题集源级哈希 + 分段边界表**写入点**回归（Issue #74）：ConvertBatch 每批
 * flush 后必须往题集追加一段 `{s, e, h}`（段首尾相接、连续覆盖
 * [0, flushedCursor]，e=实际落库游标）并写整篇哈希——重导的「未变更」
 * 短路与「第 k 段起重转」全靠这两个字段，少了任何一处都退回整卷重烧。
 *
 * 内核 IO/AI 全 mock，题库内存实现（同 ConvertBatchCount 口径）；另有一条
 * 纯逻辑用例锁「续跑接续追加」。
 */

// node 测试环境无 window，题库 markDirty/flush 的防抖定时器走 globalThis 顶上
(globalThis as { window?: unknown }).window ??= globalThis;

/** 源卷：多标题链 + 长正文，保证 planShards 切出多片、每片跑多批。 */
const DOC = Array.from({ length: 12 }, (_v, i) =>
    [
        "# 第" + (i + 1) + "章 单元" + (i + 1),
        "",
        "题干文字" + i + "内容".repeat(300),
        "",
        "## " + (i + 1) + ".1 小节",
        "",
        "小节正文" + i + "正文".repeat(300),
        "",
    ].join("\n")
).join("\n");

vi.mock("../../../siyuan/query", () => ({
    KernelQuery: {
        rows: vi.fn(async () => [{ id: "20260914000000-abcdefg", box: "nb", content: "测试卷" }] as unknown[]),
        rowsAll: vi.fn(async (): Promise<unknown[]> => []),
    },
}));
vi.mock("../../../siyuan/doc", () => ({
    KernelDoc: { hPath: vi.fn(async () => ({ code: 0, data: "/讲义/测试卷" })) },
}));
vi.mock("../../../siyuan/block", () => ({
    KernelBlock: {
        // 续跑带的源（与 DOC 不同的一段，供「以续跑时的源为准覆写」用例）
        kramdown: vi.fn(async () => ({ code: 0, data: { kramdown: DOC } })),
    },
}));

const REPLY_Q = [
    "CAN_CONVERT: yes",
    "REASON: 覆盖本章",
    "@@Q type=single knowledge=极限 chapter=第一章",
    "@@P stem",
    "求 $\\lim_{x \\to 0}\\frac{\\sin x}{x}$。",
    "@@P opt",
    "$1$",
    "@@P opt",
    "$0$",
    "@@P ans",
    "A",
    "@@P sol",
    "等价无穷小。",
    "@@END",
    "@@TO: END",
].join("\n");

const ai = { calls: 0 };
vi.mock("../../../ai/client", () => ({
    newAiGroupId: () => "g-test",
    aiStopHandle: (signal: AbortSignal) => ({ signal, onSid: (): void => undefined }),
    agentChatOnce: vi.fn(async (): Promise<string> => {
        ai.calls++;
        return REPLY_Q;
    }),
}));

import { convertDocBatched } from "../run/ConvertBatch";

function newBank(): { bank: QuestionBank; data: () => BankData } {
    let cache: BankData | undefined;
    const bank = new Bank(
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
    return { bank, data: () => cache! };
}

beforeEach(() => {
    ai.calls = 0;
});

describe("ConvertBatch · segs 追加", () => {
    it("每批 flush 后追加一段：首尾相接、无空洞无重叠、e ≤ 已落库游标", async () => {
        const { bank, data } = newBank();
        const r = await convertDocBatched("20260914000000-abcdefg", {
            t: (k) => k,
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 2,
            bank,
            onProgress: () => undefined,
        });
        expect(r.status).toBe("done");
        const set = data().sets?.[r.setId!];
        expect(set).toBeDefined();
        const segs = set!.segs ?? [];
        expect(segs.length).toBeGreaterThan(1); // 确实多批（否则锁不到追加链）
        expect(segs[0].s).toBe(0);
        for (let i = 1; i < segs.length; i++) expect(segs[i].s).toBe(segs[i - 1].e);
        for (const seg of segs) {
            expect(seg.e).toBeGreaterThan(seg.s);
            expect(seg.h).toBe(hashContent(DOC.slice(seg.s, seg.e)));
        }
        expect(segs[segs.length - 1].e).toBeLessThanOrEqual(DOC.length);
    });

    it("整篇哈希每次 flush 都写（= 当前源文本的哈希）", async () => {
        const { bank, data } = newBank();
        const r = await convertDocBatched("20260914000000-abcdefg", {
            t: (k) => k,
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 1,
            bank,
            onProgress: () => undefined,
        });
        expect(data().sets?.[r.setId!]?.srcContentHash).toBe(hashContent(DOC));
    });

    it("写入侧与比对侧同一偏移口径：第 2 段起变更必定位到第 2 段", async () => {
        const { bank, data } = newBank();
        const r = await convertDocBatched("20260914000000-abcdefg", {
            t: (k) => k,
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 2,
            bank,
            onProgress: () => undefined,
        });
        const set = data().sets?.[r.setId!];
        const segs = set?.segs ?? [];
        // 首段起于 0、末段终于「已落库游标」，中间首尾相接（写入侧口径）
        expect(segs[0].s).toBe(0);
        for (let i = 1; i < segs.length; i++) expect(segs[i].s).toBe(segs[i - 1].e);
        const last = segs[segs.length - 1];
        // 改**末段**中部的几个字（长度不变，专测段内内容变更）——与「哪批
        // 切在哪」无关，故断言语义不受片数/窗长影响
        const mid = Math.floor((last.s + last.e) / 2);
        const changed = DOC.slice(0, mid) + "改改改" + DOC.slice(mid + 3);
        const plan = planReimportBySegs(changed, { srcContentHash: set!.srcContentHash, segs });
        // 之前各段逐字未动 ⇒ 失配必落在末段、重转起点 = 末段起点
        expect(plan).toEqual({
            kind: "partial",
            from: last.s,
            deleteFrom: last.s,
            keptSegs: segs.length - 1,
        });
        // 未变更的源走「零动作」短路（同一条哈希函数，闭环）
        expect(planReimportBySegs(DOC, { srcContentHash: set!.srcContentHash, segs })).toEqual({
            kind: "unchanged",
        });
    });

    it("源一字未动 + 文末追加：全段命中，从已落库游标续转（一段不删）", async () => {
        const { bank, data } = newBank();
        const r = await convertDocBatched("20260914000000-abcdefg", {
            t: (k) => k,
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 2,
            bank,
            onProgress: () => undefined,
        });
        const set = data().sets?.[r.setId!];
        const segs = set?.segs ?? [];
        const tail = segs[segs.length - 1].e;
        const appended = DOC + "\n# 新增章 单元13\n\n新加的一段正文。\n";
        expect(planReimportBySegs(appended, { srcContentHash: set!.srcContentHash, segs })).toEqual({
            kind: "partial",
            from: tail,
            deleteFrom: tail,
            keptSegs: segs.length,
        });
    });

    it("续跑接续追加：既有段表原样保留、新段自末段 e 起（纯逻辑同源）", () => {
        const first = advanceSegs(undefined, 0, 100, DOC);
        const again = advanceSegs(first, 100, 200, DOC);
        expect(again.slice(0, 1)).toEqual(first);
        expect(again[1]).toEqual({ s: 100, e: 200, h: hashContent(DOC.slice(100, 200)) });
    });
});
