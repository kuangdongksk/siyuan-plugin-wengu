import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AiJudge 三态判分与批量归因（Issue #115）：判分是「对/半对/错」语义的
 * 唯一来源，全部收口在 parseBriefVerdict / attributeWrongCauses 两个
 * 纯函数里（AI 出口 mock，人肉喂 reply 串）。这里锁四件事：
 *  ① 三态解析（英文/中文两套写法）与 ok 口径（partial 记错）；
 *  ② COMMENT / SCORE / CAUSE 三行的取用与拼装；
 *  ③ 格式不符必须抛错（调用方靠它回落「AI 判分失败」路径，不许静默记错）；
 *  ④ 批量归因的 JSON / 正则兜底与下标错位防护。
 */

const ai = { reply: "" };
vi.mock("../../ai/client", () => ({
    agentChatOnce: vi.fn(async () => ai.reply),
}));

import { attributeWrongCauses, judgeBrief, type CauseItem } from "./AiJudge";
import { buildBriefPrompt, wrongCausesPrompt } from "../../ai/prompts/judge";
import { QuestionType, type WenguQuestion } from "../../types";

const q: WenguQuestion = {
    id: "q1",
    type: QuestionType.Single,
    stemMd: "下列 极限  计算正确的是？",
    answer: "A",
    solutionMd: "等价无穷小。",
    attempts: 0,
    wrongCount: 0,
};

beforeEach(() => {
    ai.reply = "";
});

describe("judgeBrief · 三态解析", () => {
    it("英文三态：right→ok、partial→统计记错但保留三态、wrong→错", async () => {
        ai.reply = "VERDICT: right\nCOMMENT: 思路正确";
        await expect(judgeBrief(q, "A", "m")).resolves.toMatchObject({ verdict: "right", ok: true });
        ai.reply = "VERDICT: partial\nCOMMENT: 方向对，缺一步";
        await expect(judgeBrief(q, "A", "m")).resolves.toMatchObject({ verdict: "partial", ok: false });
        ai.reply = "VERDICT: wrong\nCOMMENT: 方向错";
        await expect(judgeBrief(q, "A", "m")).resolves.toMatchObject({ verdict: "wrong", ok: false });
    });

    it("中文写法与全角冒号同等识别", async () => {
        ai.reply = "VERDICT：对\nCOMMENT：没问题";
        await expect(judgeBrief(q, "A", "m")).resolves.toMatchObject({ verdict: "right", ok: true });
        ai.reply = "VERDICT：半对\nCOMMENT：差一半";
        await expect(judgeBrief(q, "A", "m")).resolves.toMatchObject({ verdict: "partial", ok: false });
        ai.reply = "VERDICT：部分对\nCOMMENT：差一半";
        await expect(judgeBrief(q, "A", "m")).resolves.toMatchObject({ verdict: "partial", ok: false });
        ai.reply = "VERDICT：错\nCOMMENT：全错";
        await expect(judgeBrief(q, "A", "m")).resolves.toMatchObject({ verdict: "wrong", ok: false });
    });

    it("大小写不敏感（AI 回 RIGHT/Partial 也认）", async () => {
        ai.reply = "verdict: RIGHT\ncomment: ok";
        await expect(judgeBrief(q, "A", "m")).resolves.toMatchObject({ verdict: "right" });
        ai.reply = "Verdict: Partial\nComment: half";
        await expect(judgeBrief(q, "A", "m")).resolves.toMatchObject({ verdict: "partial" });
    });

    it("未按格式返回判定 → 抛错（调用方据此走「AI 判分失败」回落）", async () => {
        ai.reply = "这道题你做对了。";
        await expect(judgeBrief(q, "A", "m")).rejects.toThrow("AI 未按格式返回判定");
    });

    it("缺 COMMENT 行时评语为空串（不崩、不透 undefined）", async () => {
        ai.reply = "VERDICT: right";
        await expect(judgeBrief(q, "A", "m")).resolves.toMatchObject({ verdict: "right", comment: "" });
    });
});

describe("judgeBrief · COMMENT / SCORE / CAUSE 取用", () => {
    it("作文 SCORE 行并入评语前缀（分数 — 点评）", async () => {
        const essay = { ...q, type: QuestionType.Essay };
        ai.reply = "SCORE: 14/20\nVERDICT: partial\nCOMMENT: 论证偏薄";
        await expect(judgeBrief(essay, "my essay", "m")).resolves.toMatchObject({
            verdict: "partial",
            comment: "14/20 — 论证偏薄",
        });
    });

    it("无 SCORE 行时不加前缀", async () => {
        ai.reply = "VERDICT: wrong\nCOMMENT: 全错";
        await expect(judgeBrief(q, "B", "m")).resolves.toMatchObject({ comment: "全错" });
    });

    it("答错带 CAUSE 行：规范键沉淀（正文经 normalizeCause 模糊匹配）", async () => {
        ai.reply = "VERDICT: wrong\nCOMMENT: 看错条件\nCAUSE: 审题漏条件";
        await expect(judgeBrief(q, "B", "m")).resolves.toMatchObject({ cause: "misread" });
    });

    it("答对不带 cause（即便 AI 硬填了 CAUSE 行）", async () => {
        ai.reply = "VERDICT: right\nCOMMENT: 好\nCAUSE: 审题";
        const v = await judgeBrief(q, "A", "m");
        expect(v.cause).toBeUndefined();
    });

    it("CAUSE 为「无」或空时不带 cause（半对/错也不该凭空归类）", async () => {
        ai.reply = "VERDICT: wrong\nCOMMENT: 错\nCAUSE: 无";
        expect((await judgeBrief(q, "B", "m")).cause).toBeUndefined();
        ai.reply = "VERDICT: partial\nCOMMENT: 半对";
        expect((await judgeBrief(q, "B", "m")).cause).toBeUndefined();
    });
});

describe("judgeBrief · prompt 组装（纯部分）", () => {
    const prompts = (qd: WenguQuestion, mine: string, thought = ""): string => buildBriefPrompt(qd, mine, thought);

    it("题干/答案/作答三段都进 prompt，答案缺失有兜底文案", () => {
        const p = prompts(q, "我选 B");
        expect(p).toContain("下列 极限  计算正确的是？");
        expect(p).toContain("【参考答案】\nA"); // 无解析时只有答案
        expect(p).toContain("【学生作答】\n我选 B");
        expect(prompts({ ...q, answer: "", solutionMd: "" }, "x")).toContain("（无参考答案）");
    });

    it("解析有值时与答案一起进参考答案块", () => {
        expect(prompts(q, "x")).toContain("【参考答案】\nA\n\n等价无穷小。");
    });

    it("thought 非空才追加思路块", () => {
        expect(prompts(q, "x", "先通分再约分")).toContain("【学生思路备注】\n先通分再约分");
        expect(prompts(q, "x")).not.toContain("【学生思路备注】");
    });
});

describe("attributeWrongCauses · 批量归因", () => {
    const items: CauseItem[] = [
        { qid: "q1", stem: "题一", mine: "B", answer: "A" },
        { qid: "q2", stem: "题二", mine: "C", answer: "D" },
    ];

    it("JSON 形态：序号 → 题目下标错位映射（1 起）", async () => {
        ai.reply = '{"1":"概念混淆","2":"计算失误"}';
        const out = await attributeWrongCauses(items, "m");
        expect(out.get("q1")).toBe("concept");
        expect(out.get("q2")).toBe("calc");
        expect(out.size).toBe(2);
    });

    it("JSON 带前后闲聊文字也能取出对象", async () => {
        ai.reply = '好的，分析如下：\n{"2":"看错"}\n以上。';
        const out = await attributeWrongCauses(items, "m");
        expect(out.get("q2")).toBe("misread");
        expect(out.has("q1")).toBe(false);
    });

    it('JSON 坏掉回落正则对（"1": "…" 形态）', async () => {
        ai.reply = '{1: "方法选错", 2: "公式记错"}';
        const out = await attributeWrongCauses(items, "m");
        expect(out.get("q1")).toBe("method");
        expect(out.get("q2")).toBe("formula");
    });

    it("越界序号/无对应题/「无」一律丢弃（不静默错挂到别的题上）", async () => {
        ai.reply = '{"1":"无","3":"概念混淆","2":""}';
        const out = await attributeWrongCauses(items, "m");
        expect(out.size).toBe(0);
    });

    it("完全无法解析时返回空表（收卷不因归因失败而崩）", async () => {
        ai.reply = "我无法判断。";
        expect((await attributeWrongCauses(items, "m")).size).toBe(0);
    });
});

describe("归因输入行的竖线归属（Issue #143 P3-5）", () => {
    it("prompt 明说竖线按位置切分、题干内的竖线是内容", () => {
        const p = wrongCausesPrompt("1|求 $|x|$ 的导数|B|A");
        expect(p).toContain("竖线按**位置**切分");
        expect(p).toContain("题干（如绝对值 $|x|$、条件分隔）或答案里出现的竖线属于**内容**，不是分隔符");
    });

    it("题干带竖线时仍逐行原样拼入（拼行侧不转义，归属由 prompt 声明）", () => {
        // 契约：拼行侧保持既有 `编号|题干|我的|正确` 形态不变，竖线不转义
        // ——转义会动拼行约定并让 AI 面对 \| 这种陌生形态，故口径在 prompt
        const p = wrongCausesPrompt("1|求 $|x|$ 的导数|B|A\n2|普通题|C|D");
        expect(p).toContain("1|求 $|x|$ 的导数|B|A");
        expect(p).toContain("2|普通题|C|D");
        expect(p).not.toContain("\\|");
    });

    it("归因调用把该 prompt 原样发出（接线不改）", async () => {
        ai.reply = '{"1":"计算失误"}';
        await attributeWrongCauses([{ qid: "q1", stem: "求 $|x|$ 的导数", mine: "B", answer: "A" }], "m");
        const { agentChatOnce } = await import("../../ai/client");
        expect(vi.mocked(agentChatOnce).mock.calls.at(-1)?.[0]).toContain("竖线按**位置**切分");
    });
});
