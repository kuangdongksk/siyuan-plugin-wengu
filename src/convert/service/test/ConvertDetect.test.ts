import { describe, expect, it } from "vitest";
import { parseSubject, parseTypes } from "../draft/ConvertDetect";

/**
 * 判定/预览的纯解析：TYPES 解析（题型化 prompt 的输入，中英别名容错、
 * 并集去重）与 SUBJECT 学科解析（Issue #83，英语卷判别的**真实**输入）。
 * 独立前置检测已于 20260910 退役（判定合并进首批生成），COUNT 解析与
 * 分段计数测试随之删除。
 */

describe("parseTypes", () => {
    it("中英文混用解析并去重", () => {
        expect(parseTypes("TYPES: single,多选,判断\nCOUNT: 3")).toEqual(["single", "multiple", "judge"]);
        expect(parseTypes("TYPES: 作文、完形填空、翻译")).toEqual(["essay", "cloze", "trans"]);
        expect(parseTypes("TYPES: Brief/single/single")).toEqual(["brief", "single"]);
    });
    it("无 TYPES 行或全无法识别返回空数组", () => {
        expect(parseTypes("CAN_CONVERT: yes\nCOUNT: 1")).toEqual([]);
        expect(parseTypes("TYPES: 谜一样的东西")).toEqual([]);
    });
    it("首批三行判定形态（CAN/REASON/TYPES 同现）只取题型", () => {
        const reply = "CAN_CONVERT: yes\nREASON: 试卷题解，覆盖行列式与矩阵\nTYPES: 单选, 填空, 多步\n@@Q type=single";
        expect(parseTypes(reply)).toEqual(["single", "fill", "steps"]);
    });
});

describe("parseSubject 学科解析（Issue #83）", () => {
    it("首批四行形态取学科（含括号说明/斜杠并写时取首个学科名）", () => {
        const reply = [
            "CAN_CONVERT: yes",
            "REASON: 英语阅读理解训练卷",
            "TYPES: 单选",
            "SUBJECT: 英语",
            "@@Q type=single",
        ].join("\n");
        expect(parseSubject(reply)).toBe("英语");
        expect(parseSubject("SUBJECT: 英语（阅读理解）")).toBe("英语");
        expect(parseSubject("SUBJECT：数学/高数")).toBe("数学");
    });

    it("无 SUBJECT 行（非首批/旧格式）⇒ undefined=无学科", () => {
        expect(parseSubject("CAN_CONVERT: yes\nTYPES: 单选")).toBeUndefined();
    });

    it("占位「无」与空值 ⇒ undefined（题集不落假学科，判别回退题型并集）", () => {
        expect(parseSubject("SUBJECT: 无")).toBeUndefined();
        expect(parseSubject("SUBJECT: 未知")).toBeUndefined();
        expect(parseSubject("SUBJECT:   ")).toBeUndefined();
    });

    it("空的 SUBJECT 行不吃下一行（\\s* 会跨行，实为 [ \\t]*）", () => {
        // 真机踩坑形态：AI 写了 `SUBJECT:` 却不填值——用 \s* 时它把
        // 下一行 `@@Q ...` 当成学科名落进题集，判别被假学科锁死
        expect(parseSubject("SUBJECT:\n@@Q type=single knowledge=主旨")).toBeUndefined();
        expect(parseSubject("SUBJECT:   \n@@Q type=single")).toBeUndefined();
        expect(parseSubject("subject：\t\n@@Q")).toBeUndefined();
    });

    it("学科与题型各行互不串（SUBJECT 不吃 TYPES 行、反之亦然）", () => {
        const reply = "TYPES: 单选\nSUBJECT: 语文";
        expect(parseSubject(reply)).toBe("语文");
        expect(parseTypes(reply)).toEqual(["single"]);
    });
});
