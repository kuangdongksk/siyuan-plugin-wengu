import { describe, expect, it } from "vitest";
import { QuestionType } from "../../types";
import { buildRegenPrompt, conceptPrompt, freeTagPrompt, variantPrompt, verifyPrompt } from "./gen";
import { TAG_MAX_CHARS } from "./common";

/**
 * 单题生成族 prompt 的口径（Issue #131 P1，20260915 审查）：**解析标记
 * 协议 `〔opt:X〕` 全链统一**——凡是产物会落库、会被展示层洗牌的链，
 * 解析里都不许留裸字母指代选项。
 *
 * 原先这条约定只挂在 `order` / `bank` 上，把加练（conceptPrompt）与变式
 * （variantPrompt）漏在链外：它们走**默认协议**（无 opts），AI 写裸字母
 * （按它自己输出的序位），而写库已不洗、展示层只重映射答案 ⇒ 这些新题
 * 一进卡解析字母就指错。缺省 true 后本文件把这条链锁住。
 *
 * 与 `protocol.test.ts` 的分工：那里锁 `protocolSpec` 本身（变体差异、
 * 裁剪口径）；这里锁**调用方拿到的最终 prompt**（谁带标记约定、谁不该带）。
 */

/** 标记约定的判据串（出现在协议 @@P sol 行下方，独占一行）。 */
const SOL_RULE_MARK = "选项引用约定";

describe("加练/变式链的解析标记约定（P1）", () => {
    it("conceptPrompt（概念辨析/加练）：带 〔opt:X〕 约定", () => {
        const p = conceptPrompt("幂函数", "", "幂函数小节正文");
        expect(p).toContain(SOL_RULE_MARK);
        expect(p).toContain("〔opt:X〕");
        expect(p).toContain("不得用裸字母指代选项");
        // 新造题的选项顺序口径仍是「正确项写最前」（与标记约定互不干扰）
        expect(p).toContain("正确项写在最前");
    });

    it("variantPrompt（知识点变式 / 按题变式）：带 〔opt:X〕 约定", () => {
        for (const type of [QuestionType.Single, QuestionType.Steps, undefined]) {
            const p = variantPrompt("原题 kramdown", "", type);
            expect(p).toContain(SOL_RULE_MARK);
            expect(p).toContain("〔opt:X〕");
        }
    });

    it("按题变式重练（generateVariantOf 的 prompt 同款路径）：同样带", () => {
        // generateVariantOf 直接调 variantPrompt，无额外包装——本断言即锁它
        const p = variantPrompt("原题", "", QuestionType.Multiple);
        expect(p).toContain("不得用裸字母指代选项");
    });

    it("regen（keep 序）：标记约定照旧在", () => {
        const p = buildRegenPrompt("原题 kd", "", "小节", "", QuestionType.Single, "keep");
        expect(p).toContain(SOL_RULE_MARK);
        expect(p).toContain("原题顺序与字母");
    });

    it("自检 prompt 不带标记约定（它不是出题协议，只是算一遍比对）", () => {
        // verifyPrompt 的入参是**已渲染的题目 kramdown**（标记早被 OptionRefReplace
        // 换成选项文本），它自身不该出现任何 `` 约定——否则 AI 会被要求写标记
        expect(verifyPrompt('{{{row\n题干\n}}}\n{: custom-plugin-wengu-q="1"}')).not.toContain(SOL_RULE_MARK);
    });
});

/**
 * Issue #143 P2-2 / P2-3 / P3-6：prompt 审计三条 P2 + 限长常量收口。
 * 分工：这里锁**产物文本**（备注出现次数、占位还原要求在不在场）；
 * ConvertService.test 锁逐段判定行数，companion.test 锁 LINE 限长。
 */
describe("buildRegenPrompt 备注去重（P2-2）", () => {
    it("备注全文恰好出现 1 次（原先要求段 + 模板尾各拼一遍）", () => {
        const note = "第 3 步答案错了，其余保留";
        const p = buildRegenPrompt("原题 kd", "原文块", "小节", note, QuestionType.Single, "keep");
        expect(p.split(note).length - 1).toBe(1);
        expect(p.split("【用户备注】").length - 1).toBe(1);
    });

    it("备注为空时整块不出现（不产生空标题）", () => {
        const p = buildRegenPrompt("原题 kd", "", "", "");
        expect(p).not.toContain("【用户备注】");
    });

    it("备注只在材料块之后出现一次——段落顺序不变（要求段仍在最前）", () => {
        const note = "MARK-备注-1";
        const p = buildRegenPrompt("原题 kd", "原文块", "", note);
        const noteAt = p.indexOf(note);
        // 备注块仍在开头导语之后、`要求：` 段之前（占位口径：改造前它在
        // 要求段与模板尾各一份，删掉的是**模板尾那份**）
        expect(noteAt).toBeGreaterThan(p.indexOf("请重出这一道题。"));
        expect(noteAt).toBeLessThan(p.indexOf("要求：输出与原题相同的题型结构"));
        // 模板尾不再挂备注：备注块之后紧接着的是 `要求：` 段
        expect(noteAt + note.length).toBeLessThan(p.indexOf("要求：输出与原题相同的题型结构"));
        expect(p.trimEnd().endsWith(note)).toBe(false);
        // 无补充材料时产物末尾就是原题 kramdown（模板尾曾是备注的落点）
        expect(buildRegenPrompt("原题 kd", "", "", note).trimEnd().endsWith("原题 kd")).toBe(true);
    });
});

describe("variantPrompt 插图占位还原（P2-3）", () => {
    it("带占位还原要求（与 buildRegenPrompt 同款文案在场）", () => {
        const p = variantPrompt("原题 kd", "", QuestionType.Single);
        // 发送侧 sanitizeAiImages 会把图片换成〔插图:…〕占位——不带还原
        // 要求时带图题走变式链图片静默丢失
        expect(p).toContain("〔插图:assets/…〕");
        expect(p).toContain("必须还原成标准 markdown 图片行");
        expect(p).toContain("不要原样输出占位");
    });

    it("题型未知（undefined 走全量兜底）时同样在场", () => {
        expect(variantPrompt("原题 kd", "")).toContain("不要原样输出占位");
    });
});

describe("自由标签限长收口（P3-6）", () => {
    it("prompt 要求值与常量同源（不再写死 12）", () => {
        const p = freeTagPrompt("1|题干");
        expect(p).toContain(`不超过 ${TAG_MAX_CHARS} 字`);
        expect(p).not.toContain("不超过 12 字");
    });
});
