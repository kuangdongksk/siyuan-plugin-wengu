import { describe, expect, it } from "vitest";
import { graduateWord, openWord, ratingOf, reviewWord, seedWord } from "./WordFsrs";
import { defaultProgress, keyOf, markMistake, pseudoLevelOf } from "./WordStore";

const NOW = new Date("2026-08-28T10:00:00").getTime();
const DAY = 86_400_000;

describe("ratingOf 三档映射", () => {
    it("认识→Good、模糊→Hard、忘记→Again（Easy 不用）", () => {
        expect(ratingOf("know")).toBe(3);
        expect(ratingOf("fuzzy")).toBe(2);
        expect(ratingOf("no")).toBe(1);
    });
});

describe("graduateWord 毕业初始化", () => {
    it("0 错→Good、1 错→Hard、≥2 错→Again：到期日严格递增", () => {
        const p = defaultProgress();
        graduateWord(p, 10, 0, NOW);
        graduateWord(p, 11, 1, NOW);
        graduateWord(p, 12, 2, NOW);
        expect(p.words[keyOf(10)].due).toBeGreaterThan(p.words[keyOf(11)].due);
        expect(p.words[keyOf(11)].due).toBeGreaterThan(p.words[keyOf(12)].due);
        expect(p.words[keyOf(12)].due).toBeGreaterThan(NOW); // 最差也是今天/明天见
    });

    it("毕业计数一次、清 ladder、记一条流水", () => {
        const p = defaultProgress();
        p.ladder[keyOf(7)] = [3, 1];
        graduateWord(p, 7, 1, NOW);
        expect(p.today.newCount).toBe(1);
        expect(p.ladder[keyOf(7)]).toBeUndefined();
        expect(p.reviews[keyOf(7)]).toEqual([{ ts: NOW, rt: 2, dl: 0 }]);
    });
});

describe("reviewWord 复习步进", () => {
    it("首复：写 FSRS 态、计复习数、流水 dl=0", () => {
        const p = defaultProgress();
        reviewWord(p, 3, "know", NOW);
        const st = p.words[keyOf(3)];
        expect(st.s).toBeGreaterThan(0);
        expect(st.due).toBeGreaterThan(NOW);
        expect(p.today.revCount).toBe(1);
        expect(p.reviews[keyOf(3)].length).toBe(1);
        expect(p.reviews[keyOf(3)][0].dl).toBe(0);
    });

    it("按时复：稳定度增长、流水 dl=间隔天数、Again 记 lapse", () => {
        const p = defaultProgress();
        reviewWord(p, 3, "know", NOW);
        const s1 = p.words[keyOf(3)].s;
        const due = p.words[keyOf(3)].due;
        reviewWord(p, 3, "know", Math.min(due, NOW + 3 * DAY)); // 到期日复
        expect(p.words[keyOf(3)].s).toBeGreaterThan(s1);
        expect(p.reviews[keyOf(3)][1].dl).toBeGreaterThan(0);
        reviewWord(p, 3, "no", NOW + 10 * DAY);
        expect(p.words[keyOf(3)].l).toBe(1);
    });

    it("答「忘记」记误认本：count 累计、重答错清旧辨析", () => {
        const p = defaultProgress();
        reviewWord(p, 5, "no", NOW);
        expect(p.mistakes[keyOf(5)]).toMatchObject({ count: 1, lastTs: NOW });
        p.mistakes[keyOf(5)]!.note = "旧辨析";
        reviewWord(p, 5, "no", NOW + DAY);
        expect(p.mistakes[keyOf(5)]).toMatchObject({ count: 2 });
        expect(p.mistakes[keyOf(5)]!.note).toBeUndefined();
        reviewWord(p, 5, "fuzzy", NOW + 2 * DAY);
        expect(p.mistakes[keyOf(5)]!.count).toBe(2); // 模糊不记误认
    });
});

describe("markMistake 误认本（词头 key）", () => {
    it("直接记账也走词头 key；confused 由调用方回填", () => {
        const p = defaultProgress();
        markMistake(p, 20, NOW);
        expect(Object.keys(p.mistakes)).toEqual([keyOf(20)]);
        expect(p.mistakes[keyOf(20)]).toMatchObject({ count: 1, lastTs: NOW });
    });
});

describe("openWord / seedWord", () => {
    it("开词：ladder 记 [0,0]（词头 key）；重复开不重置", () => {
        const p = defaultProgress();
        openWord(p, 4);
        expect(p.ladder[keyOf(4)]).toEqual([0, 0]);
        p.ladder[keyOf(4)] = [2, 1];
        openWord(p, 4);
        expect(p.ladder[keyOf(4)]).toEqual([2, 1]);
    });

    it("导入种子：中难度、给定稳定度与到期", () => {
        const p = defaultProgress();
        seedWord(p, 9, 8, 8, NOW);
        expect(p.words[keyOf(9)]).toMatchObject({ d: 5, s: 8 });
        expect(p.words[keyOf(9)].due).toBe(NOW + 8 * DAY);
    });
});

describe("pseudoLevelOf 稳定度→伪档位", () => {
    it("按旧阶梯天数带折算", () => {
        expect(pseudoLevelOf(0.5)).toBe(1);
        expect(pseudoLevelOf(2)).toBe(2);
        expect(pseudoLevelOf(4)).toBe(3);
        expect(pseudoLevelOf(8)).toBe(4);
        expect(pseudoLevelOf(16)).toBe(5);
        expect(pseudoLevelOf(32)).toBe(6);
    });
});
