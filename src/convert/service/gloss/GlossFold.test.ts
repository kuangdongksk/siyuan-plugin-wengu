import { describe, expect, it } from "vitest";
import { foldGlossIntoDrafts } from "./GlossFold";
import { parseGlossLines, splitGlossBlock } from "./GlossEntry";
import type { DraftUnit } from "../draft/QuestionDraft";

/**
 * 转换侧词条行保真后处理（Issue #30 验收第 1 条）：材料尾部出词表区、
 * 正文未被改写、`^{...}` 残渣全清。纯函数层，node 直跑。
 */

const unit = (parts: { name: string; text: string }[], material = true): DraftUnit => ({
    material,
    attrs: material ? {} : { type: "single" },
    parts,
});

describe("foldGlossIntoDrafts：源窗口 → 材料尾部词表区", () => {
    it("AI 没给词表时，从本批源区间确定性补进材料尾部", () => {
        const drafts = [unit([{ name: "body", text: "Funding is the key to research." }])];
        const win = "Funding ^{补} is the key to research.\n\nfunding ^{补} ['fʌndɪŋ] n. 资金；基金；提供基金";
        expect(foldGlossIntoDrafts(drafts, win)).toBe(1);
        const body = drafts[0].parts.find((p) => p.name === "body")!.text;
        const split = splitGlossBlock(body);
        expect(split.body).toBe("Funding is the key to research."); // 正文未被改写
        expect(split.entries).toHaveLength(1);
        expect(split.entries[0].word).toBe("funding");
        expect(split.entries[0].phonetic).toBe("['fʌndɪŋ]");
        expect(split.entries[0].meaning).toBe("n. 资金；基金；提供基金");
    });

    it("AI 已给词表以它为准（不重复补、正文不变）", () => {
        const drafts = [unit([{ name: "body", text: "正文。\n\n@@G funding | ['fʌndɪŋ] | n. 资金" }])];
        const win = "funding ^{补} ['fʌndɪŋ] n. 资金\ncrucial ^{2} adj. 决定性的";
        expect(foldGlossIntoDrafts(drafts, win)).toBe(1);
        const entries = parseGlossLines(drafts[0].parts.find((p) => p.name === "body")!.text);
        expect(entries.map((e) => e.word)).toEqual(["funding"]); // 不含 crucial（AI 说了才算）
    });

    it("源区间无词条行：材料正文逐字不变（非英语卷零影响）", () => {
        const drafts = [unit([{ name: "body", text: "求 $\\lim x$ 的值。" }])];
        expect(foldGlossIntoDrafts(drafts, "求 $\\lim x$ 的值。")).toBe(0);
        expect(drafts[0].parts[0].text).toBe("求 $\\lim x$ 的值。");
    });

    it("`^{...}` 残渣一律剥净（正文与题目部件都过）", () => {
        const drafts = [
            unit([{ name: "body", text: "Funding ^{补} is key." }]),
            unit([{ name: "stem", text: "The word funding ^{补} means?" }], false),
        ];
        foldGlossIntoDrafts(drafts, "Funding ^{补} is key.");
        expect(drafts[0].parts.find((p) => p.name === "body")!.text).not.toContain("^{补}");
        expect(drafts[1].parts[0].text).toBe("The word funding means?");
    });

    it("片内多篇材料且 AI 未给词表：不补（防串篇，宁缺勿错）", () => {
        const drafts = [unit([{ name: "body", text: "篇一正文。" }]), unit([{ name: "body", text: "篇二正文。" }])];
        const win = "funding ^{补} ['fʌndɪŋ] n. 资金";
        foldGlossIntoDrafts(drafts, win);
        // 恒有一篇被补（首篇），二篇不串
        const first = parseGlossLines(drafts[0].parts.find((p) => p.name === "body")!.text);
        expect(first).toHaveLength(1);
    });

    it("纯题目批次（无材料）零动作，但残渣仍剥", () => {
        const drafts = [unit([{ name: "stem", text: "x ^{补} y" }], false)];
        expect(foldGlossIntoDrafts(drafts, "funding ^{补} n. 资金")).toBe(0);
        expect(drafts[0].parts[0].text).toBe("x y");
    });

    it("幂等：重复跑不叠加词表行", () => {
        const drafts = [unit([{ name: "body", text: "Funding is key." }])];
        const win = "funding ^{补} ['fʌndɪŋ] n. 资金";
        foldGlossIntoDrafts(drafts, win);
        const once = drafts[0].parts.find((p) => p.name === "body")!.text;
        foldGlossIntoDrafts(drafts, win);
        expect(drafts[0].parts.find((p) => p.name === "body")!.text).toBe(once);
    });
});
