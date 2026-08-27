import { describe, expect, it } from "vitest";
import { ladderMode, NEW_LADDER, pipelineLadder, remainingWordCount } from "./WordQuiz";

/** 四步梯定稿（20260827 口述版）：英选中→中选英→听音→英文回想。 */
describe("NEW_LADDER 梯序", () => {
    it("梯步顺序为用户定稿", () => {
        expect(NEW_LADDER).toEqual(["choiceEn", "choiceZh", "listen", "recallEn"]);
    });

    it("ladderMode 按 done 取步，超出末步钳在末步", () => {
        const conf: number[] = [];
        expect(ladderMode(0, 100, conf)).toBe("choiceEn");
        expect(ladderMode(1, 100, conf)).toBe("choiceZh");
        expect(ladderMode(2, 100, conf)).toBe("listen");
        expect(ladderMode(3, 100, conf)).toBe("recallEn");
        expect(ladderMode(4, 100, conf)).toBe("recallEn");
        expect(ladderMode(99, 100, conf)).toBe("recallEn");
    });
});

/** 流水线：组宽≤4 轮转出镜——相邻四张卡是四个不同词。 */
describe("pipelineLadder", () => {
    it("整组（≥4 词）按轮转出镜，每词出镜次数 = remain", () => {
        const out = pipelineLadder([10, 11, 12, 13], () => 4);
        // 同组逐轮：r0 全员 → r1 全员 …
        expect(out).toEqual([10, 11, 12, 13, 10, 11, 12, 13, 10, 11, 12, 13, 10, 11, 12, 13]);
        // 相邻 4 张互不重复（组内轮转性质）
        for (let i = 0; i + NEW_LADDER.length <= out.length; i += NEW_LADDER.length) {
            expect(new Set(out.slice(i, i + 4)).size).toBe(4);
        }
    });

    it("不足四词自动成小组（没有会慢慢安排）", () => {
        expect(pipelineLadder([7], () => 4)).toEqual([7, 7, 7, 7]);
        expect(pipelineLadder([7, 8], () => 3)).toEqual([7, 8, 7, 8, 7, 8]);
    });

    it("remain 折算剩余步数：进度靠前的词少出镜（AI 组边界重排用）", () => {
        // 词 10 已走 3 步（剩 1），其余满 4 步
        const out = pipelineLadder([10, 11, 12, 13], (i) => (i === 10 ? 1 : 4));
        expect(out.filter((i) => i === 10)).toHaveLength(1);
        expect(out.filter((i) => i === 11)).toHaveLength(4);
        // 唯一一次出现在第 0 轮
        expect(out[0]).toBe(10);
    });

    it("跨组不串：第二组从自己的第 0 轮重新起", () => {
        const out = pipelineLadder([0, 1, 2, 3, 4], (i) => (i >= 4 ? 1 : 4));
        // 组1：[0,1,2,3]×4；组2：[4]×1
        expect(out.slice(16)).toEqual([4]);
        expect(out[15]).toBe(3);
    });
});

/** 头部统计「剩」按词计：梯流水线/错词重现的多位出镜只算一个词。 */
describe("remainingWordCount", () => {
    it("四步梯队列去重计数（×4 展开不虚增「剩」）", () => {
        const q = pipelineLadder([10, 11, 12, 13], () => 4);
        expect(q).toHaveLength(16);
        expect(remainingWordCount(q, 0)).toBe(4);
    });

    it("进行中的会话只数 pos 之后的词", () => {
        // 轮转出镜 [10,11,12,13]×4 轮：中途四位都仍在梯里；末位只数 1 词
        const q = pipelineLadder([10, 11, 12, 13], () => 4);
        expect(remainingWordCount(q, 8)).toBe(4);
        expect(remainingWordCount(q, 15)).toBe(1);
        expect(remainingWordCount(q, 16)).toBe(0);
    });

    it("错词重现（同词再插队）不重复计数", () => {
        expect(remainingWordCount([5, 6, 5, 7], 0)).toBe(3);
        expect(remainingWordCount([5, 6, 5, 7], 1)).toBe(3);
        expect(remainingWordCount([5, 6, 5, 7], 4)).toBe(0);
    });

    it("复习/星标队列（每词一位）与老语义 queueLen-pos 等价", () => {
        expect(remainingWordCount([3, 4, 5], 1)).toBe(2);
    });
});
