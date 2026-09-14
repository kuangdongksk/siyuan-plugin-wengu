import { describe, expect, it, vi } from "vitest";
import type { BankData, QuestionBank } from "../../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../../bank/data/QuestionBank";
import { hashContent, planReimportBySegs, type SetSeg } from "../source/SetSegments";

/** 真 queue 链（runBatchQueue → refreshSetHash）需要的内核/AI 替身：源文档
 *  读回 DOC（与题集记着的哈希同源），AI 出口给合法的空结果（本用例只锁
 *  凭据校正，不锁产物）。 */
/** AI/内核替身读回的「当前源」：默认 = DOC（未变更场景），用例可改。 */
const src = { text: "" };
vi.mock("../../../siyuan/block", () => ({
    KernelBlock: { kramdown: vi.fn(async () => ({ code: 0, data: { kramdown: src.text } })) },
}));
vi.mock("../../../ai/client", () => ({
    newAiGroupId: () => "g-test",
    aiStopHandle: (signal: AbortSignal) => ({ signal, onSid: (): void => undefined }),
    agentChatOnce: vi.fn(async () => "CAN_CONVERT: no\nREASON: 空\n@@TO: END"),
}));

/**
 * 重导判定的**优先级**回归（Issue #74）：判定顺序里「有续跑记录 → 照旧
 * 断点续跑」**优先于**「源未变更 → 零动作短路」——记录在=上次没跑完，
 * 此时短路会让用户点「重新导入」后什么都没发生（题集永远补不齐）。
 *
 * 判定纯逻辑收口在 `planReimportBySegs`（只收「无记录」三段），**优先级 1
 * 在 DocOps 调用侧**：`reimportResume(rec)` 非空即直接续跑、根本不进段比对。
 * 本用例锁这条调用次序（DocOps 的真机链走内核，单测只锁次序契约）。
 */

// node 测试环境无 window，题库 markDirty/flush 的防抖定时器走 globalThis 顶上
(globalThis as { window?: unknown }).window ??= globalThis;

const DOC_ID = "20260914000000-abcdefg";
const DOC = ["# 第一章", "内容甲内容甲内容甲", "内容乙内容乙内容乙", "内容丙内容丙内容丙"].join("\n");
src.text = DOC;

function segTable(): SetSeg[] {
    // 模拟每批 flush：段首尾相接覆盖已落库游标
    const ends = [8, 17, 26];
    const out: SetSeg[] = [];
    let s = 0;
    for (const e of ends) {
        out.push({ s, e, h: hashContent(DOC.slice(s, e)) });
        s = e;
    }
    return out;
}

/* ── 真 queue 链替身（runBatchQueue 逐篇自查续跑；runSingleDoc 整体 mock
 * 掉 convertDocBatched，本用例只锁「起跑前的凭据校正」） ── */
const plan = new Map<string, (docId: string) => Promise<unknown>>();
vi.mock("../../run/ConvertBatch", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../run/ConvertBatch")>();
    return {
        ...orig,
        convertDocBatched: vi.fn(async (docId: string) => {
            const fn = plan.get(docId);
            if (fn) return fn(docId);
            return {
                status: "done",
                message: "",
                setId: `set-${docId}`,
                title: docId,
                count: 1,
                batches: 1,
                total: 1,
                doneOffset: 26,
                writtenQids: [],
            };
        }),
    };
});

import { convertRunActive, startConvertRun, type ConvertRunCfg, type ConvertRunEvents } from "../run/ConvertRun";
import type { ConvertProgressRecord } from "../run/ConvertBatch";

const done = (docId: string): unknown => ({
    status: "done",
    message: "",
    setId: `set-${docId}`,
    title: docId,
    count: 1,
    batches: 1,
    total: 1,
    doneOffset: 26,
    writtenQids: [],
});

const cfg: ConvertRunCfg = {
    srcDocId: DOC_ID,
    modelId: "m",
    fillToChoice: false,
    bigToSteps: false,
    parallel: 1,
    knowRoots: [],
};

/** 续跑记录（逐篇自查）。 */
const records = new Map<string, ConvertProgressRecord>();

function events(): { ev: ConvertRunEvents } {
    const ev: ConvertRunEvents = {
        t: (k) => k,
        // 真 Queue 只用到 all / peek / flush（本用例锁凭据校正）
        bank: bankRef as never,
        setConverting: () => undefined,
        onStatus: () => undefined,
        onBatch: () => undefined,
        onStopChoice: () => undefined,
        onDone: () => undefined,
        saveProgress: () => undefined,
        onBatchItem: () => undefined,
        getProgress: (id) => records.get(id),
    };
    return { ev };
}

/** 当前用例的题库（events 的 bank 透传）。 */
let bankRef: QuestionBank | undefined;

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
    bankRef = bank;
    return { bank, data: () => cache! };
}

/** DocOps 的判定入口替身：次序与 reimportDocFromInner 逐字同款（优先级 1
 *  在段比对**之前**提前返回）。DocOps 走内核 IO 无法直接单测，故把这条
 *  次序抽成可测的决策体——改 DocOps 时这里同步改，是刻意的口径锁。 */
function decide(
    rec: { offset: number; setId?: string } | undefined,
    src: string,
    set: { srcContentHash?: string; segs?: SetSeg[] }
): "resume" | "unchanged" | "partial" | "full" {
    // ① 续跑记录优先（reimportResume：记录带 setId 才有断点）
    if (rec?.setId) return "resume";
    // ② 无记录：整篇哈希命中 → 零动作；段表 → 逐段；皆无 → 整卷
    const plan = planReimportBySegs(src, set);
    return plan.kind;
}

describe("重导判定次序（续跑记录优先于未变更短路）", () => {
    const set = { srcContentHash: hashContent(DOC), segs: segTable() };

    it("① 有续跑记录 + 源一字未动 → 仍是续跑（不做零动作短路）", () => {
        expect(decide({ offset: 26, setId: "set-1" }, DOC, set)).toBe("resume");
    });

    it("① 有续跑记录 + 源已变更 → 也是续跑（记录在=上次没跑完）", () => {
        expect(decide({ offset: 26, setId: "set-1" }, DOC + "新尾巴", set)).toBe("resume");
    });

    it("① 记录无题集 id（旧形态）不算续跑 → 落回源级判定", () => {
        expect(decide({ offset: 26 }, DOC, set)).toBe("unchanged");
    });

    it("② 无记录 + 源未变更 → 零动作", () => {
        expect(decide(undefined, DOC, set)).toBe("unchanged");
    });

    it("③ 无记录 + 源已变更 → 从失配段起重转", () => {
        const changed = DOC.replace("内容乙", "内容改");
        expect(decide(undefined, changed, set)).toBe("partial");
    });

    it("④ 无记录 + 无 segs（存量）→ 现状整卷重转", () => {
        expect(decide(undefined, DOC, { srcContentHash: set.srcContentHash })).toBe("full");
        expect(decide(undefined, DOC, {})).toBe("full");
    });
});

describe("queue 续跑篇的源凭据校正（真 queue 链）", () => {
    it("续跑篇起跑前按当前源校正题集哈希：变了就清凭据、不再短路成「未变更」", async () => {
        const { bank } = newBank();
        const data = await bank.all();
        // 题集记着「转换时的源」的哈希 + 段表；文档随后被改（续跑路上）
        data.sets = {
            "set-1": {
                id: "set-1",
                title: "卷",
                srcId: DOC_ID,
                qids: [],
                createdAt: 0,
                srcContentHash: hashContent(DOC),
                segs: segTable(),
            },
        };
        records.set(DOC_ID, { setId: "set-1", title: "卷", offset: 26, batches: 1, total: 1, count: 2 });
        plan.set(DOC_ID, async (id) => done(id));
        src.text = DOC + "追加内容"; // 续跑路上用户改了源文档
        const { ev } = events();
        startConvertRun({ ...cfg, subDocs: [{ id: DOC_ID, title: "卷" }] }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        // 当前源（DOC + 追加）≠ 题集记的哈希 ⇒ 凭据被清（宁多烧不漏转）
        expect(data.sets["set-1"].srcContentHash).toBeUndefined();
        // 清了之后重导不会再被判成「未变更」——落回段比对（含文末追加）
        const cur = DOC + "追加内容";
        expect(planReimportBySegs(cur, data.sets["set-1"])).not.toEqual({ kind: "unchanged" });
        expect(planReimportBySegs(cur, data.sets["set-1"]).kind).toBe("partial");
    });

    it("源未改：凭据原样保留（下次重导仍能零动作短路）", async () => {
        src.text = DOC;
        const { bank } = newBank();
        const data = await bank.all();
        data.sets = {
            "set-1": {
                id: "set-1",
                title: "卷",
                srcId: DOC_ID,
                qids: [],
                createdAt: 0,
                srcContentHash: hashContent(DOC),
                segs: segTable(),
            },
        };
        records.set(DOC_ID, { setId: "set-1", title: "卷", offset: 26, batches: 1, total: 1, count: 2 });
        plan.set(DOC_ID, async (id) => done(id));
        const { ev } = events();
        startConvertRun({ ...cfg, subDocs: [{ id: DOC_ID, title: "卷" }] }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(src.text).toBe(DOC);
        expect(data.sets["set-1"].srcContentHash).toBe(hashContent(DOC));
        expect(planReimportBySegs(DOC, data.sets["set-1"])).toEqual({ kind: "unchanged" });
    });
});
