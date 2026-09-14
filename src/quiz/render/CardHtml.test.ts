import { describe, expect, it } from "vitest";
import { renderMainShell } from "./CardHtml";
import type { MainShellModel } from "./CardHtml";

/**
 * 主壳渲染（Issue #81，Issue #83 改结构判据）：`.wengu-reading` 是
 * **阅读面作用域**类名——判定结果（整卷每段都有材料组）由调用方
 * （QuizShell）经 readingSegmentsOf/readingShellScope 传入，本层只做
 * 「有/无类名」的字符串契约（不挂时渲染产物与改造前逐字节一致）。
 */

const t = (k: string): string => k;

const model = (over: Partial<MainShellModel> = {}): MainShellModel => ({
    t,
    loading: false,
    loadError: "",
    started: true,
    previewing: false,
    hasDoc: true,
    listCount: 2,
    reading: false,
    cardsHtml: '<div class="wengu-card"></div>',
    numsHtml: "",
    ...over,
});

describe("renderMainShell · 阅读面作用域类名（结构判据，Issue #83）", () => {
    it("整卷每段含材料组：题卡列表带 .wengu-reading", () => {
        const html = renderMainShell(model({ reading: true }));
        expect(html).toContain('class="wengu-card-list wengu-reading"');
    });

    it("无材料组段：不带 .wengu-reading（逐字节等价于改造前）", () => {
        const html = renderMainShell(model({ reading: false }));
        expect(html).toContain('class="wengu-card-list"');
        expect(html).not.toContain("wengu-reading");
    });

    it("预览渐进态类名顺序不变：wengu-reading 在 wengu-previewing 之前", () => {
        const html = renderMainShell(model({ reading: true, previewing: true }));
        expect(html).toContain('class="wengu-card-list wengu-reading wengu-previewing"');
    });

    it("无材料组段预览态：只有 wengu-previewing（无阅读面）", () => {
        const html = renderMainShell(model({ reading: false, previewing: true }));
        expect(html).toContain('class="wengu-card-list wengu-previewing"');
        expect(html).not.toContain("wengu-reading");
    });

    it("开刷面板/加载/错误三态都不产题卡列表（作用域类名无从出现）", () => {
        for (const html of [
            renderMainShell(model({ reading: true, started: false })),
            renderMainShell(model({ reading: true, loading: true })),
            renderMainShell(model({ reading: true, loadError: "boom" })),
        ]) {
            expect(html).not.toContain("wengu-reading");
        }
    });
});
