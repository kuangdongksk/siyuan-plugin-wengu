import { describe, expect, it } from "vitest";
import { WeaknessStore } from "./WeaknessStore";
import type { WenguSession } from "../../quiz/service/HistoryStore";
import type { WenguQuestion } from "../../types";

const session: WenguSession = {
    id: "s1",
    docId: "doc1",
    startedAt: 1,
    endedAt: 2,
    mode: "countUp",
    elapsedSec: 0,
    answered: 1,
    correct: 0,
    results: [{ qid: "q1", submitted: "x", ok: false }],
};
const question = { id: "q1", chapter: "第一章" } as unknown as WenguQuestion;

describe("WeaknessStore 版本闩（version>1 = 更新版插件写的画像，停写保护）", () => {
    it("内存按空起步且 applyRound 全程零落盘——防旧版覆写清库", async () => {
        let saved = 0;
        const store = new WeaknessStore(
            async () => ({
                version: 2,
                points: { "ch:旧": { key: "ch:旧", title: "旧", wrong: 9, total: 9, lastWrongAt: 0, causes: {} } },
                applied: [],
                causeApplied: [],
            }),
            async () => {
                saved++;
            }
        );
        expect(store.topSync(10)).toEqual([]); // 不识别的数据不进内存
        await store.applyRound(session, [question]);
        expect(saved).toBe(0); // 停写保护，一次都不写
    });

    it("version 1 正常装载照常落盘（非闩）", async () => {
        let saved = 0;
        const store = new WeaknessStore(
            async () => undefined,
            async () => {
                saved++;
            }
        );
        await store.applyRound(session, [question]);
        expect(store.topSync(10).map((r) => r.key)).toEqual(["ch:第一章"]);
        expect(saved).toBe(1);
    });
});
