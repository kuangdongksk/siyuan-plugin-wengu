import { describe, expect, it } from "vitest";
import { make, q, seedSet } from "./MobileDrillHarness";
import { mockDoc } from "./MobileResumeMock";
import type { WenguSession } from "../../quiz/service/HistoryStore";

/**
 * 移动端「继续上次」的探测 / 快照 / 落点（Issue #167 A1/A1b/A2/A3）：
 * 三个缺口各自成组、逐条锁住——
 *
 * - **A1 跨题集**：探测改**扫全库取最近一条**未完成轮（原实现恒取激活
 *   题集的最后一条：未完成轮不在首个题集时恢复卡完全不出现）；
 * - **A1b 边界**：目标题集有**更新的已收卷轮**时仍指向那条未完成轮，
 *   点击恢复**不得二次探测**（否则「继续」退化成新开）；题集已删不显示卡；
 * - **A2 快照**：只有「本次题数」真的裁掉题时才写 `scopeIds` 快照，
 *   恢复后恒为原 N 题、排列与退出前一致（分母是 N 不是全量）；
 * - **A3 落点**：恢复到第一道未作答题；答满未交卷的轮落第 1 题。
 *
 * 装配件在 `MobileDrillHarness.ts`（假题库 `seedSet` 真装题面）。
 */

/** 未完成轮（有作答、无 endedAt；`answeredIds` 按块 id 去重后的条数）。 */
function unfinished(over: {
    id?: string;
    docId: string;
    startedAt?: number;
    ids: string[];
    answeredIds: string[];
}): WenguSession {
    return {
        id: over.id ?? "un-1",
        docId: over.docId,
        startedAt: over.startedAt ?? 100,
        mode: "countUp",
        revealMode: "instant",
        scope: "all",
        scopeIds: over.ids,
        elapsedSec: 12,
        answered: over.answeredIds.length,
        correct: 0,
        results: over.answeredIds.map((qid) => ({ qid, submitted: "A", ok: true })),
    };
}

/** 已收卷的一轮（当作「更新的已收卷轮」，边界 A 用）。 */
function fullAfter(over: Partial<WenguSession> = {}): WenguSession {
    return {
        id: "done",
        docId: "set1",
        startedAt: 200,
        endedAt: 300,
        mode: "countUp",
        revealMode: "after",
        elapsedSec: 20,
        answered: 2,
        correct: 1,
        results: [
            { qid: "set1/a", submitted: "A", ok: true },
            { qid: "set1/b", submitted: "B", ok: false },
        ],
        ...over,
    };
}

describe("恢复探测 / 快照 / 落点（Issue #167 A1/A1b/A2/A3）", () => {
    /** 两个题集（卷一：a/b；卷二：b/c），激活的是**第一个**卷一——
     *  缺陷 ① 就是「恒取 sets[0]」探测不到非激活题集的未完成轮。
     *  ⚠️ 题目与 `sets[].id` 对齐（题集 id = 源文档 id，qid 前缀同源），
     *  才复现真库的装载行为。 */
    async function twoSets(sessions: WenguSession[]) {
        const { drill, ui, calls, upserts, SESSIONS, face } = make();
        sessions.forEach((s) => SESSIONS.push(s));
        // 题集 ↔ 题面按真口径预埋（题集 id = 源文档 id，qid 前缀同源）：
        // 切卷时要真的能从假题库里把那一卷装出来
        seedSet(face, "set1", [q("set1/a"), q("set1/b")]);
        seedSet(face, "set2", [q("set2/b"), q("set2/c")]);
        ui.home = {
            loading: false,
            error: "",
            sets: [mockDoc("set1", "卷一"), mockDoc("set2", "卷二")],
            activeSetId: "set1",
            activeSetTitle: "卷一",
        };
        ui.fullList = [q("set1/a"), q("set1/b")];
        await drill.restoreResumeFor(); // load() 的探测段（新实例走 load 即此调用）
        return { drill, ui, calls, upserts, SESSIONS, face };
    }

    it("A1 跨题集：探测到题集 B 的未完成轮，恢复卡显示 B 的标题与已答数", async () => {
        const { drill, ui } = await twoSets([
            unfinished({ docId: "set2", ids: ["set2/b", "set2/c"], answeredIds: ["set2/b"] }),
        ]);
        expect(ui.resume?.docId).toBe("set2");
        // ⚠️ 探测**只读**：卡指向 B，但卷面仍停在激活的卷一——切卷是用户
        // 点恢复卡那一步的事（否则题集行点不动，见 MobileRound 探测注释）
        expect(ui.home.activeSetId).toBe("set1");
        expect(ui.home.activeSetTitle).toBe("卷一");
        expect(drill.ui.resumeView).toMatchObject({ title: "卷二", answered: 1, total: 2 });
    });

    it("A1 探测不改激活卷：用户点题集 A 不会被静默弹到有未完成轮的 B", async () => {
        const { drill, ui, face } = await twoSets([
            unfinished({ docId: "set2", ids: ["set2/b", "set2/c"], answeredIds: ["set2/b"] }),
        ]);
        seedSet(face, "set3", [q("set3/x")]);
        ui.home.sets.push(mockDoc("set3", "卷三"));
        await drill.selectSet("set3");
        expect(ui.home.activeSetId).toBe("set3"); // 点哪卷就是哪卷
        expect(ui.home.activeSetTitle).toBe("卷三");
        // 恢复卡仍指向 B（全局一张），点它才切过去
        expect(ui.resume?.docId).toBe("set2");
        await drill.resumeRound();
        expect(ui.home.activeSetId).toBe("set2");
        expect(ui.session?.docId).toBe("set2");
    });

    it("A1 边界 B：探测后题集被删，点恢复卡不恢复（不开一张空卷）", async () => {
        const { drill, ui } = await twoSets([unfinished({ docId: "set2", ids: ["set2/b"], answeredIds: ["set2/b"] })]);
        expect(ui.resume?.docId).toBe("set2");
        ui.home.sets = ui.home.sets.filter((x) => x.id !== "set2"); // 题集在探测后被删
        await drill.resumeRound();
        expect(ui.screen).toBe("home"); // 没进刷题屏
        expect(ui.session).toBeUndefined();
        expect(ui.resume).toBeUndefined();
    });

    it("A1 点击恢复：切到 B 并恢复该轮（作答态还原、继续不是重开）", async () => {
        const s = unfinished({ docId: "set2", ids: ["set2/b"], answeredIds: ["set2/b"] });
        const { drill, ui } = await twoSets([s]);
        await drill.resumeRound();
        expect(ui.screen).toBe("drill");
        expect(ui.session).toBe(s); // 同一条会话，不是新轮
        expect(ui.session?.endedAt).toBeUndefined();
        expect(ui.list.map((x) => x.id)).toEqual(["set2/b"]);
        expect(drill.ui.cards[0].graded).toBe(true); // 作答态还原
        expect(drill.ui.cards[0].letters).toBe("A");
    });

    it("A1b 边界 A：目标题集有更新的已收卷轮时，恢复卡仍指向那条未完成轮", async () => {
        const s = unfinished({ docId: "set1", ids: ["set1/a"], answeredIds: ["set1/a"] });
        // 卷一里更晚开始的**已收卷**轮：取「最后一条」的旧口径会被它挤掉
        const later = fullAfter({ docId: "set1", id: "later", startedAt: 500 });
        const { drill, ui } = await twoSets([s, later]);
        expect(ui.resume?.id).toBe(s.id);
        // 点击恢复不得二次探测（重探测会把 resume 抹掉 → 退化成新开）
        await drill.resumeRound();
        expect(ui.session?.id).toBe(s.id);
        expect(ui.session?.startedAt).toBe(s.startedAt);
    });

    it("A1b 边界 B：目标题集不在 sets 清单里（已删）时不显示恢复卡", async () => {
        const { ui } = await twoSets([unfinished({ docId: "gone", ids: ["set2/b"], answeredIds: ["set2/b"] })]);
        expect(ui.resume).toBeUndefined();
        expect(ui.resumeView).toBeUndefined();
    });

    it("A2 count 裁剪：选「本次 10 题」开轮写 scopeIds 快照；全量不写", async () => {
        const { drill, ui } = make();
        ui.home = { loading: false, error: "", sets: [], activeSetId: "set1", activeSetTitle: "卷一" };
        ui.fullList = Array.from({ length: 15 }, (_, i) => q(`q${i}`));
        ui.setup.count = 10;
        drill.start("fresh");
        expect(ui.session?.scopeIds).toEqual(ui.fullList.slice(0, 10).map((x) => x.id));
        expect(ui.list).toHaveLength(10);

        ui.setup.count = 0;
        drill.start("fresh");
        expect(ui.session?.scopeIds).toBeUndefined(); // 与桌面 scope === "all" 同口径
        expect(ui.list).toHaveLength(15);
    });

    it("A2 恢复：分母是本轮 N 题（不是全量），恢复后恒为原 N 题、排列与退出前一致", async () => {
        const { drill, ui } = make();
        ui.home = {
            loading: false,
            error: "",
            sets: [mockDoc("set1", "卷一")],
            activeSetId: "set1",
            activeSetTitle: "卷一",
        };
        ui.fullList = Array.from({ length: 15 }, (_, i) => q(`q${i}`));
        ui.setup.count = 10;
        drill.start("fresh");
        const s = ui.session!;
        const before = drill.ui.list.map((x) => ({ id: x.id, opts: [...x.optionMd!], ans: x.answer }));
        drill.pickLetter(drill.ui.list[0].answer!);
        await drill.submit();

        // 退出重进（新实例走 load）：探测只拿到这条裁剪过的轮
        const { drill: fresh, ui: ui2, SESSIONS } = make();
        SESSIONS.push(s);
        ui2.home = {
            loading: false,
            error: "",
            sets: [mockDoc("set1", "卷一")],
            activeSetId: "set1",
            activeSetTitle: "卷一",
        };
        ui2.fullList = Array.from({ length: 15 }, (_, i) => q(`q${i}`));
        await fresh.restoreResumeFor();
        expect(ui2.resumeView).toMatchObject({ answered: 1, total: 10 });
        await fresh.resumeRound();
        expect(fresh.ui.list).toHaveLength(10);
        expect(fresh.ui.list.map((x) => ({ id: x.id, opts: [...x.optionMd!], ans: x.answer }))).toEqual(before);
    });

    it("A3 落点：恢复到第一道未作答题；答满未交卷的轮落第 1 题", async () => {
        const first = unfinished({ docId: "set1", ids: ["set1/a", "set1/b"], answeredIds: ["set1/a"] });
        const { drill, ui } = await twoSets([first]);
        expect(ui.resume?.id).toBe(first.id);
        await drill.resumeRound();
        expect(ui.qIdx).toBe(1); // 首道未作答

        // 答满但未交卷：无从「未作答」可落，维持第 1 题（老口径不回归）
        const full = fullAfter({
            id: "full-open",
            startedAt: 300,
            endedAt: undefined,
            docId: "set2",
            scopeIds: ["set2/b", "set2/c"],
            results: [
                { qid: "set2/b", submitted: "A", ok: true },
                { qid: "set2/c", submitted: "B", ok: true },
            ],
        });
        const two = await twoSets([full]);
        await two.drill.resumeRound();
        expect(two.ui.qIdx).toBe(0);
        expect(two.ui.session?.endedAt).toBeUndefined();
    });
});
