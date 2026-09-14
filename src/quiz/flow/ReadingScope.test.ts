import { describe, expect, it } from "vitest";
import { QuestionType, type WenguQuestion } from "../../types";
import type { BankData, BankRecord, QuestionBank } from "../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../bank/data/QuestionBank";
import { renderUnit } from "../../convert/service/draft/QuestionDraft";
import { readingScopeOf } from "./ReadingScope";

// node 测试环境无 window（vitest 不启 jsdom）；QuestionBank 的落盘防抖用
// window.setTimeout（同 BankSets.test）
(globalThis as { window?: unknown }).window ??= globalThis;

/**
 * 阅读面作用域判定（Issue #81）：`.wengu-reading` 只挂英语卷——
 * 卷级题型并集含英语四类（cloze/match/essay/trans）任一。
 */

const q = (id: string, extra: Partial<WenguQuestion> = {}): WenguQuestion => ({
    id,
    attempts: 0,
    wrongCount: 0,
    ...extra,
});

const rec = (qid: string, setId: string, type: string): BankRecord => ({
    qid,
    // renderUnit 只做 kramdown 契约渲染；type 属性决定 records[].type
    kramdown: renderUnit({ material: false, attrs: { type }, parts: [] }),
    type,
    kpRefs: [],
    sourceDocId: setId,
    hash: `h-${qid}`,
    stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
});

function newBank(seed: Partial<BankData> = {}): QuestionBank {
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
                ...seed,
            } as BankData),
        async (v) => {
            cache = v;
        }
    );
}

/** 英语卷（cloze + single 混排）与数学卷（single + fill）。 */
const englishBank = () =>
    newBank({
        records: {
            e1: rec("e1", "set-en", "cloze"),
            e2: rec("e2", "set-en", "single"),
            m1: rec("m1", "set-math", "single"),
            m2: rec("m2", "set-math", "fill"),
        },
        sets: {
            "set-en": { id: "set-en", title: "英一阅读", qids: ["e1", "e2"], createdAt: 0 },
            "set-math": { id: "set-math", title: "高数", qids: ["m1", "m2"], createdAt: 0 },
        },
    });

describe("readingScopeOf 卷级英语判定（Decision matrix）", () => {
    it("英语卷（题型并集含英语四类任一）⇒ 挂 .wengu-reading", async () => {
        const bank = englishBank();
        await bank.preload();
        expect(readingScopeOf([q("e2", { rootId: "set-en" })], bank)).toBe(true);
    });

    it("数学卷（并集全非英语）⇒ 不挂（逐字节不变）", async () => {
        const bank = englishBank();
        await bank.preload();
        expect(readingScopeOf([q("m1", { rootId: "set-math" })], bank)).toBe(false);
    });

    it("英语阅读的 single 题靠同卷英语题型认出来（题级判不开）", async () => {
        const bank = englishBank();
        await bank.preload();
        // 同 id 的题：挂英语卷 ⇒ true；挂数学卷 ⇒ false——判的是卷不是题
        expect(readingScopeOf([q("x", { rootId: "set-en" })], bank)).toBe(true);
        expect(readingScopeOf([q("x", { rootId: "set-math" })], bank)).toBe(false);
    });

    it("取卷内首题的 rootId（整卷一次判定的口径）", async () => {
        const bank = englishBank();
        await bank.preload();
        // 先后混排时按首题所在卷（壳层整卷一处作用域，组单元各判各段）
        expect(readingScopeOf([q("e2", { rootId: "set-en" }), q("m1", { rootId: "set-math" })], bank)).toBe(true);
        expect(readingScopeOf([q("m1", { rootId: "set-math" }), q("e2", { rootId: "set-en" })], bank)).toBe(false);
    });

    it("空并集/题集不存在 ⇒ 否（反查不出证据宁窄勿宽）", async () => {
        const bank = englishBank();
        await bank.preload();
        expect(readingScopeOf([q("x", { rootId: "set-nope" })], bank)).toBe(false);
        expect(readingScopeOf([q("x", { rootId: "" })], bank)).toBe(false);
        expect(readingScopeOf([q("x")], bank)).toBe(false);
    });

    it("空列表 ⇒ 否", () => {
        expect(readingScopeOf([], englishBank())).toBe(false);
    });

    it("题库未装载（peek 空）⇒ 否（同步窥视，不 await 查库）", () => {
        const bank = englishBank(); // 未 preload
        expect(bank.peek()).toBeUndefined();
        expect(readingScopeOf([q("e2", { rootId: "set-en" })], bank)).toBe(false);
    });

    it("无题库 ⇒ 否（测试/预览壳）", () => {
        expect(readingScopeOf([q("e2", { rootId: "set-en" })])).toBe(false);
        expect(readingScopeOf([q("e2", { rootId: "set-en" })], undefined)).toBe(false);
    });

    it("四类英语题型任一都认（cloze/match/essay/trans）", async () => {
        for (const [i, t] of [
            QuestionType.Cloze,
            QuestionType.Match,
            QuestionType.Essay,
            QuestionType.Trans,
        ].entries()) {
            const setId = `set-${i}`;
            const bank = newBank({
                records: { [`q${i}`]: rec(`q${i}`, setId, t) },
                sets: { [setId]: { id: setId, title: "卷", qids: [`q${i}`], createdAt: 0 } },
            });
            await bank.preload();
            expect(readingScopeOf([q(`q${i}`, { rootId: setId })], bank), `${t}`).toBe(true);
        }
    });
});
