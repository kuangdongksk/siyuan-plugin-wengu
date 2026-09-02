import { describe, expect, it } from "vitest";
import {
    AI_INTERRUPTED,
    AI_SESSION_KIND_CAP,
    AI_SESSIONS_CAP,
    AiSessionStore,
    type AiSessionsData,
} from "./AiSessions";

/** 内存版 loadRaw/saveRaw（落的数据能被新实例读回；saved 留全部快照）。 */
function memStore(initial?: unknown) {
    let data: unknown = initial;
    const saved: AiSessionsData[] = [];
    return {
        saved,
        loadRaw: async (): Promise<unknown> => data,
        saveRaw: async (v: AiSessionsData): Promise<unknown> => {
            saved.push(JSON.parse(JSON.stringify(v)) as AiSessionsData);
            data = JSON.parse(JSON.stringify(v));
            return undefined;
        },
    };
}

const rec = (id: string, kind: string, createdAt: number, status: "running" | "done" | "error" = "done") => ({
    id,
    kind,
    title: `t-${id}`,
    model: "m1",
    createdAt,
    endedAt: createdAt + 1,
    status,
    turns: [{ role: "user" as const, text: "q" }],
});

describe("AiSessionStore 登记簿", () => {
    it("begin→succeed 生命周期：running 首轮 user，成功追加 ai 轮并收口", () => {
        const s = new AiSessionStore(memStore().loadRaw, memStore().saveRaw);
        s.begin("s1", "judge", "判题 · 题", "m1", "prompt");
        let list = s.list();
        expect(list[0].status).toBe("running");
        expect(list[0].turns).toEqual([{ role: "user", text: "prompt" }]);
        s.succeed("s1", "reply");
        list = s.list();
        expect(list[0].status).toBe("done");
        expect(list[0].endedAt).toBeTypeOf("number");
        expect(list[0].turns).toEqual([
            { role: "user", text: "prompt" },
            { role: "ai", text: "reply" },
        ]);
    });

    it("fail 记错误消息；succeed 对已失败记录不生效（防错序双写）", () => {
        const s = new AiSessionStore(memStore().loadRaw, memStore().saveRaw);
        s.begin("s1", "judge", "t", "m1", "q");
        s.fail("s1", "超时");
        s.succeed("s1", "late");
        const r = s.list()[0];
        expect(r.status).toBe("error");
        expect(r.error).toBe("超时");
        expect(r.turns).toHaveLength(1);
    });

    it("重载恢复：盘上 running 一律改判 interrupted；快照读回排序头新尾旧", async () => {
        const m = memStore({
            version: 1,
            items: [rec("old", "convert", 100), rec("run", "judge", 200, "running"), rec("new", "tag", 300)],
        });
        const s = new AiSessionStore(m.loadRaw, m.saveRaw);
        await s.ready();
        const list = s.list();
        expect(list.map((r) => r.id)).toEqual(["new", "run", "old"]);
        const run = list.find((r) => r.id === "run")!;
        expect(run.status).toBe("error");
        expect(run.error).toBe(AI_INTERRUPTED);
    });

    it("坏数据按空表处理（形态不对不崩）", async () => {
        const s = new AiSessionStore(
            async () => "garbage",
            async () => undefined
        );
        await s.ready();
        expect(s.list()).toEqual([]);
    });

    it("appendTurns 继续追问：user/ai 轮按序追加到原记录", () => {
        const s = new AiSessionStore(memStore().loadRaw, memStore().saveRaw);
        s.begin("s1", "judge", "t", "m1", "q1");
        s.succeed("s1", "a1");
        s.appendTurns("s1", { role: "user", text: "q2" }, { role: "ai", text: "a2" });
        expect(s.peek("s1")!.turns.map((t) => `${t.role}:${t.text}`)).toEqual(["user:q1", "ai:a1", "user:q2", "ai:a2"]);
    });

    it("单类别上限：judge 超额淘汰最旧，别类记录不受冲刷", () => {
        const s = new AiSessionStore(memStore().loadRaw, memStore().saveRaw);
        for (let i = 0; i < AI_SESSION_KIND_CAP + 3; i++) s.begin(`j${i}`, "judge", "t", "m1", "q");
        s.begin("w0", "word", "t", "m1", "q");
        const list = s.list();
        expect(list.filter((r) => r.kind === "judge")).toHaveLength(AI_SESSION_KIND_CAP);
        expect(list.some((r) => r.id === "j0")).toBe(false); // 最旧的 judge 被淘汰
        expect(list.some((r) => r.id === `j${AI_SESSION_KIND_CAP + 2}`)).toBe(true);
        expect(list.some((r) => r.id === "w0")).toBe(true);
    });

    it("全局上限：总数截断在 AI_SESSIONS_CAP（多类分摊不越界）", () => {
        const s = new AiSessionStore(memStore().loadRaw, memStore().saveRaw);
        const kinds = ["a", "b", "c", "d", "e", "f"];
        for (let i = 0; i < AI_SESSIONS_CAP + 40; i++) s.begin(`g${i}`, kinds[i % kinds.length], "t", "m1", "q");
        const list = s.list();
        expect(list.length).toBeLessThanOrEqual(AI_SESSIONS_CAP);
        expect(list[0].id).toBe(`g${AI_SESSIONS_CAP + 39}`); // 最新保留
        expect(list.some((r) => r.id === "g0")).toBe(false); // 最旧淘汰
    });

    it("remove/clear 即时生效；快照是副本（读方改不动登记簿）", () => {
        const s = new AiSessionStore(memStore().loadRaw, memStore().saveRaw);
        s.begin("s1", "judge", "t", "m1", "q");
        const snap = s.list();
        snap[0].title = "hacked";
        snap[0].turns.push({ role: "ai", text: "hacked" });
        expect(s.peek("s1")!.title).toBe("t");
        expect(s.peek("s1")!.turns).toHaveLength(1);
        s.remove("s1");
        expect(s.list()).toEqual([]);
        s.begin("s2", "tag", "t", "m1", "q");
        s.clear();
        expect(s.list()).toEqual([]);
    });

    it("动作分组：begin 带组落组字段；removeGroup 只删同组；盘上组字段读回保留", async () => {
        const m = memStore();
        const s = new AiSessionStore(m.loadRaw, m.saveRaw);
        s.begin("s1", "detect", "前段检测 · 1/3", "m1", "q", { id: "g1", title: "转换 · 文档" });
        s.begin("s2", "convert", "转换 · 文档", "m1", "q", { id: "g1", title: "转换 · 文档" });
        s.begin("s3", "judge", "判题 · 题", "m1", "q"); // 无组
        let list = s.list();
        expect(list.find((r) => r.id === "s2")).toMatchObject({ group: "g1", groupTitle: "转换 · 文档" });
        expect(list.find((r) => r.id === "s3")?.group).toBeUndefined();
        s.removeGroup("g1");
        list = s.list();
        expect(list.map((r) => r.id)).toEqual(["s3"]);
        // 盘上数据已含组字段，新实例读回不丢
        expect(m.saved.at(-1)?.items.find((r) => r.id === "s1")).toBeUndefined(); // 已被 removeGroup 落盘删除
        const m2 = memStore({
            version: 1,
            items: [rec("s9", "convert", 1), { ...rec("s8", "detect", 2), group: "g2", groupTitle: "转换 · 文档" }],
        });
        const s2 = new AiSessionStore(m2.loadRaw, m2.saveRaw);
        await s2.ready();
        const kept = s2.list().find((r) => r.id === "s8");
        expect(kept).toMatchObject({ group: "g2", groupTitle: "转换 · 文档" });
    });

    it("订阅在登记/收口/删除时被通知，退订后不再收", () => {
        const s = new AiSessionStore(memStore().loadRaw, memStore().saveRaw);
        let n = 0;
        const off = s.subscribe(() => n++);
        s.begin("s1", "judge", "t", "m1", "q");
        s.succeed("s1", "a");
        s.remove("s1");
        expect(n).toBe(3);
        off();
        s.begin("s2", "tag", "t", "m1", "q");
        expect(n).toBe(3);
    });

    it("落盘往返：flushNow 落的快照能被新实例原样读回", async () => {
        const m = memStore();
        const s1 = new AiSessionStore(m.loadRaw, m.saveRaw);
        s1.begin("s1", "judge", "判题 · 题", "m1", "q1");
        s1.succeed("s1", "a1");
        s1.flushNow();
        await Promise.resolve(); // 串行链一跳
        const s2 = new AiSessionStore(m.loadRaw, m.saveRaw);
        await s2.ready();
        const r = s2.peek("s1")!;
        expect(r.kind).toBe("judge");
        expect(r.title).toBe("判题 · 题");
        expect(r.turns).toEqual([
            { role: "user", text: "q1" },
            { role: "ai", text: "a1" },
        ]);
    });

    it("超长轮次文本封顶 2 万字（防超长 prompt 撑爆存储）", () => {
        const s = new AiSessionStore(memStore().loadRaw, memStore().saveRaw);
        s.begin("s1", "convert", "t", "m1", "x".repeat(21_000));
        expect(s.peek("s1")!.turns[0].text.length).toBe(20_000);
    });

    it("hydrate 前抢先登记的记录不被落盘数据覆盖（构造期竞态）", async () => {
        let resolveLoad: (v: unknown) => void = () => undefined;
        const m = memStore();
        const slowLoad = (): Promise<unknown> => new Promise((r) => (resolveLoad = r));
        const s = new AiSessionStore(slowLoad, m.saveRaw);
        s.begin("fresh", "judge", "t", "m1", "q"); // hydrate 未完成即登记
        resolveLoad({ version: 1, items: [rec("stored", "tag", 50), rec("fresh", "tag", 10)] });
        await s.ready();
        const list = s.list();
        expect(list.some((r) => r.id === "fresh" && r.kind === "judge")).toBe(true); // 在途记录优先
        expect(list.some((r) => r.id === "stored")).toBe(true);
    });
});
