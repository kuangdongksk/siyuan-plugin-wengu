import { describe, expect, it } from "vitest";
import { shuffleListForDisplay } from "../../quiz/render/CardDisplayShuffle";
import { armed, q } from "./MobileDrillHarness";
import type { WenguQuestion } from "../../types";

/**
 * 移动端展示层选项洗牌（Issue #131 P1，口径见 quiz/render/CardDisplayShuffle
 * 文件头）：死形态入库 ⇒ 进卡前必须现洗，否则新造题正确项恒为首位＝剧透。
 * 装配件在 MobileDrillHarness.ts（与 MobileDrill.test.ts 共用）。
 */

describe("展示层选项洗牌（Issue #131 P1：移动端要洗）", () => {
    /** 4 选项题：死形态下正确项（按协议「写最前」）恒为首位——不洗就是剧透。 */
    const four = (id: string): WenguQuestion =>
        q(id, { optionMd: ["正解", "干扰一", "干扰二", "干扰三"], answer: "A" });

    it("start() 洗的是副本：正确项不再恒为首位；fullList 原件不动", () => {
        const { drill, ui } = armed({ questions: [four("a"), four("b"), four("c"), four("d")] });
        // 副本：不是 fullList 里那几个对象
        expect(drill.ui.list[0]).not.toBe(ui.fullList[0]);
        // 原件未被污染（重开一轮/记账按原件 id 走）
        expect(ui.fullList.every((x) => x.optionMd![0] === "正解")).toBe(true);
        expect(ui.fullList.every((x) => x.answer === "A")).toBe(true);
        // 至少一题的首位不再是正确项（洗牌生效；4 题全恒等的概率 (1/24)^4 可忽略）
        const firstIsAnswer = drill.ui.list.filter((x) => {
            const i = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf((x.answer ?? "").toUpperCase());
            return (x.optionMd ?? [])[0] === "正解" && i === 0;
        }).length;
        expect(firstIsAnswer).toBeLessThan(drill.ui.list.length);
    });

    it("洗后答案字母仍指向同一选项文本（判分口径不变）", () => {
        const { drill } = armed({ questions: [four("a"), four("b"), four("c"), four("d"), four("e")] });
        for (const x of drill.ui.list) {
            const i = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf((x.answer ?? "").toUpperCase());
            expect(x.optionMd![i]).toBe("正解");
            expect([...(x.optionMd ?? [])].sort()).toEqual(["干扰一", "干扰二", "干扰三", "正解"].sort());
        }
    });

    it("洗后判分与题号栏下标自洽：答对洗后的答案字母记 ok", async () => {
        const { drill, calls } = armed({ questions: [four("a"), four("b"), four("c")] });
        const a = drill.ui.list[0].answer!;
        drill.pickLetter(a);
        await drill.submit();
        expect(drill.ui.cards[0].ok).toBe(true);
        expect(calls[0]).toMatchObject({ qid: "a", ok: true });
    });

    it("重进同一轮：排列恒定（恢复的字母仍指同一项）", () => {
        const qs = [four("a"), four("b"), four("c")];
        const { drill, ui } = armed({ questions: qs });
        const firstOrder = drill.ui.list.map((x) => ({ id: x.id, opts: [...x.optionMd!], ans: x.answer }));
        const sid = drill.ui.session!.id;
        // 模拟「重进同一轮」：同一份 fullList + 同一会话 id 再洗一次
        drill.ui.list = shuffleListForDisplay([...ui.fullList], { scope: sid });
        expect(drill.ui.list.map((x) => ({ id: x.id, opts: [...x.optionMd!], ans: x.answer }))).toEqual(firstOrder);
    });

    it("换一轮：排列换（消剧透跨轮成立）", () => {
        const qs = [four("a"), four("b"), four("c"), four("d")];
        const orders = new Set<string>();
        for (let i = 0; i < 8; i++) {
            const { drill } = armed({ questions: qs.map((x) => ({ ...x })) });
            orders.add(drill.ui.list.map((x) => `${x.id}:${x.optionMd!.join("")}`).join("|"));
        }
        expect(orders.size).toBeGreaterThan(1);
    });

    it("id 与卷内顺序不变（题号栏/会话快照按 id 走）", () => {
        const { drill, ui } = armed({ questions: [four("a"), four("b"), four("c")] });
        expect(drill.ui.list.map((x) => x.id)).toEqual(ui.fullList.map((x) => x.id));
        expect(drill.ui.list).toHaveLength(3);
    });
});
