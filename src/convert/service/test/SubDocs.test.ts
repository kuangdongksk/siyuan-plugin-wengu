import { describe, expect, it } from "vitest";
import { buildBatchQueue, isBatchQueue, type SubDocPlan } from "../source/SubDocs";

/**
 * 批量转换队列组装（Issue #37）：纯函数口径——勾选「连同子文档」=根+后代；
 * 文件夹式文档（根空）在不勾选时也自动展开为只跑后代，避免对空根白跑一趟
 * 报「文档内容为空」。isBatchQueue 定「是否真起队列」。
 */

const root = { id: "20260828145729-djgn748", title: "肖秀荣1000题-题解版" };
const kids = [
    { id: "20260828145730-aaaaaaaa", title: "01-马原-题解" },
    { id: "20260828145731-bbbbbbbb", title: "02-毛中特-题解" },
];

describe("isBatchQueue", () => {
    it("多篇：起队列", () => {
        expect(isBatchQueue([root, ...kids], root.id)).toBe(true);
    });

    it("单篇且就是源自身：不起队列（与单篇流程等价）", () => {
        expect(isBatchQueue([root], root.id)).toBe(false);
    });

    it("空队列：不起队列（回落单篇，把报错交给它）", () => {
        expect(isBatchQueue([], root.id)).toBe(false);
    });

    it("单篇但**不是**源自身：起队列（空壳文件夹只有 1 个子文档，转的必须是子文档）", () => {
        expect(isBatchQueue([kids[0]], root.id)).toBe(true);
    });
});

describe("buildBatchQueue", () => {
    it("勾选「连同子文档」：根在前 + 全部后代", () => {
        const plan: SubDocPlan = { root, children: kids, rootEmpty: false };
        expect(buildBatchQueue(plan, true).map((d) => d.id)).toEqual([root.id, kids[0].id, kids[1].id]);
    });

    it("未勾选且根非空：只跑根自身", () => {
        const plan: SubDocPlan = { root, children: kids, rootEmpty: false };
        expect(buildBatchQueue(plan, false).map((d) => d.id)).toEqual([root.id]);
    });

    it("文件夹式文档（根空）：未勾选也自动展开为只跑后代", () => {
        const plan: SubDocPlan = { root, children: kids, rootEmpty: true };
        expect(buildBatchQueue(plan, false).map((d) => d.id)).toEqual([kids[0].id, kids[1].id]);
    });

    it("空根且勾选连带：不把空根塞进队列（零产物白跑一趟）", () => {
        const plan: SubDocPlan = { root, children: kids, rootEmpty: true };
        expect(buildBatchQueue(plan, true).map((d) => d.id)).toEqual([kids[0].id, kids[1].id]);
    });

    it("空根且无后代：空队列（调用方回落单篇流程，报「文档内容为空」）", () => {
        const plan: SubDocPlan = { root, children: [], rootEmpty: true };
        expect(buildBatchQueue(plan, true)).toEqual([]);
        expect(buildBatchQueue(plan, false)).toEqual([]);
    });

    it("根非空但无后代：未勾选=只根；勾选也=只根（无后代可带）", () => {
        const plan: SubDocPlan = { root, children: [], rootEmpty: false };
        expect(buildBatchQueue(plan, false).map((d) => d.id)).toEqual([root.id]);
        expect(buildBatchQueue(plan, true).map((d) => d.id)).toEqual([root.id]);
    });
});
