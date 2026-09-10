import { describe, expect, it } from "vitest";
import { buildPrompt } from "../../../ai/prompts/convert";
import { QuestionType as QT } from "../../../types";
import { extractBlockId, isMaterialKramdown } from "../core/ConvertService";

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
    it("题型化：只带在场题型的约定，英语四类规则裁剪（数学卷无背景噪音）", () => {
        const p = buildPrompt("s", false, false, "", "", [QT.Single, QT.Multiple]);
        expect(p).toContain("type 只取 single/multiple/brief");
        expect(p).toContain("单选写字母如 B");
        expect(p).not.toContain('完形填空用 type="cloze"');
        expect(p).not.toContain("slot-opt、@@P slot-ans");
        expect(p).toContain("阅读文章等共用语篇"); // 材料组示例收缩
        expect(p).not.toContain("多步引导题（type=steps）");
    });
    it("题型化：英语四类在场时体现对应约定与逐步部件", () => {
        const p = buildPrompt("s", false, false, "", "", [QT.Cloze, QT.Essay]);
        expect(p).toContain('完形填空用 type="cloze"');
        expect(p).toContain("slot-opt、@@P slot-ans");
        expect(p).toContain("作文省略 @@P ans，解析写范文");
        expect(p).not.toContain("多步引导题（type=steps）");
        expect(p).toContain("阅读文章、完形语篇、翻译原文、新题型文章");
    });
    it("fillToChoice/bigToSteps 开关开启时其产出题型加入规则（显式设置不受检测影响）", () => {
        const p = buildPrompt("s", true, true, "", "", [QT.Fill]);
        expect(p).toContain("type 只取 single/fill/brief/steps");
        expect(p).toContain("填空转选择");
        expect(p).toContain("多步引导题（type=steps）");
    });
    it("逐段模式首批：要求判定三行 + 题型 + @@TO 定位约定", () => {
        const p = buildPrompt("片段", false, false, "", "", undefined, { batch: 1, first: true });
        expect(p).toContain("TYPES:");
        expect(p).toContain("@@TO:");
        expect(p).toContain("第 1 批");
        expect(p).toContain("本批原文片段");
        expect(p).not.toContain("文档内容：");
    });
    it("逐段模式后续批次：免判定行，仍带定位约定", () => {
        const p = buildPrompt("片段", false, false, "", "", [QT.Single], { batch: 3, first: false });
        expect(p).not.toContain("TYPES:");
        expect(p).toContain("@@TO:");
        expect(p).toContain("第 3 批");
        expect(p).toContain("不需要输出 CAN_CONVERT");
    });
    it("缺省 step 不带逐段约定（增量重转换 prompt 保持旧语义）", () => {
        const p = buildPrompt("s");
        expect(p).not.toContain("@@TO:");
        expect(p).not.toContain("本批原文片段");
        expect(p).toContain("文档内容：");
    });
});
