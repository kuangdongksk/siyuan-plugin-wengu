import { describe, expect, it } from "vitest";
import { isHeadingOnlyChunk } from "../source/HeadingChunk";

describe("isHeadingOnlyChunk（纯标题块）", () => {
    it("只有标题行/空白=纯标题块（章标题下直接挂子标题的层级）", () => {
        expect(isHeadingOnlyChunk("## 随机事件和概率")).toBe(true);
        expect(isHeadingOnlyChunk("## 随机事件和概率\n\n### 习题256\n\n# 文档总标题")).toBe(true);
    });
    it("有任何非标题正文=可出题块", () => {
        expect(isHeadingOnlyChunk("## 章\n正文内容")).toBe(false);
        expect(isHeadingOnlyChunk("## 章\n### 习题1\n某系统中有三个元件")).toBe(false);
    });
    it("空文本=纯标题块（跳过无害）", () => {
        expect(isHeadingOnlyChunk("")).toBe(true);
        expect(isHeadingOnlyChunk("   \n\n  ")).toBe(true);
    });
});
