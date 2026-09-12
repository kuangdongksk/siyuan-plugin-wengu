import { describe, expect, it } from "vitest";
import { chunkKramdown } from "../core/ConvertService";
import { isBlankSource } from "../run/ConvertBatch";

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
