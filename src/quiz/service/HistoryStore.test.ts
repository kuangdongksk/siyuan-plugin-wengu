import { describe, expect, it } from "vitest";
import { HistoryStore, newSessionId, pushSessionAnswer, type WenguSession } from "./HistoryStore";

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

describe("pushSessionAnswer · upsert（Issue #12 B2 after 模式可改答案）", () => {
    it("同题重复提交原地覆写：answered 不涨、correct 按差值修正、**sec 冻结**（#182 R4）", () => {
        const s = session("s1");
        pushSessionAnswer(s, "q1", "A", false, 5, 5);
        expect([s.answered, s.correct, s.results.length]).toEqual([1, 0, 1]);
        pushSessionAnswer(s, "q1", "B", true, 8, 9); // 改答案：错→对
        expect([s.answered, s.correct, s.results.length]).toEqual([1, 1, 1]);
        expect(s.results[0].submitted).toBe("B");
        expect(s.results[0].ok).toBe(true);
        // 用时冻结（#182 R4）：首答结算的 5s 就是该题的 sec，改答只改对错
        // ——原口径「以最后一次为准」会把回来改答案时的表值写回（AI 等待/
        // 翻看解析的时长计入），故 #182 起只补写、不覆写。
        expect(s.results[0].sec).toBe(5);
        expect(s.elapsedSec).toBe(9);
        pushSessionAnswer(s, "q1", "C", false, 0, 9); // 再改回错
        expect([s.answered, s.correct, s.results.length]).toEqual([1, 0, 1]);
        expect(s.results[0].submitted).toBe("C");
    });
    it("覆写是原地赋值：不重排 results、不动别的题（sec 亦冻结）", () => {
        const s = session("s1");
        pushSessionAnswer(s, "q1", "A", true, 1, 1);
        pushSessionAnswer(s, "q2", "B", false, 2, 2);
        pushSessionAnswer(s, "q1", "D", false, 3, 3);
        expect(s.results[0].sec).toBe(1); // #182 R4：重复提交不覆写首次结算值
        expect(s.results.map((r) => r.qid)).toEqual(["q1", "q2"]);
        expect([s.answered, s.correct]).toEqual([2, 0]);
    });
    it("三态字段以最后一次为准：本次不带即清空（不留旧 verdict/comment）", () => {
        const s = session("s1");
        pushSessionAnswer(s, "q1", "我的答案", true, 1, 1, { verdict: "partial", comment: "差一点", cause: "c1" });
        expect(s.results[0].verdict).toBe("partial");
        pushSessionAnswer(s, "q1", "我的答案", true, 1, 1);
        expect(s.results[0].verdict).toBeUndefined();
        expect(s.results[0].comment).toBeUndefined();
        expect(s.results[0].cause).toBeUndefined();
        expect("verdict" in s.results[0]).toBe(false);
    });
    it("新题照旧追加并推进 answered/correct", () => {
        const s = session("s1");
        pushSessionAnswer(s, "q1", "A", true, 1, 1, { comment: "好" });
        pushSessionAnswer(s, "q2", "B", true, 1, 2);
        expect([s.answered, s.correct, s.results.length]).toEqual([2, 2, 2]);
        expect(s.results[0].comment).toBe("好");
    });
    it("步/空题的 qid#k 也走同一条 upsert（重复提交不翻倍）", () => {
        const s = session("s1");
        pushSessionAnswer(s, "q1#0", "A", false, 1, 1);
        pushSessionAnswer(s, "q1#0", "B", true, 1, 2);
        expect([s.answered, s.correct]).toEqual([1, 1]);
    });
});

describe("removeSession（Issue #155 块 A：空轮关轮抹掉已落盘的那条）", () => {
    it("删掉指定轮并落盘，其余轮不受影响", async () => {
        const saved: string[][] = [];
        const store = new HistoryStore(
            async () => undefined,
            async (h: { sessions: WenguSession[] }) => {
                saved.push(h.sessions.map((x) => x.id));
            }
        );
        await store.upsert(session("s1"));
        await store.upsert(session("s2"));
        await store.removeSession("s1");
        expect((await store.docSessions("doc1")).map((s) => s.id)).toEqual(["s2"]);
        expect(saved[saved.length - 1]).toEqual(["s2"]);
    });

    it("同 id 不存在时空操作（幂等，且不触发落盘）", async () => {
        let saves = 0;
        const store = new HistoryStore(
            async () => undefined,
            async () => {
                saves++;
            }
        );
        await store.upsert(session("s1"));
        const before = saves;
        await store.removeSession("nope");
        expect(saves).toBe(before);
        expect((await store.docSessions("doc1")).map((s) => s.id)).toEqual(["s1"]);
    });

    it("开轮即落盘的 0 作答记录，空轮关轮后被彻底抹掉（验收：history 里无该轮）", async () => {
        // 复刻真链：startRound 一开轮就 upsert（未完成轮可继续的依托）——
        // 空轮关轮必须把这条删掉，否则统计总览轮次数各多一轮
        const store = new HistoryStore(
            async () => undefined,
            async () => undefined
        );
        const empty = session("empty-round");
        await store.upsert(empty);
        expect(await store.docSessions("doc1")).toHaveLength(1);
        await store.removeSession(empty.id);
        expect(await store.docSessions("doc1")).toEqual([]);
    });
});
