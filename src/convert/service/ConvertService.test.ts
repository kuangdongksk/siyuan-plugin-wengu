import { describe, expect, it } from "vitest";
import { buildPrompt, extractBlockId, isMaterialKramdown } from "./ConvertService";

/**
 * 转换侧纯函数：块 id 提取、prompt 开关（AI 回复解析与
 * kramdown 渲染在 QuestionDraft.test / OptionShuffle.test 覆盖——
 * 20260902 行协议重构后 extractBatchQuestions 整体退役；20260903 起
 * 落文档通道（resolveTarget/createExerciseDoc 等）随「不落文档」退役）。
 */

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

describe("isMaterialKramdown", () => {
    it("材料容器标记识别", () => {
        expect(isMaterialKramdown('{: custom-plugin-wengu-material="1"}')).toBe(true);
        expect(isMaterialKramdown('{: custom-plugin-wengu-q="1"}')).toBe(false);
    });
});

describe("buildPrompt", () => {
    it("默认包含源内容与行协议标记，不含填空转选择规则", () => {
        const p = buildPrompt("源内容XYZ");
        expect(p).toContain("源内容XYZ");
        expect(p).toContain("@@Q type=");
        expect(p).toContain("CAN_CONVERT: yes 或 no");
        expect(p).not.toContain("填空转选择");
    });
    it("fillToChoice 追加填空转选择规则", () => {
        expect(buildPrompt("s", true)).toContain("填空转选择");
    });
    it("bigToSteps 追加多步引导题格式与示例", () => {
        expect(buildPrompt("s", false, true)).toContain("大题拆多步");
        expect(buildPrompt("s", false, true)).toContain("@@P step-opt");
    });
    it("knowRule/knowList 追加到文末知识点清单", () => {
        const p = buildPrompt("s", false, false, "\n标注规则", "\n\n知识点清单：\nK1|极限");
        expect(p).toContain("标注规则");
        expect(p).toContain("K1|极限");
    });
});
