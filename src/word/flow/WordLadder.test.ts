import { describe, expect, it } from "vitest";
import { ladderMode, NEW_LADDER, remainingWordCount } from "./WordQuiz";

/** 四步梯定稿（20260827 口述版）：英选中→中选英→听音→英文回想。
 *  队列组织 20260828 起换滚动窗口（WindowSched），静态流水线已删。 */
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

/** 队列会话（review/star）「剩」按词计：错词重现的多位出镜只算一个词。 */
describe("remainingWordCount", () => {
    it("进行中的会话只数 pos 之后的词", () => {
        expect(remainingWordCount([3, 4, 5, 3, 6], 1)).toBe(4);
        expect(remainingWordCount([3, 4, 5, 3, 6], 4)).toBe(1);
        expect(remainingWordCount([3, 4, 5, 3, 6], 5)).toBe(0);
    });

    it("错词重现（同词再插队）不重复计数", () => {
        expect(remainingWordCount([5, 6, 5, 7], 0)).toBe(3);
        expect(remainingWordCount([5, 6, 5, 7], 1)).toBe(3);
        expect(remainingWordCount([5, 6, 5, 7], 4)).toBe(0);
    });

    it("无重现队列与老语义 queueLen-pos 等价", () => {
        expect(remainingWordCount([3, 4, 5], 1)).toBe(2);
    });
});
