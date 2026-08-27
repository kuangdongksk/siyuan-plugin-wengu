import { describe, expect, it } from "vitest";
import { CHAT_MAX_TURNS, ChatStore, DEFAULT_CHAT_KEY } from "./ChatStore";
import type { ChatTurn } from "../rules/Prompt";

/** 内存版 loadRaw/saveRaw（saveRaw 落的数据能被新实例 loadRaw 读回）。 */
function memStore() {
    let data: unknown = undefined;
    const saved: Record<string, ChatTurn[]>[] = [];
    return {
        saved,
        loadRaw: async (): Promise<unknown> => data,
        saveRaw: async (v: Record<string, ChatTurn[]>): Promise<unknown> => {
            saved.push(JSON.parse(JSON.stringify(v)) as Record<string, ChatTurn[]>);
            data = JSON.parse(JSON.stringify(v));
            return undefined;
        },
    };
}

const t = (role: "user" | "ai", text: string): ChatTurn => ({ role, text });
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("ChatStore 学伴聊天分份持久", () => {
    it("各学伴历史互不串（id 隔离，默认学伴=default key）", async () => {
        const m = memStore();
        const s = new ChatStore(m.loadRaw, m.saveRaw);
        await s.turnsOf("warmup"); // 触发 hydrate（空数据）
        s.put("a", [t("user", "hi-a")]);
        s.put(DEFAULT_CHAT_KEY, [t("user", "hi-default")]);
        await tick();
        expect(await s.turnsOf("a")).toEqual([t("user", "hi-a")]);
        expect(await s.turnsOf(DEFAULT_CHAT_KEY)).toEqual([t("user", "hi-default")]);
        expect(m.saved[m.saved.length - 1]).toEqual({
            a: [t("user", "hi-a")],
            [DEFAULT_CHAT_KEY]: [t("user", "hi-default")],
        });
    });

    it("每份截 CHAT_MAX_TURNS 轮", async () => {
        const m = memStore();
        const s = new ChatStore(m.loadRaw, m.saveRaw);
        const turns = Array.from({ length: CHAT_MAX_TURNS + 6 }, (_, i) => t("user", `m${i}`));
        s.put("a", turns);
        await tick();
        const got = await s.turnsOf("a");
        expect(got).toHaveLength(CHAT_MAX_TURNS);
        expect(got[0].text).toBe("m6");
        expect(got[got.length - 1].text).toBe(`m${CHAT_MAX_TURNS + 5}`);
    });

    it("drop 清残留（孤儿历史不落盘）", async () => {
        const m = memStore();
        const s = new ChatStore(m.loadRaw, m.saveRaw);
        s.put("a", [t("user", "x")]);
        s.put("b", [t("ai", "y")]);
        s.drop("a");
        await tick();
        expect(await s.turnsOf("a")).toEqual([]);
        expect(m.saved[m.saved.length - 1]).toEqual({ b: [t("ai", "y")] });
    });

    it("重启恢复：新实例从落盘数据读回同一份历史", async () => {
        const m = memStore();
        const s1 = new ChatStore(m.loadRaw, m.saveRaw);
        s1.put("a", [t("user", "hello"), t("ai", "hi")]);
        await tick();
        const s2 = new ChatStore(m.loadRaw, m.saveRaw);
        expect(await s2.turnsOf("a")).toEqual([t("user", "hello"), t("ai", "hi")]);
    });

    it("坏数据按空处理（老格式/损坏不崩）", async () => {
        const m = memStore();
        const bad = {
            a: "not-array",
            [DEFAULT_CHAT_KEY]: [
                { role: "ghost", text: "?" },
                { role: "user", text: "ok" },
            ],
        };
        await m.saveRaw(bad as unknown as Record<string, ChatTurn[]>);
        const s = new ChatStore(m.loadRaw, m.saveRaw);
        expect(await s.turnsOf("a")).toEqual([]);
        expect(await s.turnsOf(DEFAULT_CHAT_KEY)).toEqual([t("user", "ok")]);
    });

    it("老版本空串 key 迁到 default（默认学伴历史不丢、空串出盘）", async () => {
        const m = memStore();
        await m.saveRaw({ "": [t("user", "old")], [DEFAULT_CHAT_KEY]: [t("ai", "new")] });
        const s = new ChatStore(m.loadRaw, m.saveRaw);
        expect(await s.turnsOf(DEFAULT_CHAT_KEY)).toEqual([t("ai", "new"), t("user", "old")]);
        await tick();
        const last = m.saved[m.saved.length - 1];
        expect(last[""]).toBeUndefined();
        expect(last[DEFAULT_CHAT_KEY]).toEqual([t("ai", "new"), t("user", "old")]);
    });
});
