import { describe, expect, it } from "vitest";
import { armed, q } from "./MobileDrillHarness";
import { QuestionType } from "../../types";
import type { WenguQuestion } from "../../types";

/**
 * 交卷兜住「已选未确认」（Issue #164）：#105 两段式确认（点选只落选择态）×
 * #158 空轮静默关轮的组合陷阱——用户按「点选项=已答」的心智刷完直接交卷，
 * 整轮被判空轮、`closeEmptyRound` 静默抹除，作答无痕丢失（history 零记录）。
 *
 * 口径：
 *  - 判据＝`MobileAnswering.isPickedUnconfirmed`（**唯一实现**，形态分派同
 *    提交链 `submittedOf`）；
 *  - 交卷补记**走既有 `submit` 记账链**（会话 upsert + 题库镜像），不新开
 *    第二条记账路径；
 *  - 真·空轮（零作答零选择）维持 #158 静默关轮；
 *  - 桌面链不动（`finishRoundGuarded` 只在 `RoundReport.contract.test` 侧锁）。
 *
 * 装配件在 `MobileDrillHarness.ts`。
 */

describe("交卷不发静默丢弃（Issue #164）", () => {
    it("①只点选未确认 → 交卷不关轮、弹层给明确去向（不静默丢弃）", () => {
        const { drill, removes, upserts } = armed();
        drill.pickLetter("A");
        expect(drill.ui.session?.answered).toBe(0); // 选择态不记账（#105）
        expect(drill.ui.cards[0].graded).toBe(false);
        const before = upserts.length;

        drill.requestEnd();
        // 不关轮：会话还在、落盘那条没被抹、也没回开刷面板
        expect(drill.ui.session).toBeTruthy();
        expect(removes).toEqual([]);
        expect(drill.ui.screen).toBe("drill");
        expect(drill.ui.endPickedN).toBe(1);
        expect(drill.ui.confirmEnd).toBe(false); // 走的是第二态，不是普通确认弹层
        expect(upserts.length).toBe(before); // 此刻零记账（补记要用户点头）
    });

    it("②「按当前已选交卷」→ 补记完整：会话记账 + 题库镜像与逐题确认一致", async () => {
        const { drill, calls, upserts } = armed();
        const right = drill.ui.list[0].answer!; // 洗牌后正确字母按视图取
        drill.pickLetter(right);
        drill.requestEnd();
        await drill.endNowPicked();
        const s = drill.ui.session!;
        expect(s.results).toHaveLength(1);
        expect(s.results[0]).toMatchObject({ qid: drill.ui.list[0].id, submitted: right, ok: true });
        expect(s.answered).toBe(1);
        expect(s.correct).toBe(1);
        // 题库镜像：与「逐题点选 + 确认答案」同一条链（首答记一次）
        expect(calls).toEqual([{ kind: "first", qid: drill.ui.list[0].id, ok: true }]);
        expect(upserts.length).toBeGreaterThan(1);
        // 随后收卷出报告，交卷后不可再改
        expect(s.endedAt).toBeTruthy();
        expect(drill.ui.screen).toBe("report");
        expect(drill.ui.endPickedN).toBeNull();
        expect(drill.ui.confirmEnd).toBe(false);
        expect(drill.ui.cards[0]).toMatchObject({ graded: true, locked: true, revealed: true, ok: true });
    });

    it("②′补记口径与「逐题点选 + 确认答案」逐字一致（收卷模式）", async () => {
        const auto = armed({ reveal: "after" });
        const manual = armed({ reveal: "after" });
        for (const d of [auto.drill, manual.drill]) {
            d.pickLetter(d.ui.list[0].answer!);
        }
        // 手动路：逐题确认答案后交卷（用户本来的正确操作）
        await manual.drill.submit();
        manual.drill.requestEnd();
        manual.drill.endRound();
        // 补记路：直接交卷 → 弹层 → 「按当前已选交卷」
        auto.drill.requestEnd();
        await auto.drill.endNowPicked();
        const pick = (s: { qid: string; submitted: string; ok: boolean }[]) =>
            s.map((r) => ({ qid: r.qid, submitted: r.submitted, ok: r.ok }));
        expect(pick(auto.drill.ui.session!.results)).toEqual(pick(manual.drill.ui.session!.results));
        expect(auto.drill.ui.session?.answered).toBe(manual.drill.ui.session?.answered);
        expect(auto.drill.ui.session?.correct).toBe(manual.drill.ui.session?.correct);
        // 题库镜像同一条链（同一题首答各记一次，ok 一致）
        expect(auto.calls).toEqual(manual.calls);
        expect(auto.drill.ui.cards[0]).toMatchObject({ graded: true, locked: true, revealed: true, ok: true });
    });

    it("③「去确认」→ 回到该题（第一道已选未确认）且选择态还在", () => {
        const { drill } = armed({ questions: [q("a"), q("b")] });
        drill.next();
        drill.pickLetter("A"); // 第 2 题已选未确认
        drill.requestEnd();
        expect(drill.ui.endPickedN).toBe(1);
        drill.goConfirmEndPicked();
        expect(drill.ui.endPickedN).toBeNull();
        expect(drill.ui.qIdx).toBe(1);
        expect(drill.ui.cards[1].letters).toBe("A"); // 选择态未丢
        expect(drill.ui.cards[1].graded).toBe(false); // 也没被偷偷提交
        expect(drill.ui.session?.answered).toBe(0);
    });

    it("④零选择零作答 → 仍静默关轮（#158 不回归）", () => {
        const { drill, removes } = armed();
        const id = drill.ui.session!.id;
        drill.requestEnd();
        expect(drill.ui.endPickedN).toBeNull(); // 不开弹层
        expect(drill.ui.session).toBeUndefined();
        expect(removes).toContain(id);
        expect(drill.ui.screen).toBe("home");
    });

    it("④′即时模式：已有确认作答 + 另有已选未确认 → 交卷仍给弹层（不静默丢弃）", async () => {
        const { drill } = armed(); // instant
        drill.pickLetter(drill.ui.list[0].answer!);
        await drill.submit(); // 第 1 题已确认（answered=1）
        drill.next();
        drill.pickLetter(drill.ui.list[1].answer!); // 第 2 题只点选，未确认
        expect(drill.ui.session?.answered).toBe(1);
        drill.requestEnd();
        // 非空轮但仍有已选未确认：不许直接收卷把它们丢掉
        expect(drill.ui.endPickedN).toBe(1);
        expect(drill.ui.session?.endedAt).toBeUndefined();
        expect(drill.ui.screen).toBe("drill");
        await drill.endNowPicked();
        expect(drill.ui.session?.answered).toBe(2);
        expect(drill.ui.session?.correct).toBe(2);
        expect(drill.ui.session?.endedAt).toBeTruthy();
        expect(drill.ui.screen).toBe("report");
    });

    it("⑤多选题只勾部分项同口径（选择态判据不看「勾满」）", async () => {
        const multi = q("m", { type: QuestionType.Multiple, answer: "A", optionMd: ["甲", "乙"] });
        const { drill } = armed({ questions: [multi] });
        // 展示层洗牌后正确字母按视图取（口径见 MobileDrillShuffle.test.ts）
        const right = drill.ui.list[0].answer!;
        drill.pickLetter(right); // 只勾一项、不确认
        drill.requestEnd();
        expect(drill.ui.endPickedN).toBe(1);
        await drill.endNowPicked();
        expect(drill.ui.session?.results[0]).toMatchObject({ qid: "m", submitted: right, ok: true });
        expect(drill.ui.screen).toBe("report");
    });

    it("零选择但已有确认作答 → 走普通收卷（判据不误伤）", async () => {
        const { drill } = armed();
        drill.pickLetter(drill.ui.list[0].answer!);
        await drill.submit();
        drill.requestEnd();
        expect(drill.ui.endPickedN).toBeNull();
        expect(drill.ui.session?.endedAt).toBeTruthy();
        expect(drill.ui.screen).toBe("report");
    });

    it("答满未交卷（收卷模式）→ 仍出原确认弹层，不走第二态", async () => {
        const { drill } = armed({ reveal: "after" });
        drill.pickLetter("A");
        await drill.submit();
        drill.pickLetter("A");
        await drill.submit();
        drill.requestEnd();
        expect(drill.ui.endPickedN).toBeNull();
        expect(drill.ui.confirmEnd).toBe(true);
    });

    it("「去确认」若选择态已被清（极端）→ 弹层关闭且不动位置", () => {
        const { drill } = armed();
        drill.pickLetter("A");
        drill.requestEnd();
        drill.ui.cards[0].letters = ""; // 模拟状态被别处清掉
        drill.goConfirmEndPicked();
        expect(drill.ui.endPickedN).toBeNull();
        expect(drill.ui.qIdx).toBe(0);
    });
});

describe("「已选未确认」判据的形态口径（唯一实现 isPickedUnconfirmed）", () => {
    const cases: {
        name: string;
        over: Partial<WenguQuestion>;
        act: (d: ReturnType<typeof armed>["drill"]) => void;
        on: boolean;
    }[] = [
        {
            name: "文本作答（简答）非空即计入",
            over: { type: QuestionType.Essay },
            act: (d) => d.setMine("我的推导"),
            on: true,
        },
        {
            name: "填空作答非空即计入",
            over: { type: QuestionType.Fill, answer: "42", optionMd: [] },
            act: (d) => d.setMine("42"),
            on: true,
        },
        {
            name: "填空空白不计入（空提交本就走未作答提示）",
            over: { type: QuestionType.Fill, answer: "42", optionMd: [] },
            act: (d) => d.setMine("   "),
            on: false,
        },
        {
            name: "逐空题移动端无作答位：不计入（没有「去确认」出口）",
            over: {
                type: QuestionType.Cloze,
                answer: "B",
                optionMd: [],
                slots: [{ optionMd: ["甲", "乙"], answer: "B" }],
            },
            act: () => undefined,
            on: false,
        },
        {
            name: "无题型兜底题：不计入",
            over: { type: undefined, answer: undefined, optionMd: [] },
            act: () => undefined,
            on: false,
        },
    ];
    for (const c of cases) {
        it(c.name, () => {
            const { drill } = armed({ questions: [q("x", c.over)] });
            c.act(drill);
            drill.requestEnd();
            if (c.on) expect(drill.ui.endPickedN).toBe(1);
            else {
                expect(drill.ui.endPickedN).toBeNull();
                expect(drill.ui.session).toBeUndefined(); // 真·空轮：静默关轮
            }
        });
    }
});
