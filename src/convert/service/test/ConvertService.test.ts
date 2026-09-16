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
    it("逐段模式首批：要求判定四行 + 题型 + @@TO 定位约定", () => {
        const p = buildPrompt("片段", false, false, "", "", undefined, { batch: 1, first: true });
        expect(p).toContain("TYPES:");
        expect(p).toContain("@@TO:");
        expect(p).toContain("第 1 批");
        expect(p).toContain("本批原文片段");
        expect(p).not.toContain("文档内容：");
    });

    it("首批判定行数自洽：正文说「四行」，verdictOf 就恰好产四行（P2-1）", () => {
        const p = buildPrompt("片段", false, false, "", "", undefined, { batch: 1, first: true });
        // 正文措辞（唯一权威宣称）：行数写错会让 SUBJECT 缺失静默退化学科判别
        expect(p).toContain("先输出四行判定");
        // 四个判定行键各出现一次；旧文案说「三行」而实发四行（含 SUBJECT）
        const KEYS = ["CAN_CONVERT:", "REASON:", "TYPES:", "SUBJECT:"];
        for (const k of KEYS) expect(p.split(k).length - 1, k).toBe(1);
        // 逐字锁「四行」与实际行键数一致：从正文抽出的数字 === 键数
        const claim = /先输出([一二三四五])行判定/.exec(p)?.[1];
        expect({ 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 }[claim ?? ""]).toBe(KEYS.length);
        // 缺省（非逐段）两行判定不受影响：只有 CAN_CONVERT / REASON
        const plain = buildPrompt("s");
        expect(plain).toContain("先输出两行判定");
        expect(plain).not.toContain("SUBJECT:");
        expect(plain.split("CAN_CONVERT:").length - 1).toBe(1);
    });

    it("逐段后续批次：免判定行里也点名 SUBJECT（四行口径全列）", () => {
        const p = buildPrompt("片段", false, false, "", "", [QT.Single], { batch: 3, first: false });
        expect(p).toContain("CAN_CONVERT / REASON / TYPES / SUBJECT");
    });

    it("公式记法规则：行内/块级各一律，\\(…\\) 与 \\[ \\] 都改写（P3-9）", () => {
        const p = buildPrompt("s");
        expect(p).toContain("公式行内一律 $...$，块级一律 $$...$$");
        expect(p).toContain("\\(...\\) 与 \\[ \\] 记法均改写");
        // 旧口径只禁块级，行内 \\(…\\) 会漏网
        expect(p).not.toContain("禁止使用 \\[ \\] 记法");
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

/**
 * Issue #148：英语真题聚合文档「题目分开了」的两条 prompt 口径。
 *
 * 真机实录：第 1 批片段只有文章正文（题目在后批），AI 判为讲义路径、
 * 自造 8 题且不出材料块；第 2 批 5 道真题全部写 group=prev 引用「文中
 * 紧邻其前的材料块」——引用悬空。根因是「一题对一题 vs 讲义出题」按
 * **单批片段**判定，AI 对「这是后面真题的材料」没有意识。
 *
 * 两条口径各锁一组行级断言：
 * ① 语篇判定（4.2）——文章正文即使本批无配套题也照出材料块、不得自造题；
 * ② 真题优先去重（4.1）——有现成真题时不得为同一语篇/考点再造题。
 * 另锁规则 7 的**悬空禁止**（本批之前没有材料块时要先补材料块）。
 */
describe("buildPrompt · 语篇材料块判定与真题优先（Issue #148）", () => {
    it("4.2 语篇判定：文章正文一律出材料块、明确禁止自造题", () => {
        const p = buildPrompt("s");
        expect(p).toContain("4.2 **语篇（文章正文）一律出材料块，不得自造题**");
        // 判定特征：真题风格来源行/标题
        for (const feat of ["Text 1", "Part A", "逐题细解", "逐句精讲"]) expect(p, feat).toContain(feat);
        // 「本片段没看到配套题目也必须出材料块」——这正是真机漏掉的判定
        expect(p).toContain("即使本片段没看到配套题目，也必须按材料输出");
        // 材料块协议与「不得自造题」同句
        expect(p).toContain("@@Q material=1 + @@P body");
        expect(p).toContain("绝不允许为它自造题");
        // 判定顺序（先认语篇、再看配套题）与规则 7 的挂靠口径对齐
        expect(p).toContain("先按特征认出语篇（本批即可出材料块），再看本批有没有配套真题");
        expect(p).toContain("小题写 group=prev 挂靠该材料块");
    });

    it("4.1 真题优先去重：有现成真题时不得为同一语篇/考点自造题", () => {
        const p = buildPrompt("s");
        expect(p).toContain("4.1 **真题优先（去重硬口径）**");
        expect(p).toContain("以真题为准");
        expect(p).toContain("**不得**再为同一语篇/同一考点自造题");
        // 自造题的适用面收窄到「完全没有现成题目的语篇/章节」（防误伤纯讲义）
        expect(p).toContain("自造题**只用于完全没有现成题目的语篇/章节**");
    });

    it("规则 7 悬空禁止：本批之前没有材料块时要先补材料块，不写裸 group", () => {
        const p = buildPrompt("s");
        expect(p).toContain("悬空禁止");
        expect(p).toContain("先补它的材料块（@@Q material=1 + @@P body）再写小题");
        expect(p).toContain("先材料、后小题");
        // 原口径不丢（分批时只有材料/只有题目仍照常输出）
        expect(p).toContain("分批转换时若本批只有材料没有题目、或只有题目没有材料，仍照常输出");
    });

    it("新口径不误伤纯讲义/纯习题册：第 4 条一题对一题与讲义出题原文口径仍在", () => {
        const p = buildPrompt("s");
        expect(p).toContain("必须**一题对一题**");
        expect(p).toContain("只有原文是讲义/笔记（无现成题目）时才按知识点出题");
    });
});
