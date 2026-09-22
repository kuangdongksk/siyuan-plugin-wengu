import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BankData, QuestionBank } from "../../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../../bank/data/QuestionBank";
import { advanceSegs, hashContent, planReimportBySegs, resumeCursorOf } from "../source/SetSegments";

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

/**
 * 续跑接管与段表对账（Issue #208 验收 2）：记录里的断点偏移可能**落后**
 * 于段表末段 e（旧检查点/异常残留），起跑游标须取二者较大者，免得从旧游标
 * 重转造成重复落库。判据纯函数 `resumeCursorOf`，真链路由下面的端到端用例兜。
 */
describe("ConvertBatch · 续跑游标对账（Issue #208）", () => {
    const segTable = (ends: number[]): { srcContentHash?: string; segs?: { s: number; e: number; h: string }[] } => ({
        srcContentHash: hashContent(DOC),
        segs: ends.map((e, i) => ({
            s: i === 0 ? 0 : ends[i - 1],
            e,
            h: hashContent(DOC.slice(i === 0 ? 0 : ends[i - 1], e)),
        })),
    });

    it("源未变 + 段表非空：取段表末段 e（权威游标），不是记录偏移", () => {
        const set = segTable([1000, 5000]);
        expect(resumeCursorOf(set, DOC)).toBe(5000);
        // 记录偏移落后（旧检查点）时以段表为准；调用方 Math.max 兜底取大
        expect(Math.max(0, 1200, resumeCursorOf(set, DOC))).toBe(5000);
        // 记录偏移超前（越界残值）时也不被段表拉回
        expect(Math.max(0, 9000, resumeCursorOf(set, DOC))).toBe(9000);
    });

    it("源已变（哈希失配）→ 返回 0（不在此处猜，交给 refreshSetHash/段比对）", () => {
        const set = segTable([1000, 5000]);
        set.srcContentHash = hashContent(DOC + "改了");
        expect(resumeCursorOf(set, DOC)).toBe(0);
        expect(Math.max(0, 1200, resumeCursorOf(set, DOC))).toBe(1200); // 游标仍取记录值
    });

    it("无哈希字段 / 无段表 / 无题集：一律 0（零副作用，现状行为）", () => {
        const set = segTable([1000]);
        delete set.srcContentHash;
        expect(resumeCursorOf(set, DOC)).toBe(0);
        expect(resumeCursorOf({ srcContentHash: hashContent(DOC) }, DOC)).toBe(0);
        expect(resumeCursorOf({ srcContentHash: hashContent(DOC), segs: [] }, DOC)).toBe(0);
        expect(resumeCursorOf(undefined, DOC)).toBe(0);
    });

    it("真链路：续跑从段表末段接管（题集 seeded 段表 + 记录偏移落后）", async () => {
        const { bank, data } = newBank();
        // 先跑一遍拿到「真实段表 + 题集」（每批 flush 后追加，非收口才写）
        const first = await convertDocBatched("20260914000000-abcdefg", {
            t: (k) => k,
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 2,
            bank,
            onProgress: () => undefined,
        });
        const setId = first.setId!;
        const set = data().sets![setId];
        const segs = set.segs ?? [];
        expect(segs.length).toBeGreaterThan(1);
        const tail = segs[segs.length - 1].e;
        const before = Object.keys(data().records).length;
        const r = await convertDocBatched("20260914000000-abcdefg", {
            t: (k) => k,
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 2,
            resume: { offset: 0, setId }, // 落后偏移：旧检查点残留
            bank,
            onProgress: () => undefined,
        });
        // 已落库的时段不再重转：旧记录一条不增（重复落库的形态就是这里变多）
        expect(r.setId).toBe(setId);
        expect(Object.keys(data().records).length).toBe(before);
        // 段表也没被回退（末段仍 ≥ 接管时看到的权威游标）
        const after = data().sets![setId].segs ?? [];
        expect(after[after.length - 1].e).toBeGreaterThanOrEqual(tail);
    });
});
