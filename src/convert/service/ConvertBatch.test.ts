import { describe, expect, it } from "vitest";
import { chunkKramdown } from "./ConvertService";

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
