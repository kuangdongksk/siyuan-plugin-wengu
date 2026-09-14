import { describe, expect, it } from "vitest";
import { QuestionType, type WenguQuestion } from "../../types";
import type { BankData, BankRecord, QuestionBank } from "../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../bank/data/QuestionBank";
import { renderUnit } from "../../convert/service/draft/QuestionDraft";
import {
    readingScopeOf,
    readingScopeOfSet,
    readingSegmentsOf,
    readingShellScope,
    scopedSegments,
} from "./ReadingScope";

// node 测试环境无 window（vitest 不启 jsdom）；QuestionBank 的落盘防抖用
// window.setTimeout（同 BankSets.test）
(globalThis as { window?: unknown }).window ??= globalThis;

/**
 * 阅读面作用域判定（Issue #81，Issue #83 改两级口径）：`.wengu-reading`
 * 只挂英语卷——**有学科以学科为准**（`BankSet.subject === "英语"` 一族）、
 * **无学科回退题型并集**（含英语四类 cloze/match/essay/trans 任一）。
 *
 * 下面第一段锁的是**回退腿**（存量题集/未报学科，逐字节不回归）；第二段
 * 锁 Issue #83 的验收 1/2/4/5（纯阅读英语卷、语文卷、存量、混合刷分段）。
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

/* ── Issue #83：学科两级口径 ── */

/** 带学科的题集（题型故意与学科「错位」，正是形态代理判不开的两类）。 */
const subjectBank = (subject: string, types: string[]) =>
    newBank({
        records: {
            s1: rec("s1", "set-s", types[0]),
            ...(types[1] ? { s2: rec("s2", "set-s", types[1]) } : {}),
        },
        sets: {
            "set-s": {
                id: "set-s",
                title: "卷",
                qids: types.map((_, i) => `s${i + 1}`),
                createdAt: 0,
                subject,
            },
        },
    });

describe("ReadingScope：有学科以学科为准（Issue #83 验收 1/2）", () => {
    it("纯阅读英语训练卷（题型并集只有 single）有 subject=英语 ⇒ 挂阅读面", async () => {
        // 验收 1：改造前判非英语（题型并集无英语四类）——假阴
        const bank = subjectBank("英语", ["single"]);
        await bank.preload();
        expect(readingScopeOfSet("set-s", bank)).toBe(true);
        expect(readingScopeOf([q("s1", { rootId: "set-s" })], bank)).toBe(true);
    });

    it("语文卷（essay/trans 在场）有 subject=语文 ⇒ 不挂（形态代理的假阳被纠正）", async () => {
        // 验收 2：essay/trans 是合法语文题型，改造前被当成英语卷
        const bank = subjectBank("语文", ["essay", "trans"]);
        await bank.preload();
        expect(readingScopeOfSet("set-s", bank)).toBe(false);
        // 反证：同一份题型并集若无学科，仍按改造前口径判英语（回退腿）
        const legacy = subjectBank("无", ["essay", "trans"]);
        await legacy.preload();
        expect(readingScopeOfSet("set-s", legacy)).toBe(true);
    });

    it("学科写法容错：English/英文 认，其它学科（数学/自控原理）不认", async () => {
        for (const ok of ["英语", " English ", "英文"]) {
            const bank = subjectBank(ok, ["single"]);
            await bank.preload();
            expect(readingScopeOfSet("set-s", bank), ok).toBe(true);
        }
        for (const no of ["数学", "语文", "自控原理", "English literature"]) {
            const bank = subjectBank(no, ["cloze"]);
            await bank.preload();
            expect(readingScopeOfSet("set-s", bank), no).toBe(false);
        }
    });

    it("学科在场即**只看学科**：英语卷含语文形态也不动摇", async () => {
        const bank = subjectBank("英语（阅读理解）", ["single", "trans"]);
        await bank.preload();
        expect(readingScopeOfSet("set-s", bank)).toBe(true);
    });

    it("存量题集（无 subject 字段）回退题型并集（验收 4，逐字节不回归）", async () => {
        const bank = englishBank(); // sets 无 subject 键
        await bank.preload();
        expect(readingScopeOfSet("set-en", bank)).toBe(true);
        expect(readingScopeOfSet("set-math", bank)).toBe(false);
    });

    it("学科占位/空串 ⇒ 走回退腿（不算「有学科」）", async () => {
        for (const placeholder of ["无", "未知", " ", "-"]) {
            const bank = subjectBank(placeholder, ["single"]);
            await bank.preload();
            // 回退题型并集：只有 single ⇒ false（而不是被假学科锁死）
            expect(readingScopeOfSet("set-s", bank), placeholder).toBe(false);
            const cb = subjectBank(placeholder, ["cloze"]);
            await cb.preload();
            expect(readingScopeOfSet("set-s", cb), placeholder).toBe(true);
        }
    });
});

describe("readingSegmentsOf：混合刷按题集段各判各段（Issue #83 验收 5）", () => {
    it("英语段 true、数学段 false（段序与 groups 同序等长）", async () => {
        const bank = newBank({
            records: {
                e1: rec("e1", "set-en", "single"), // 纯阅读英语卷：无英语形态
                m1: rec("m1", "set-math", "single"),
            },
            sets: {
                "set-en": { id: "set-en", title: "英一阅读", qids: ["e1"], createdAt: 0, subject: "英语" },
                "set-math": { id: "set-math", title: "高数", qids: ["m1"], createdAt: 0, subject: "数学" },
            },
        });
        await bank.preload();
        expect(readingSegmentsOf([{ setId: "set-en" }, { setId: "set-math" }], bank)).toEqual([true, false]);
        expect(readingSegmentsOf([{ setId: "set-math" }, { setId: "set-en" }], bank)).toEqual([false, true]);
    });

    it("段级与单卷判定同源（逐段等价 readingScopeOfSet）", async () => {
        const bank = englishBank();
        await bank.preload();
        const segs = readingSegmentsOf([{ setId: "set-en" }, { setId: "set-nope" }, { setId: "" }], bank);
        expect(segs).toEqual([true, false, false]);
    });

    it("空段表/无题库/未装载 ⇒ 全 false（宁窄勿宽）", async () => {
        const bank = englishBank(); // 未 preload
        expect(readingSegmentsOf([{ setId: "set-en" }], bank)).toEqual([false]);
        expect(readingSegmentsOf([{ setId: "set-en" }])).toEqual([false]);
        expect(readingSegmentsOf([], englishBank())).toEqual([]);
    });
});

describe("readingShellScope / scopedSegments（Issue #83 整壳与逐段作用域）", () => {
    it("单段：整壳类名=该段判定（逐字等价改造前的首题判定）", () => {
        expect(readingShellScope([true])).toBe(true);
        expect(readingShellScope([false])).toBe(false);
        expect(scopedSegments([true])).toEqual([]); // 单段不包任何包装
        expect(scopedSegments([false])).toEqual([]); // 非英语段也不包
    });

    it("全段皆英语：整壳挂类名、零包装（省一层 DOM）", () => {
        expect(readingShellScope([true, true, true])).toBe(true);
        expect(scopedSegments([true, true])).toEqual([]);
    });

    it("混合刷：不挂整壳，只给英语段包装（数学段既不挂类也不多包）", () => {
        expect(readingShellScope([true, false])).toBe(false);
        expect(scopedSegments([true, false, true, false])).toEqual([0, 2]);
        expect(scopedSegments([false, false])).toEqual([]); // 全非英语：整壳不挂、无处要包
    });

    it("空段表（无题）⇒ 不挂整壳、零包装", () => {
        expect(readingShellScope([])).toBe(false);
        expect(scopedSegments([])).toEqual([]);
    });
});
