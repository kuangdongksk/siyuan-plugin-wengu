import { describe, expect, it } from "vitest";
import { parseTypes } from "../draft/ConvertDetect";

/**
 * 判定/预览的纯解析：TYPES 解析（题型化 prompt 的输入，中英别名容错、
 * 并集去重）。独立前置检测已于 20260910 退役（判定合并进首批生成），
 * COUNT 解析与分段计数测试随之删除。
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
