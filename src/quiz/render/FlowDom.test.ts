import { describe, expect, it } from "vitest";
import type { WenguQuestion } from "../../types";
import { qIndexById } from "./FlowDom";
import { shuffleListForDisplay } from "./CardDisplayShuffle";

/**
 * 题号反查按 **id**（Issue #131 真机级陷阱）：展示层洗牌给每张卡换的是
 * **副本对象**，而题号描色/跳过导航原先用 `list.indexOf(q)` 做身份比对
 * ——洗牌后必然落空，表现为「判分不标色、跳过不去下一题」这类静默失效。
 * 本测试锁死「洗过的卡也能在整卷里定位到自己的下标」。
 */

const q = (id: string): WenguQuestion => ({
    id,
    type: "single" as WenguQuestion["type"],
    attempts: 0,
    wrongCount: 0,
    optionMd: ["甲", "乙"],
    answer: "A",
});

/** 最小 AnswerHost 替身（qIndexById 只读 questions()）。 */
const host = (list: WenguQuestion[]) => ({ questions: () => list });

describe("qIndexById · 洗牌后仍能定位", () => {
    it("洗过的副本卡按 id 落在原下标（身份比对会落空）", () => {
        const list = [q("a"), q("b"), q("c")];
        const h = host(list);
        const cards = shuffleListForDisplay(list, () => 0.1);
        expect(cards[1]).not.toBe(list[1]); // 已是副本
        expect(list.indexOf(cards[1])).toBe(-1); // 身份比对落空（旧实现的坑）
        expect(qIndexById(h, cards[1].id)).toBe(1); // id 反查才是对的
    });

    it("未洗的卡同样按 id 定位；找不到返回 -1", () => {
        const list = [q("a"), q("b")];
        const h = host(list);
        expect(qIndexById(h, "b")).toBe(1);
        expect(qIndexById(h, "zz")).toBe(-1);
    });
});
