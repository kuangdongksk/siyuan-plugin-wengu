import { describe, expect, it } from "vitest";
import { parseSynReply, synJudgePrompt, SYN_BATCH_SIZE, SYN_DENY, SYN_LIST_CHARS, SYN_MAX_CHARS } from "./synonyms";
import { TAG_MAX_CHARS } from "./common";

describe("synJudgePrompt（批量同义判定）", () => {
    it("编号标签行 + **共用**编号小节清单；批量上限常量可用", () => {
        const p = synJudgePrompt(
            [{ label: "洛必达" }, { label: "导数" }],
            "1|洛必达法则\n2|L'Hôpital 法则",
            "知识点小节清单（编号|写法，候选写法）"
        );
        expect(p).toContain("1|洛必达\n2|导数");
        expect(p).toContain("1|洛必达法则\n2|L'Hôpital 法则");
        expect(p).toContain("只写清单里那一项的编号");
        expect(SYN_BATCH_SIZE).toBeGreaterThan(1);
        expect(SYN_LIST_CHARS).toBeGreaterThan(0);
    });

    it("空清单/空标签也能拼出合法 prompt", () => {
        expect(synJudgePrompt([], "", "知识点小节清单")).toContain("标签：");
    });
});

describe("parseSynReply（判定行解析，三态）", () => {
    it("编号逐字取回；『-』= 明确不同义（哨兵）", () => {
        const out = parseSynReply("1|3\n2|-\n废话行");
        expect(out.get(1)).toBe("3");
        expect(out.get(2)).toBe(SYN_DENY);
        expect(out.size).toBe(2);
    });

    it("「不同义/否/no」也是明确否；「同义/是/yes」= 说不清（空串，不落表）", () => {
        const out = parseSynReply("1|不同义\n2|否\n3|no\n4|同义\n5|是\n6|YES");
        expect(out.get(1)).toBe(SYN_DENY);
        expect(out.get(2)).toBe(SYN_DENY);
        expect(out.get(3)).toBe(SYN_DENY);
        expect(out.get(4)).toBe("");
        expect(out.get(5)).toBe("");
        expect(out.get(6)).toBe("");
    });

    it("容错分隔符（全角｜冒号）与尾标点；编号重复者只收第一次", () => {
        const out = parseSynReply(" 1 ｜ 3。 \n2：4；\n1|覆盖");
        expect(out.get(1)).toBe("3");
        expect(out.get(2)).toBe("4");
    });

    it("超长判定截断（防 AI 跑飞）", () => {
        const long = "概".repeat(60);
        expect(parseSynReply(`1|${long}`).get(1)?.length).toBe(SYN_MAX_CHARS);
    });

    it("空输出 / 非法编号 → 空映射（调用方按未判定处理）", () => {
        expect(parseSynReply("没有合适项")).toEqual(new Map());
        expect(parseSynReply("0|洛必达\n-1|导数").size).toBe(0);
    });
});

describe("限长口径收口（Issue #143 P3-6）", () => {
    it("SYN_MAX_CHARS 与 TAG_MAX_CHARS 同源（原先 30 与 24 各写一遍）", () => {
        expect(SYN_MAX_CHARS).toBe(TAG_MAX_CHARS);
    });

    it("超长截断按收口后的常量走", () => {
        expect(parseSynReply(`1|${"概".repeat(TAG_MAX_CHARS + 20)}`).get(1)?.length).toBe(TAG_MAX_CHARS);
    });
});
