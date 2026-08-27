import { describe, expect, it } from "vitest";
import { buildPrompt, extractBatchQuestions, extractBlockId, isMaterialKramdown, parentOf } from "./ConvertService";

/**
 * 转换侧纯函数：AI 回复抽取与规整（真机高频偏差的兜底）、块 id 提取、
 * 路径帮手、prompt 开关。extractBatchQuestions 内部会洗牌——断言只锁
 * 规整不变量（q 归一/part 补引号/题干标签剥除/材料块保留），不锁字母。
 */

function questionBlock(over: { stem?: string; ial?: string } = {}): string {
    const stem = over.stem ?? "普通题干";
    return [
        "{{{row",
        stem,
        '{: custom-plugin-wengu-part="stem"}',
        "",
        "- 甲",
        '{: custom-plugin-wengu-part="option-0"}',
        "",
        "- 乙",
        '{: custom-plugin-wengu-part="option-1"}',
        "",
        "> A",
        '{: custom-plugin-wengu-part="answer"}',
        "",
        "解析文本",
        over.ial ?? '{: custom-plugin-wengu-part="solution"}',
        "}}}",
        '{: custom-plugin-wengu-q="2" custom-plugin-wengu-type="single" id="20260821165017-abcdef12"}',
    ].join("\n");
}

describe("extractBatchQuestions · AI 偏差规整", () => {
    it("q 属性自增归一回 1，容器 id IAL 保留（带 wengu 属性不剥）", () => {
        const out = extractBatchQuestions(`QUESTIONS:\n${questionBlock()}`);
        expect(out).toHaveLength(1);
        expect(out[0]).toContain('custom-plugin-wengu-q="1"');
        expect(out[0]).toContain("普通题干");
    });
    it("题干「题干A：」前缀标签剥除", () => {
        const out = extractBatchQuestions(questionBlock({ stem: "题干A：实际题干内容" }));
        expect(out[0]).toContain("实际题干内容");
        expect(out[0]).not.toContain("题干A：");
    });
    it("part 属性漏右引号自动补全", () => {
        const out = extractBatchQuestions(questionBlock({ ial: '{: custom-plugin-wengu-part="solution}' }));
        expect(out[0]).toContain('custom-plugin-wengu-part="solution"}');
    });
    it("材料块按出现顺序保留（不占题数但进结果）", () => {
        const material = [
            "{{{row",
            "阅读材料正文……",
            '{: custom-plugin-wengu-part="body"}',
            "}}}",
            '{: custom-plugin-wengu-material="1"}',
        ].join("\n");
        const out = extractBatchQuestions(`QUESTIONS:\n${material}\n${questionBlock()}`);
        expect(out).toHaveLength(2);
        expect(isMaterialKramdown(out[0])).toBe(true);
        expect(isMaterialKramdown(out[1])).toBe(false);
    });
    it("无题目块的回复返回空数组", () => {
        expect(extractBatchQuestions("这段回复没有任何题目。")).toEqual([]);
    });
});

describe("extractBlockId", () => {
    it("裸 id 原样返回", () => {
        expect(extractBlockId("20260821165017-6ivs5xm")).toBe("20260821165017-6ivs5xm");
    });
    it("siyuan:// 链接抽 id", () => {
        expect(extractBlockId("siyuan://blocks/20260821165017-6ivs5xm")).toBe("20260821165017-6ivs5xm");
    });
    it("无 id 时返回 trimmed 原文（由后续查询兜底）", () => {
        expect(extractBlockId("  随便文本 ")).toBe("随便文本");
    });
});

describe("parentOf", () => {
    it("按最后的 / 截断，根下回 /", () => {
        expect(parentOf("/a/b.sy")).toBe("/a");
        expect(parentOf("/a/b/c.sy")).toBe("/a/b");
        expect(parentOf("/x.sy")).toBe("/");
    });
});

describe("buildPrompt", () => {
    it("默认包含源内容与判分契约，不含填空转选择规则", () => {
        const p = buildPrompt("源内容XYZ");
        expect(p).toContain("源内容XYZ");
        expect(p).not.toContain("填空转选择");
    });
    it("fillToChoice 追加填空转选择规则", () => {
        expect(buildPrompt("s", true)).toContain("填空转选择");
    });
    it("bigToSteps 追加多步引导题格式", () => {
        expect(buildPrompt("s", false, true)).toContain("多步引导题");
    });
});
