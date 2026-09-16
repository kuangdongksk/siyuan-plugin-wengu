import { describe, expect, it } from "vitest";
import { QuestionType as QT } from "../../../types";
import { chunkKramdown } from "../core/ConvertService";
import { isBlankSource } from "../run/ConvertBatch";
import { doneMessageOf, warnSuffixOf } from "../run/ConvertBatchTypes";

/**
 * 源文档切块是续跑断点的事实源（offset 持久化在进度记录里）：切分必须
 * 确定性、offset 单调、块文本与原文切片一一对应。
 */

describe("chunkKramdown", () => {
    it("空文档无块", () => {
        expect(chunkKramdown("")).toEqual([]);
        expect(chunkKramdown("   \n\n  ")).toEqual([]);
    });
    it("短文档单块，offset=0", () => {
        expect(chunkKramdown("一段短文本")).toEqual([{ text: "一段短文本", offset: 0 }]);
    });
    it("优先在 [半长, 全长] 窗口内的最后一个空行切", () => {
        const md = "A".repeat(3000) + "\n\n" + "B".repeat(3000);
        const chunks = chunkKramdown(md, 5000);
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toEqual({ text: "A".repeat(3000), offset: 0 });
        expect(chunks[1]).toEqual({ text: "B".repeat(3000), offset: 3002 });
    });
    it("无空行可切时按上限硬切，offset 连续覆盖全文", () => {
        const md = "A".repeat(12000);
        const chunks = chunkKramdown(md, 5000);
        expect(chunks.map((c) => c.text.length)).toEqual([5000, 5000, 2000]);
        expect(chunks.map((c) => c.offset)).toEqual([0, 5000, 10000]);
        for (const c of chunks) {
            expect(c.text).toBe(md.slice(c.offset, c.offset + c.text.length));
        }
        const last = chunks[chunks.length - 1];
        expect(last.offset + last.text.length).toBe(md.length);
    });
    it("切分确定性：同输入两次结果全等（续跑断点依赖）", () => {
        const md = Array.from({ length: 300 }, (_, i) => `第${i}段。`).join("\n\n");
        expect(chunkKramdown(md)).toEqual(chunkKramdown(md));
    });
});

/**
 * 源判空（Issue #42）：空壳文档的 kramdown 真身是「文档根 IAL + 空白」，
 * `trim()` 判不出空，会白烧一次 AI 才被回「不能出题」。isBlankSource 是
 * 读侧一次性视图（不改 kramdown 本体，不碰 questionHash 口径）。
 */
describe("isBlankSource", () => {
    it("空串 / 纯空白：空", () => {
        expect(isBlankSource("")).toBe(true);
        expect(isBlankSource("   \n\n  \t\n")).toBe(true);
    });

    it("空壳文档真身（根 IAL 孤行 + 空行）：判空（Issue #42 根因形态）", () => {
        expect(isBlankSource('{: id="20260912000001-root00"}\n\n')).toBe(true);
        expect(isBlankSource('{: id="20260912000002-mid000" type="doc" updated="20260912000000"}\n\n  \n')).toBe(true);
    });

    it("带引用前缀的 IAL 孤行同样计入残渣", () => {
        expect(isBlankSource('> {: id="20260912000003-mid001"}\n')).toBe(true);
    });

    it("有正文（哪怕只有一行、含空段落壳的文档）：不判空", () => {
        expect(isBlankSource('{: id="20260912000004-root01"}\n\n一、选择题\n')).toBe(false);
        expect(isBlankSource("第 1 题 求极限")).toBe(false);
    });

    it("围栏标记行不算正文（空代码块）：仍判空", () => {
        expect(isBlankSource('{: id="x"}\n```\n```\n')).toBe(true);
    });

    it("正文里的 IAL 只剥行、不误伤同行正文（本判定只回二值，不改文本）", () => {
        expect(isBlankSource('{: id="20260912000005-root02"}\n{: id="20260912000006-c0000"}A. 选项\n')).toBe(false);
    });
});

/**
 * 完成消息的四段自检警告拼接（Issue #148 抽出为纯函数）。
 *
 * 四段都是「静默成功但内容缺失」的兜底点名：插图缺失 / 批级空产出 /
 * 定位失败 / **悬空 group=prev**。抽出前这段拼接内联在 `convertDocBatched`
 * 的收口里，四条分支都测不到（该函数要 AI 与 IO）；抽成纯函数后逐分支锁死。
 */
describe("warnSuffixOf · 完成消息警告拼接（Issue #148）", () => {
    const T: Record<string, string> = {
        convertImagesMissing: "图片缺 {n}",
        convertBatchEmpty: "空批 {n}",
        convertAnchorLost: "定位 {n}",
        convertGroupDangling: "悬空 {n}",
    };
    const t = (k: string): string => T[k] ?? k;
    const zero = { missingImages: 0, emptyBatches: 0, anchorMiss: 0, danglingGroups: 0 };

    it("全零：空串（零值不产生空白前缀）", () => {
        expect(warnSuffixOf(t, zero)).toBe("");
    });

    it("悬空 group=prev 单独非零：点名并带计数（Issue #148 验收 3）", () => {
        expect(warnSuffixOf(t, { ...zero, danglingGroups: 5 })).toBe(" 悬空 5");
    });

    it("四段各自独立成段、顺序固定、前导空格各一", () => {
        expect(warnSuffixOf(t, { missingImages: 1, emptyBatches: 2, anchorMiss: 3, danglingGroups: 4 })).toBe(
            " 图片缺 1 空批 2 定位 3 悬空 4"
        );
    });

    it("中间段为零时不出现（只跳该段，不跳顺序）", () => {
        expect(warnSuffixOf(t, { ...zero, missingImages: 2, danglingGroups: 1 })).toBe(" 图片缺 2 悬空 1");
        expect(warnSuffixOf(t, { ...zero, emptyBatches: 1, anchorMiss: 1 })).toBe(" 空批 1 定位 1");
    });

    it("计数走 i18n 取词 + 占位符填空（不是硬编码文案）", () => {
        // 取词器给什么就用什么（本用例的 T 是替身）：填进去的是**真实计数**
        const en = (k: string): string =>
            (({ convertGroupDangling: "lost {n} question(s)" }) as Record<string, string>)[k] ?? k;
        expect(warnSuffixOf(en, { ...zero, danglingGroups: 7 })).toBe(" lost 7 question(s)");
        // 四段都走同一条 fmt 通道（缺键时 fmt 不动，故此处用 T 的替身补齐前三段）
        expect(warnSuffixOf(t, { missingImages: 1, emptyBatches: 2, anchorMiss: 3, danglingGroups: 4 })).toBe(
            " 图片缺 1 空批 2 定位 3 悬空 4"
        );
    });
});

/**
 * 完成消息拼装：主题（题型清单 · 知识点反链数）+ 警告尾巴两段咬合。
 * 「题型清单只在有题型时出现、知识点数只在 >0 时出现」是既有口径（抽
 * 出前后逐字节一致），本轮把两段的组合分支补齐锁死。
 */
describe("doneMessageOf · 完成消息两段咬合（Issue #148）", () => {
    const T: Record<string, string> = {
        convertTypeList: "题型：{types}",
        convertKnowCount: "挂知识点 {n} 题",
        convertGroupDangling: "悬空 {n}",
        typeSingle: "单选",
        typeCloze: "完形",
    };
    const t = (k: string): string => T[k] ?? k;
    const warn = { emptyBatches: 0, anchorMiss: 0, danglingGroups: 0 };
    const noMd = { src: "", out: "" };

    it("题型 + 知识点：两段以「 · 」相接", () => {
        expect(doneMessageOf(t, { types: [QT.Single, QT.Cloze], knowLinked: 3 }, noMd, warn)).toBe(
            "题型：单选、完形 · 挂知识点 3 题"
        );
    });

    it("零题型/零反链：主题段整段消失（不留空「 · 」）", () => {
        expect(doneMessageOf(t, { types: [], knowLinked: 0 }, noMd, warn)).toBe("");
        expect(doneMessageOf(t, { knowLinked: 0 }, noMd, warn)).toBe("");
        expect(doneMessageOf(t, { types: [QT.Single], knowLinked: 0 }, noMd, warn)).toBe("题型：单选");
        expect(doneMessageOf(t, { types: [], knowLinked: 2 }, noMd, warn)).toBe("挂知识点 2 题");
    });

    it("插图缺失在内部算（原料=源文/产出两段 markdown，调用方不拼计数）", () => {
        const T2: Record<string, string> = { ...T, convertImagesMissing: "缺图 {n}" };
        const t2 = (k: string): string => T2[k] ?? k;
        const src = "![](a.png)![](b.png)"; // 源里两张图
        const out = "![](a.png)"; // 产出只带回一张
        expect(doneMessageOf(t2, { knowLinked: 0 }, { src, out }, warn)).toBe(" 缺图 1");
        expect(doneMessageOf(t2, { knowLinked: 0 }, { src: out, out: src }, warn)).toBe(""); // 全带回
    });

    it("警告尾巴接在主题之后（悬空非零时点名）", () => {
        expect(doneMessageOf(t, { types: [QT.Cloze], knowLinked: 0 }, noMd, { ...warn, danglingGroups: 4 })).toBe(
            "题型：完形 悬空 4"
        );
        expect(doneMessageOf(t, { knowLinked: 0 }, noMd, { ...warn, danglingGroups: 1 })).toBe(" 悬空 1");
    });
});
