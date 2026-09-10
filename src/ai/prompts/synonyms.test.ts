import { describe, expect, it } from "vitest";
import { parseSynReply, synJudgePrompt, SYN_BATCH_SIZE, SYN_MAX_CHARS } from "./synonyms";

describe("synJudgePrompt（批量同义判定）", () => {
    it("编号行带标签与候选清单；批量上限常量可用", () => {
        const p = synJudgePrompt([
            { label: "洛必达", titles: "洛必达法则 / L'Hôpital 法则" },
            { label: "导数", titles: "导数定义" },
        ]);
        expect(p).toContain("1|洛必达    ||    洛必达法则 / L'Hôpital 法则");
        expect(p).toContain("2|导数    ||    导数定义");
        expect(p).toContain("逐字抄写");
        expect(SYN_BATCH_SIZE).toBeGreaterThan(1);
    });

    it("空清单也能拼出合法 prompt", () => {
        expect(synJudgePrompt([])).toContain("候选：");
    });
});

describe("parseSynReply（判定行解析）", () => {
    it("规范写法逐字取回；『-』= 明确不同义（空串）", () => {
        const out = parseSynReply("1|洛必达法则\n2|-\n废话行");
        expect(out.get(1)).toBe("洛必达法则");
        expect(out.get(2)).toBe("");
        expect(out.size).toBe(2);
    });

    it("「同义/是/yes」记空串（规范词由调用方按清单侧标题定，不让 AI 造词）", () => {
        const out = parseSynReply("1|同义\n2|是\n3|YES\n4|same");
        expect(out.get(1)).toBe("");
        expect(out.get(2)).toBe("");
        expect(out.get(3)).toBe("");
        expect(out.get(4)).toBe("");
    });

    it("容错分隔符（全角｜冒号）与尾标点；编号重复者只收第一次", () => {
        const out = parseSynReply(" 1 ｜ 洛必达法则。 \n2：导数定义；\n1|覆盖");
        expect(out.get(1)).toBe("洛必达法则");
        expect(out.get(2)).toBe("导数定义");
    });

    it("超长规范词截断（防 AI 跑飞）", () => {
        const long = "概".repeat(60);
        expect(parseSynReply(`1|${long}`).get(1)?.length).toBe(SYN_MAX_CHARS);
    });

    it("空输出 / 非法编号 → 空映射", () => {
        expect(parseSynReply("没有合适项")).toEqual(new Map());
        expect(parseSynReply("0|洛必达\n-1|导数").size).toBe(0);
    });
});
