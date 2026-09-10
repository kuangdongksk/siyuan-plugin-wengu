import { describe, expect, it } from "vitest";
import { autoSpeakSite, mayAutoSpeak } from "./TapSpeech";

describe("autoSpeakSite（自动播报落点）", () => {
    it("移动端落控制器同步栈（iOS 首播须在手势内），桌面落组件 $effect", () => {
        expect(autoSpeakSite(true)).toBe("enterPrompt");
        expect(autoSpeakSite(false)).toBe("effect");
    });
});

describe("mayAutoSpeak（是否自动播）", () => {
    it("听音题正面未作答 → 播", () => {
        expect(mayAutoSpeak("listen", true, false)).toBe(true);
    });

    it("非听音题 / 已翻面 / 已作答 → 不播", () => {
        expect(mayAutoSpeak("choiceEn", true, false)).toBe(false);
        expect(mayAutoSpeak("listen", false, false)).toBe(false);
        expect(mayAutoSpeak("listen", true, true)).toBe(false);
    });
});
