import { describe, expect, it } from "vitest";
import type { AiSessionRecord } from "../data/AiSessions";
import { buildSessionRows } from "./SessionTree";

const rec = (id: string, kind: string, createdAt: number, group?: string, status: AiSessionRecord["status"] = "done") =>
    ({
        id,
        kind,
        title: `t-${id}`,
        model: "m1",
        createdAt,
        status,
        turns: [{ role: "user", text: "q" }],
        ...(group ? { group, groupTitle: `组·${group.slice(-3)}` } : {}),
    }) as AiSessionRecord;

describe("buildSessionRows 树归并", () => {
    it("同组 ≥2 条归并成组行：位置=最新成员、成员头新尾旧、标题取最新成员", () => {
        const rows = buildSessionRows(
            [
                rec("c1", "convert", 30, "g1"),
                rec("d1", "detect", 25, "g1"),
                rec("c2", "convert", 20, "g1"),
                rec("j1", "judge", 10),
            ],
            ""
        );
        expect(rows).toHaveLength(2);
        expect(rows[0].type).toBe("group");
        if (rows[0].type !== "group") return;
        expect(rows[0].id).toBe("g1");
        expect(rows[0].createdAt).toBe(30);
        expect(rows[0].recs.map((r) => r.id)).toEqual(["c1", "d1", "c2"]);
        expect(rows[0].status).toBe("done");
        expect(rows[1]).toEqual({ type: "single", rec: expect.objectContaining({ id: "j1" }) });
    });

    it("组状态聚合：running > error > done", () => {
        const recs = [rec("a", "convert", 3, "g1"), rec("b", "detect", 2, "g1", "error"), rec("c", "route", 1, "g1")];
        expect(buildSessionRows(recs, "")[0]).toMatchObject({ status: "error" });
        recs.push(rec("d", "convert", 4, "g1", "running"));
        expect(buildSessionRows(recs, "")[0]).toMatchObject({ status: "running" });
    });

    it("孤儿组（LRU 淘汰到只剩 1 条）退回平铺行", () => {
        const rows = buildSessionRows([rec("j1", "judge", 5), rec("c1", "convert", 3, "g1")], "");
        expect(rows).toHaveLength(2);
        expect(rows.every((r) => r.type === "single")).toBe(true);
    });

    it("过滤：单条按 kind 挑，组内只留匹配成员，全滤空整组隐藏", () => {
        const recs = [rec("c1", "convert", 30, "g1"), rec("d1", "detect", 25, "g1"), rec("j1", "judge", 10)];
        const rows = buildSessionRows(recs, "convert");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ type: "group", id: "g1" });
        if (rows[0].type !== "group") return;
        expect(rows[0].recs.map((r) => r.id)).toEqual(["c1"]);
        expect(buildSessionRows(recs, "regen")).toHaveLength(0);
    });

    it("过滤后组不拆散：检测过滤下双成员组仍是一棵组行", () => {
        const recs = [rec("c1", "convert", 30, "g1"), rec("d1", "detect", 25, "g1")];
        const rows = buildSessionRows(recs, "detect");
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ type: "group", id: "g1" });
    });
});
