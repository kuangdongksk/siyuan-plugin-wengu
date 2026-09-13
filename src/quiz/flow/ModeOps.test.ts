import { describe, expect, it } from "vitest";
import { enterReviewFor } from "./ModeOps";
import type { QuizView } from "../index";
import { reviewCtl } from "../../review/core/ReviewCtl";

/**
 * 复习模式入口的**调用次序**（Issue #44「回顾」真机坑）：壳渲染是
 * workspace 优先——非 drill 工作区时 renderQuizShellFor 直接出工作区面板
 * 并早退，复习主区根本不渲染。相关题弹窗的行入口就在知识文档工作区，
 * 故 enterReviewFor 必须先切回 drill 再切 mode，否则点了像死钮。
 */

function trackView(log: string[]): QuizView {
    return {
        switchWorkspace: (ws: string): void => void log.push(`ws:${ws}`),
        switchMode: (m: string): void => void log.push(`mode:${m}`),
    } as unknown as QuizView;
}

describe("enterReviewFor 调用次序", () => {
    it("先回 drill 工作区、再切 review 模式（否则复习主区不渲染）", () => {
        const log: string[] = [];
        enterReviewFor(trackView(log), { qids: ["q1", "q2"] });
        expect(log).toEqual(["ws:drill", "mode:review"]);
        expect(reviewCtl.qidFilterNow()?.size).toBe(2); // qids 已进筛选维度
        reviewCtl.clearQidFilter();
    });

    it("qids 缺省不误开筛选（右键文档预筛路径行为不变）", () => {
        const log: string[] = [];
        enterReviewFor(trackView(log), {});
        expect(log).toEqual(["ws:drill", "mode:review"]);
        expect(reviewCtl.qidFilterNow()).toBeUndefined();
    });
});
