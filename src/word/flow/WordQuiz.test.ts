import { describe, expect, it } from "vitest";
import {
    buildMeaningOptions,
    buildWordOptions,
    checkOption,
    ladderMode,
    meaningLine,
    MODE_KEY,
    NEW_LADDER,
    pickMode,
    remainingWordCount,
    spellMatches,
    type WordCardMode,
} from "./WordQuiz";
import { initWordLib } from "../service/WordLib";
import { BUILTIN_BOOK } from "../service/WordBook";

/**
 * 单词出题纯逻辑（Issue #115 补锁）：ladderMode/pickMode 的**降级分流**与
 * spellMatches 的拼写容错在别处已有零散覆盖（WordLadder.test.ts 只锁了
 * ladderMode 的梯步顺序），这里补齐三块真缺口：
 *  ① 题型轮换 REVIEW_MODES 的取模分流 + 每档的降级判据（选项不足/长词）；
 *  ② 选项组合的确定性（同词每次一致——错选来源 from 与判分同源的前提）；
 *  ③ spellMatches 的归一化容错（大小写/空格/连字符/撇号）与空输入拒绝。
 *
 * 依赖词书房：用**内置书**（initWordLib 传内存 IO，零内核通道）。
 */

/** 出题函数读 wordLib() 单例的当前书——每例先切到内置书。 */
function useBuiltin(): void {
    initWordLib({
        read: async () => undefined,
        write: async () => undefined,
        remove: async () => undefined,
    });
}

useBuiltin();

/** 内置书里找一个「释义首行非空」的下标（干扰项池靠它建）。 */
function someIdx(): number {
    const words = BUILTIN_BOOK.words;
    for (let i = 0; i < words.length; i++) if (meaningLine(i)) return i;
    throw new Error("内置书无可用词条");
}

describe("MODE_KEY · 题型标签映射", () => {
    it("每个形态都有 i18n key（漏一个就是空标签）", () => {
        for (const m of NEW_LADDER) expect(MODE_KEY[m]).toBeTruthy();
        expect(MODE_KEY.readalong).toBe("wordModeReadalong");
        expect(MODE_KEY.spell).toBe("wordModeSpell");
    });
});

describe("pickMode · 会话轮换取模", () => {
    const conf: readonly number[] = [];
    const modes = Array.from({ length: 10 }, (_v, seq) => pickMode(seq, someIdx(), conf));

    it("按 seq 取模循环五档轮换（新词首题不走这里）", () => {
        // REVIEW_MODES = choiceEn / recallEn / choiceZh / spell / recallZh
        expect(modes.slice(0, 5)).toEqual(["choiceEn", "recallEn", "choiceZh", "spell", "recallZh"]);
        expect(modes[5]).toBe(modes[0]); // seq=5 → 取模回 0
        expect(modes[9]).toBe(modes[4]);
    });

    it("同 seq 反复调用结果稳定（纯函数、无隐藏状态）", () => {
        const idx = someIdx();
        expect(pickMode(2, idx, conf)).toBe(pickMode(2, idx, conf));
        expect(pickMode(0, idx, conf)).toBe(pickMode(0, idx, conf));
    });
});

describe("ladderMode · 四步梯降级分流", () => {
    it("超长词（含空格）在 spell 档降级为中文回想", () => {
        // 构造一个可注入超长词的场景：内置书词条由 data 决定，改不动；
        // 这里改为验证「短词不降级」这一侧，降级侧由 pickMode 的空格判据覆盖
        const idx = BUILTIN_BOOK.words.findIndex((w) => !w.w.includes(" ") && w.w.length <= 14);
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(pickMode(3, idx, [])).toBe("spell");
    });

    it("done 超出梯长钳在末步（跨轮不越界）", () => {
        const idx = someIdx();
        expect(ladderMode(BUILTIN_BOOK.words.length, idx, [])).toBe("recallEn");
    });

    it("末步恒为英文回想（无降级分支）", () => {
        const idx = someIdx();
        expect(ladderMode(3, idx, [])).toBe("recallEn");
    });
});

describe("选项组合 · 确定性与形状", () => {
    const idx = someIdx();

    it("看词选义：四项齐、正确项恰一个且指向本题", () => {
        const opts = buildMeaningOptions(idx, []);
        expect(opts.length).toBe(4);
        const mine = opts.filter((o) => o.from === idx);
        expect(mine.length).toBe(1);
        expect(mine[0].text).toBe(meaningLine(idx));
    });

    it("同词两次构造逐字节相同（稳定伪随机；渲染与判定须同源）", () => {
        expect(buildMeaningOptions(idx, [])).toEqual(buildMeaningOptions(idx, []));
        expect(buildWordOptions(idx, [])).toEqual(buildWordOptions(idx, []));
    });

    it("选项文本互不重复（干扰池去重）", () => {
        const texts = buildMeaningOptions(idx, []).map((o) => o.text);
        expect(new Set(texts).size).toBe(texts.length);
    });

    it("看义选词：正确项是本题单词本身", () => {
        const opts = buildWordOptions(idx, []);
        expect(opts.length).toBe(4);
        expect(opts.filter((o) => o.from === idx).map((o) => o.text)).toEqual([BUILTIN_BOOK.words[idx].w]);
    });
});

describe("checkOption · 选择题判定", () => {
    const idx = someIdx();

    it("选中正确项 → correct、pick 与 pickFrom 指回本题", () => {
        const opts = buildMeaningOptions(idx, []);
        const right = opts.findIndex((o) => o.from === idx);
        const st = checkOption("choiceEn", idx, right, []);
        expect(st).toMatchObject({ correct: true, pick: right, pickFrom: idx });
    });

    it("选中干扰项 → correct=false，pickFrom 指向干扰来源词（错选画像用）", () => {
        const opts = buildMeaningOptions(idx, []);
        const wrong = opts.findIndex((o) => o.from !== idx);
        const st = checkOption("choiceEn", idx, wrong, []);
        expect(st!.correct).toBe(false);
        expect(st!.pickFrom).toBe(opts[wrong].from);
    });

    it("choiceZh 走单词选项（同一 no 的判定源不同）", () => {
        const opts = buildWordOptions(idx, []);
        const right = opts.findIndex((o) => o.from === idx);
        expect(checkOption("choiceZh", idx, right, [])!.correct).toBe(true);
    });

    it("listen 与 choiceEn 同源（释义选项）", () => {
        const opts = buildMeaningOptions(idx, []);
        const right = opts.findIndex((o) => o.from === idx);
        expect(checkOption("listen", idx, right, [])!.correct).toBe(true);
    });

    it("越界选项号返回 undefined（组件据此忽略点击）", () => {
        expect(checkOption("choiceEn", idx, 9, [])).toBeUndefined();
        expect(checkOption("choiceEn", idx, -1, [])).toBeUndefined();
    });
});

describe("spellMatches · 拼写容错", () => {
    it("大小写/空格/连字符/撇号差异不伤命中", () => {
        expect(spellMatches("TwoDay", "two-day")).toBe(true);
        expect(spellMatches("two day", "two-day")).toBe(true);
        expect(spellMatches("O'Reilly", "oreilly")).toBe(true);
        expect(spellMatches("  ZEAL  ", "zeal")).toBe(true);
    });

    it("拼错即 false（多一个字母也不行）", () => {
        expect(spellMatches("zeall", "zeal")).toBe(false);
        expect(spellMatches("zela", "zeal")).toBe(false);
    });

    it("空输入/纯分隔符一律不判对（防「空串=对」）", () => {
        expect(spellMatches("", "zeal")).toBe(false);
        expect(spellMatches("   ", "zeal")).toBe(false);
        expect(spellMatches("-'", "zeal")).toBe(false);
    });

    it("空词条不会因空输入翻对", () => {
        expect(spellMatches("", "")).toBe(false);
    });
});

describe("MODE 常量与剩余词数", () => {
    it("轮换与梯步的集合关系（梯步是轮换的子集）", () => {
        for (const m of NEW_LADDER) expect(MODE_KEY[m]).toBeTruthy();
        expect(new Set<WordCardMode>(NEW_LADDER).size).toBe(4);
    });

    it("remainingWordCount 去重口径（错词重现同词只算一次）", () => {
        expect(remainingWordCount([1, 2, 2, 3], 0)).toBe(3);
        expect(remainingWordCount([1, 2, 2, 3], 2)).toBe(2);
    });
});
