import { beforeAll, describe, expect, it } from "vitest";

/**
 * 「复制整轮」钮的落点硬口径（Issue #124 需求 3，源级断言）：Svelte 组件不
 * 进单测（挂载内核不在范围内），但**钮必须长在轮次头**这条要防回归——放到
 * 展开态的块尾，收起行就取不到全轮（还得先展开），与需求 3 的「轮次头部」
 * 不符。源码经 vitest 的 `?raw` 导入（本仓无 @types/node，不用 node:fs，
 * 同 StartPanelApp 结构断言的口径）。
 */
describe("SessionDetail · 整轮复制钮的落点（Issue #124 需求 3）", () => {
    let src = "";

    beforeAll(async () => {
        src = (await import("../components/SessionDetail.svelte?raw")).default;
    });

    it("整轮复制钮在轮次头（展开块之前），不随行收起消失", () => {
        const btn = src.indexOf("wengu-aipanel-copyturn");
        const open = src.indexOf("{#if isOpen}");
        expect(btn).toBeGreaterThan(0);
        expect(open).toBeGreaterThan(0);
        // 钮必须在展开态条件块**之前**（轮次头一行里）
        expect(btn).toBeLessThan(open);
    });

    it("整轮钮直接吃 copyParts（整轮拼接），块级钮吃 copyText（单块）", () => {
        expect(src).toContain("turnText(row)");
        expect(src).toContain("seg.copyText");
        // 两个钮都在行头 click 容器内 ⇒ 都要拦住行开合
        expect(src.match(/e\.stopPropagation\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    });
});
