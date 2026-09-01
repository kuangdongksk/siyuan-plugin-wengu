import { describe, expect, it } from "vitest";
import { HistoryStore, newSessionId, type WenguSession } from "./HistoryStore";

function session(id: string): WenguSession {
    return {
        id,
        docId: "doc1",
        startedAt: 1,
        mode: "countUp",
        elapsedSec: 0,
        answered: 0,
        correct: 0,
        results: [],
    };
}

describe("HistoryStore 版本闩（version>1 = 更新版插件写的历史，停写保护）", () => {
    it("内存按空起步且 upsert 全程零落盘——防旧版覆写清库", async () => {
        let saved = 0;
        const store = new HistoryStore(
            async () => ({ version: 2, sessions: [session(newSessionId())] }),
            async () => {
                saved++;
            }
        );
        expect(await store.docSessions("doc1")).toEqual([]); // 不识别的数据不进内存
        await store.upsert(session("s1"));
        expect(saved).toBe(0); // 停写保护，一次都不写
    });

    it("version 1 正常装载照常落盘（非闩）", async () => {
        let saved = 0;
        const store = new HistoryStore(
            async () => undefined,
            async () => {
                saved++;
            }
        );
        await store.upsert(session("s1"));
        expect((await store.docSessions("doc1")).map((s) => s.id)).toEqual(["s1"]);
        expect(saved).toBe(1);
    });
});
