import { describe, expect, it, vi } from "vitest";
import type { BankData, QuestionBank } from "../../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../../bank/data/QuestionBank";
import { hashContent, planReimportBySegs, type SetSeg } from "../source/SetSegments";
import { read } from "../../../testkit/readSource";

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

function segTable(ends: number[] = [8, 17, DOC.length]): SetSeg[] {
    // 模拟每批 flush：段首尾相接覆盖已落库游标。
    // ⚠️ 末段须贴到源末才构成「整篇已转完」（Issue #208 起 unchanged 的
    // 必要条件）——本用例的「未变更零动作」场景都建在覆盖全文的段表上
    const out: SetSeg[] = [];
    let s = 0;
    for (const e of ends) {
        out.push({ s, e, h: hashContent(DOC.slice(s, e)) });
        s = e;
    }
    return out;
}

/** 「转了一半」的段表（只覆盖前缀）：Issue #208 的病灶形态。 */
const halfTable = (): SetSeg[] => segTable([8, 17]);

/* ── 真 queue 链替身（runBatchQueue 逐篇自查续跑；runSingleDoc 整体 mock
 * 掉 convertDocBatched，本用例只锁「起跑前的凭据校正」） ── */
const plan = new Map<string, (docId: string) => Promise<unknown>>();
vi.mock("../run/ConvertBatch", async (importOriginal) => {
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
import { convertDocBatched, type ConvertProgressRecord } from "../run/ConvertBatch";

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

    it("②' 无记录 + 整篇哈希命中但段表只覆盖前缀（半成品）→ partial 续转，不短路（Issue #208）", () => {
        // 真机病灶：长文档转 6 批后失败，重导报「源未变更，题集已是最新」
        const half = { srcContentHash: hashContent(DOC), segs: halfTable() };
        expect(decide(undefined, DOC, half)).toBe("partial");
        expect(planReimportBySegs(DOC, half)).toEqual({
            kind: "partial",
            from: 17,
            deleteFrom: 17,
            keptSegs: 2,
        });
    });

    it("④ 无记录 + 无 segs（存量）→ 现状整卷重转", () => {
        expect(decide(undefined, DOC, { srcContentHash: set.srcContentHash })).toBe("full");
        expect(decide(undefined, DOC, {})).toBe("full");
    });
});

describe("重导续跑不清断点（Issue #208 验收 4：startReimport 的清理只在非续跑路）", () => {
    it("可选项口径（未做）：aborted 抉择态**不写记录**——记录会与「丢弃」抢跑道", async () => {
        const src = await read("/src/convert/service/run/ConvertRun.ts");
        const fn = src.slice(src.indexOf("function settleAborted("));
        const body = fn.slice(0, fn.indexOf("\n}"));
        // 抉择态只置 setAborted + 弹二选一，进度记录留到 keep/discard 落定才写
        expect(body).toContain("setAborted(");
        expect(body).not.toContain("saveProgress");
    });

    /** DocOps 的 startReimport 走内核 IO（bank/历史/视图重载）无法直测，故此处
     *  以**源级形态**锁它的清理分支：进度记录的删除必须在 `!resume` 块**内**。
     *  改 DocOps 时这里同步改，是刻意的口径锁（同本文件上方 decide 的做法）。 */
    it("saveConvertProgress(…, undefined) 落在 !resume 块内：续跑起跑不先毁断点", async () => {
        const src = await read("/src/quiz/service/DocOps.ts");
        const fn = src.slice(src.indexOf("async function startReimport("));
        const block = fn.slice(0, fn.indexOf("await v.reloadView()"));
        const clear = block.indexOf("saveConvertProgress(srcId, undefined)");
        const guard = block.indexOf("if (!resume) {");
        expect(clear).toBeGreaterThan(-1);
        // 清理必须被 !resume 块**包住**：清点位于 guard 之后、且两行间距仍在块内
        expect(guard).toBeGreaterThan(-1);
        expect(clear).toBeGreaterThan(guard);
        const between = block.slice(guard, clear);
        expect(between).toContain("removeDocData(setId)"); // 同块内的清旧题集侧数据
        expect(between.split("}").length - 1).toBe(0); // 清点之前块还没闭合
    });
});

describe("队列续跑篇的段表对账（Issue #208 验收 2 · 防丢数据面）", () => {
    it("记录偏移落后于段表末段：续跑篇起跑不重转已落库时段，旧题一条不丢", async () => {
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
                segs: segTable([8, DOC.length]),
            },
        };
        // 记录偏移落后（旧检查点残留）：段表说已到源末，记录说才到 8
        records.set(DOC_ID, { setId: "set-1", title: "卷", offset: 8, batches: 1, total: 1, count: 2 });
        const got: { offset?: number }[] = [];
        plan.set(DOC_ID, async (id) => done(id));
        const { ev } = events();
        // 真 runBatchQueue → 真 runSingleDoc → mock 的 convertDocBatched：
        // 从它的实参侧观测「队列透传的游标」（对账发生在批次层 resumeCursorOf）
        const batched = vi.mocked(convertDocBatched);
        startConvertRun({ ...cfg, subDocs: [{ id: DOC_ID, title: "卷" }] }, ev);
        await vi.waitFor(() => expect(convertRunActive()).toBe(false));
        expect(batched.mock.calls.length).toBe(1);
        for (const [, opts] of batched.mock.calls) if (opts.resume) got.push({ offset: opts.resume.offset });
        // 队列把记录原值原样透传（对账发生在批次层 `resumeCursorOf`）——
        // 上游这一段的契约在此锁死：**落后偏移必须落到 convertDocBatched 手里**
        expect(got).toEqual([{ offset: 8 }]);
        // 源未改 ⇒ 凭据（哈希 + 段表）原样保留（对账可用），旧题记录不受影响
        expect(data.sets["set-1"].srcContentHash).toBe(hashContent(DOC));
        expect(data.sets["set-1"].segs?.length).toBe(2);
    });
});

describe("防丢数据行为锁（Issue #208 病灶链的代码形状）", () => {
    it("applySubmit 每批落库就写整篇哈希 —— 正是「半成品带全篇凭据」的来源", async () => {
        const src = await read("/src/convert/service/run/ConvertBatch.ts");
        expect(src).toContain("segSet.srcContentHash = hashContent(kramdown)");
        // 断了这条链的下游：unchanged 短路必须再要一个「段表覆盖全文」
        const seg = await read("/src/convert/service/source/SetSegments.ts");
        expect(seg).toContain("segs[segs.length - 1].e >= src.length");
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
