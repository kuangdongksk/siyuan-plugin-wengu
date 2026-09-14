import { describe, expect, it, vi } from "vitest";
import type { BankData, BankRecord, QuestionBank } from "../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../bank/data/QuestionBank";
import { renderUnit } from "../../convert/service/draft/QuestionDraft";
import { AnnoScopeCtl, type AnnoScopeHost } from "./AnnoScopeCtl";

// node 测试环境无 window（vitest 不启 jsdom），markDirty 的防抖定时器走
// window.setTimeout——globalThis 顶上（同 BankSets.test）
(globalThis as { window?: unknown }).window ??= globalThis;

/**
 * 标生词闸的取用层（Issue #83 两级口径 / #84 复审补齐）：判定走
 * `isEnglishScope(peekSetSubject(...), peekSetTypeUnion(...))`，反查链 =
 * 选段锚点 → 卡 qid → 题 rootId → 题集。
 *
 * ⚠️ 本文件锁的是**异步补正腿**（题库整体未装载的时序死角）：学科必须在
 * `setTypeUnion`（内部 `await bank.all()`）**之后**再窥视——提前取恒
 * undefined，带学科的纯阅读英语卷（题集全 single、无英语形态）会被落成
 * 「无学科 ⇒ 回退题型并集 ⇒ 非英语」，缓存一直错到下次换卷/切模式。
 */

vi.mock("../../siyuan/query", () => ({
    KernelQuery: { rows: vi.fn(), rowsAll: vi.fn(), rowsMap: vi.fn(), rowsMapAll: vi.fn() },
}));

const rec = (qid: string, setId: string): BankRecord => ({
    qid,
    kramdown: renderUnit({ material: false, attrs: { type: "single" }, parts: [] }),
    type: "single",
    kpRefs: [],
    sourceDocId: setId,
    hash: `h-${qid}`,
    stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
});

/** 假题库：`load()` 延迟到显式放行——`peek()` 在此之前恒空，复刻
 *  「题表先到、题库后装载」的真机时序。 */
function deferredBank(seed: Partial<BankData>): { bank: QuestionBank; load: () => void; ready: Promise<unknown> } {
    const data = {
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
        ...seed,
    } as BankData;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const bank = new Bank(
        async () => {
            await gate;
            return data;
        },
        async () => undefined
    );
    const ready = bank.all();
    return { bank, load: release, ready };
}

/** 选段锚点替身：`.wengu-card` 命中 q1、`.wengu-gunit` 不命中（普通题卡）。 */
const anchor = (qid: string): HTMLElement =>
    ({
        closest: (sel: string) => (sel === ".wengu-card" ? { dataset: { qid } } : null),
    }) as unknown as HTMLElement;

const hostOf = (bank: QuestionBank, setId: string): AnnoScopeHost => ({
    questions: () => [{ id: "q1", attempts: 0, wrongCount: 0, rootId: setId }],
    bankStore: () => bank,
});

/** 纯阅读英语卷：题集只有 single 题，学科=英语（形态代理判不出的主力场景）。 */
const englishSetSeed = (): Partial<BankData> => ({
    records: { q1: rec("q1", "set-a") },
    sets: { "set-a": { id: "set-a", title: "阅读", subject: "英语", qids: ["q1"], createdAt: 0 } },
});

/** 让在途微任务链全部落地（补正腿的 await/then 可能跨多个 microtask）。 */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe("AnnoScopeCtl 标生词闸取用（Issue #83）", () => {
    it("题库已装载：有学科以学科为准（全 single 的纯阅读英语卷也判英语）", async () => {
        const { bank, load, ready } = deferredBank(englishSetSeed());
        load();
        await ready; // peek 就绪
        const ctl = new AnnoScopeCtl(hostOf(bank, "set-a"));
        expect(ctl.englishAt(anchor("q1"))).toBe(true);
    });

    it("无学科存量：回退题型并集（全 single 判否，逐字节不回归）", async () => {
        const { bank, load, ready } = deferredBank({
            records: { q1: rec("q1", "set-a") },
            sets: { "set-a": { id: "set-a", title: "练习", qids: ["q1"], createdAt: 0 } },
        });
        load();
        await ready;
        expect(new AnnoScopeCtl(hostOf(bank, "set-a")).englishAt(anchor("q1"))).toBe(false);
    });

    it("题库未装载：当场按否收口（本次不放行），装载后补正判真（#84 复审回归锁）", async () => {
        const { bank, load, ready } = deferredBank(englishSetSeed());
        const ctl = new AnnoScopeCtl(hostOf(bank, "set-a"));
        expect(ctl.englishAt(anchor("q1"))).toBe(false); // peek 空：宁缺勿错
        load();
        await ready;
        await settle(); // 补正腿的 .then 落地
        // 补正把「有学科」带进来 ⇒ 缓存里是真判定（若在 await 前取学科，
        // 这里是「无学科 ⇒ 回退题型并集 ⇒ false」，英语卷整体不出标生词）
        expect(ctl.englishAt(anchor("q1"))).toBe(true);
    });

    it("换卷/切模式（invalidate）后旧世代补正结果被丢弃", async () => {
        const { bank, load, ready } = deferredBank(englishSetSeed());
        const ctl = new AnnoScopeCtl(hostOf(bank, "set-a"));
        ctl.englishAt(anchor("q1")); // 未装载：起一次补正
        ctl.invalidate(); // 旧世代作废
        load();
        await ready;
        await settle();
        // 补正回来对不上代数 ⇒ 不写回；新世代重新窥视（此时题库已装载）⇒ 判真
        expect(ctl.englishAt(anchor("q1"))).toBe(true);
    });
});
