import { describe, expect, it } from "vitest";
import { CompanionPanelCtl, type CompanionPanelDeps, type CompanionPanelSettings } from "./CompanionPanelCtl";
import { initialCompanionPanelUi } from "./CompanionPanelUi";
import { DEFAULT_CHAT_KEY } from "./ChatStore";
import type { CompanionProfile } from "./CompanionCtl";

function makeDeps(settings: Partial<CompanionPanelSettings> = {}) {
    let saved = 0;
    const removed: string[] = [];
    let activeChanged = 0;
    const s: CompanionPanelSettings = { save: () => saved++, ...settings };
    const d: CompanionPanelDeps = {
        t: (k) => (k === "companionDefaultName" ? "小书童" : k),
        settings: s,
        applySettings: () => {},
        reloadImages: () => {},
        onActiveChange: () => activeChanged++,
        onProfileRemoved: (id) => removed.push(id),
    };
    return {
        s,
        d,
        state: {
            get saved() {
                return saved;
            },
            removed,
            get activeChanged() {
                return activeChanged;
            },
        },
    };
}

const prof = (id: string, name: string): CompanionProfile => ({ id, name, prompt: "", imageDir: "", modelId: "" });

describe("CompanionPanelCtl 默认学伴物化与至少留一", () => {
    it("老数据物化：补 default 条目、activeId 空则归位", () => {
        const { s, d, state } = makeDeps({ companionProfiles: undefined, companionActiveId: undefined });
        const ctl = new CompanionPanelCtl(initialCompanionPanelUi(), d);
        expect(s.companionProfiles).toHaveLength(1);
        expect(s.companionProfiles?.[0]).toMatchObject({ id: DEFAULT_CHAT_KEY, name: "小书童" });
        expect(s.companionActiveId).toBe(DEFAULT_CHAT_KEY);
        expect(ctl.active()?.id).toBe(DEFAULT_CHAT_KEY);
        expect(state.saved).toBe(1);
        ctl.destroy();
    });

    it("activeId 悬空（指向已删条目）归位 default", () => {
        const { s, d } = makeDeps({
            companionProfiles: [prof(DEFAULT_CHAT_KEY, "小书童")],
            companionActiveId: "ghost",
        });
        const ctl = new CompanionPanelCtl(initialCompanionPanelUi(), d);
        expect(s.companionActiveId).toBe(DEFAULT_CHAT_KEY);
        ctl.destroy();
    });

    it("已物化数据不重复迁移（幂等不落盘）", () => {
        const { d, state } = makeDeps({
            companionProfiles: [prof(DEFAULT_CHAT_KEY, "小书童"), prof("b", "B")],
            companionActiveId: "b",
        });
        const ctl = new CompanionPanelCtl(initialCompanionPanelUi(), d);
        expect(d.settings.companionProfiles).toHaveLength(2);
        expect(state.saved).toBe(0);
        ctl.destroy();
    });

    it("仅剩一条时删除被拒（两击也不删）", () => {
        const { s, d, state } = makeDeps({ companionProfiles: [prof(DEFAULT_CHAT_KEY, "小书童")] });
        const ui = initialCompanionPanelUi();
        const ctl = new CompanionPanelCtl(ui, d);
        ctl.delClick();
        ctl.delClick();
        expect(s.companionProfiles).toHaveLength(1);
        expect(state.removed).toEqual([]);
        ctl.destroy();
    });

    it("删当前条目：切到剩余第一条并清残留", () => {
        const { s, d, state } = makeDeps({
            companionProfiles: [prof(DEFAULT_CHAT_KEY, "小书童"), prof("b", "B")],
            companionActiveId: "b",
        });
        const ui = initialCompanionPanelUi();
        const ctl = new CompanionPanelCtl(ui, d);
        ctl.delClick(); // 首击进确认态
        ctl.delClick(); // 再击执行
        expect(s.companionProfiles).toHaveLength(1);
        expect(s.companionProfiles?.[0]?.id).toBe(DEFAULT_CHAT_KEY);
        expect(s.companionActiveId).toBe(DEFAULT_CHAT_KEY);
        expect(ctl.active()?.id).toBe(DEFAULT_CHAT_KEY);
        expect(state.removed).toEqual(["b"]);
        expect(state.activeChanged).toBe(1);
        ctl.destroy();
    });

    it("saveNow：DOM 收值直写落盘并亮「已保存」反馈", () => {
        const { s, d, state } = makeDeps({
            companionProfiles: [prof(DEFAULT_CHAT_KEY, "小书童")],
            companionActiveId: DEFAULT_CHAT_KEY,
        });
        const ui = initialCompanionPanelUi();
        const ctl = new CompanionPanelCtl(ui, d);
        const before = state.saved;
        ctl.saveNow({ name: "  小书童改  ", prompt: "新提示词", imageDir: "" });
        expect(s.companionProfiles![0]).toMatchObject({ name: "小书童改", prompt: "新提示词" });
        expect(state.saved).toBe(before + 1);
        expect(ui.savedFlash).toBe(true);
        expect(ui.profiles[0]!.name).toBe("小书童改"); // syncList 镜像同步
        ctl.destroy();
    });
});
