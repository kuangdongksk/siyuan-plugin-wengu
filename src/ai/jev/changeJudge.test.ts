import { describe, expect, it } from "vitest";
import { buildChangeState, judgeChanges, type ChangeItem } from "./changeJudge";
import type { JevHttpResponse } from "./transport";

/**
 * 增量变更实质判定（Issue #186 A3）的纯判定层单测：全 mock，不碰真网络。
 * 重点断言**方向与 A2 相反**的那条口径——低置信当实质（宁可多转不漏转）。
 */

function mockTransport(script: JevHttpResponse[]) {
    const payloads: string[] = [];
    let i = 0;
    const fn = async (req: { payload: string }) => {
        payloads.push(req.payload);
        const res = script[Math.min(i, script.length - 1)];
        i++;
        return res;
    };
    return { fn, payloads };
}

/** 按块给概率的响应体（noul 答案按名对象 q0..）。 */
const body = (ps: number[]): string =>
    JSON.stringify({ answers: Object.fromEntries(ps.map((p, idx) => [`q${idx}`, { noul: p }])) });

const items: ChangeItem[] = [
    { key: "H:a", oldQuestions: "第 1 题 求 x 的值。答案：1", newText: "结论：x=2" },
    { key: "H:b", oldQuestions: "第 1 题 填空：光合作用", newText: "这是一个错别字修正。" },
];

describe("变更实质判定（judgeChanges）", () => {
    it("无 key：全部当实质（宁可多转不漏转）、零请求", async () => {
        const { fn, payloads } = mockTransport([]);
        const r = await judgeChanges(items, { apiKey: "", transport: fn });
        expect(r.verdicts.every((v) => v.substantive && !v.judged)).toBe(true);
        expect(r.substantiveCount).toBe(2);
        expect(payloads.length).toBe(0);
    });

    it("一次请求问完一批：旧题 + 新源文成对进 state，每块一题", async () => {
        const { fn, payloads } = mockTransport([{ status: 200, body: body([0.9, 0.1]) }]);
        const r = await judgeChanges(items, { apiKey: "sk-test", transport: fn });
        expect(payloads.length).toBe(1);
        const sent = JSON.parse(payloads[0]) as { questions: Record<string, unknown>; state: string };
        expect(Object.keys(sent.questions)).toEqual(["q0", "q1"]);
        expect(sent.state).toContain("【第 1 处修改】");
        expect(sent.state).toContain("旧题：");
        expect(sent.state).toContain("修改后的源文：");
        expect(r.checked).toBe(2);
    });

    it("两档决策：明确是 → 重转；明确否 → 保留旧题（措辞）", async () => {
        const { fn } = mockTransport([{ status: 200, body: body([0.9, 0.1]) }]);
        const r = await judgeChanges(items, { apiKey: "sk-test", transport: fn });
        expect(r.verdicts).toEqual([
            { key: "H:a", substantive: true, judged: true },
            { key: "H:b", substantive: false, judged: true },
        ]);
        expect(r.substantiveCount).toBe(1);
    });

    it("低置信（0.5）当实质——与 A2 相反方向的硬口径", async () => {
        const { fn } = mockTransport([{ status: 200, body: body([0.5, 0.5]) }]);
        const r = await judgeChanges(items, { apiKey: "sk-test", transport: fn });
        expect(r.verdicts.every((v) => v.substantive)).toBe(true);
        expect(r.substantiveCount).toBe(2);
    });

    it("概率缺值（回壳没回值）：整批当实质", async () => {
        const { fn } = mockTransport([{ status: 200, body: JSON.stringify({ answers: { q0: { noul: null } } }) }]);
        const r = await judgeChanges(items, { apiKey: "sk-test", transport: fn });
        expect(r.verdicts.every((v) => v.substantive)).toBe(true);
        expect(r.checked).toBe(0);
    });

    it("判定抛错（网络/协议）：静默回落成「当实质」", async () => {
        const { fn } = mockTransport([{ status: 0, body: "断网" }]);
        const r = await judgeChanges(items, { apiKey: "sk-test", transport: fn });
        expect(r.verdicts.every((v) => v.substantive && !v.judged)).toBe(true);
    });

    it("空清单：零请求、零计数", async () => {
        const { fn, payloads } = mockTransport([]);
        const r = await judgeChanges([], { apiKey: "sk-test", transport: fn });
        expect(r.verdicts).toEqual([]);
        expect(payloads.length).toBe(0);
    });

    it("state 组装：旧题与新源文都在（判定要的就是这个对照面）", () => {
        const s = buildChangeState([{ key: "k", oldQuestions: "旧题", newText: "新源文" }]);
        expect(s).toContain("旧题");
        expect(s).toContain("新源文");
    });

    it("旧题缺失（无记录可读）的块：按实质保守处置，不占答案位序", async () => {
        const { fn, payloads } = mockTransport([{ status: 200, body: body([0.1]) }]);
        const r = await judgeChanges(
            [
                { key: "a", oldQuestions: "", newText: "新源文" },
                { key: "b", oldQuestions: "旧题", newText: "新源文二" },
            ],
            { apiKey: "sk-test", transport: fn }
        );
        expect(JSON.parse(payloads[0]).questions).toHaveProperty("q0");
        expect(Object.keys(JSON.parse(payloads[0]).questions)).toEqual(["q0"]); // 只有可判的那块
        expect(r.verdicts).toEqual([
            { key: "a", substantive: true, judged: false },
            { key: "b", substantive: false, judged: true },
        ]);
    });
});
