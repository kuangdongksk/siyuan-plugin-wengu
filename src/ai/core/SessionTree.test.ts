import { describe, expect, it } from "vitest";
import type { AiSessionRecord } from "../data/AiSessions";
import { buildSessionTree } from "./SessionTree";

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

describe("buildSessionTree 树化", () => {
    it("同组 ≥2 条成 branch 节点：位置=最新成员、children 头新尾旧、查找表齐", () => {
        const d = buildSessionTree(
            [
                rec("c1", "convert", 30, "g1"),
                rec("d1", "detect", 25, "g1"),
                rec("c2", "convert", 20, "g1"),
                rec("j1", "judge", 10),
            ],
            ""
        );
        expect(d.nodes.map((n) => n.key)).toEqual(["g1", "j1"]);
        expect(d.nodes[0]).toMatchObject({ kind: "branch", name: "组·g1" });
        expect(d.nodes[0].children.map((c) => c.key)).toEqual(["c1", "d1", "c2"]);
        expect([...d.groupByKey.keys()]).toEqual(["g1"]);
        expect(d.groupByKey.get("g1")).toMatchObject({ status: "done", createdAt: 30 });
        expect(d.recByKey.get("j1")?.id).toBe("j1");
    });

    it("组状态聚合：running > error > done", () => {
        const recs = [rec("a", "convert", 3, "g1"), rec("b", "detect", 2, "g1", "error"), rec("c", "route", 1, "g1")];
        expect(buildSessionTree(recs, "").groupByKey.get("g1")).toMatchObject({ status: "error" });
        recs.push(rec("d", "convert", 4, "g1", "running"));
        expect(buildSessionTree(recs, "").groupByKey.get("g1")).toMatchObject({ status: "running" });
    });

    it("孤儿组（LRU 淘汰到只剩 1 条）退回顶层叶子", () => {
        const d = buildSessionTree([rec("j1", "judge", 5), rec("c1", "convert", 3, "g1")], "");
        expect(d.nodes.map((n) => n.kind)).toEqual(["doc", "doc"]);
        expect(d.groupByKey.size).toBe(0);
    });

    it("过滤：叶子按 kind 挑，组内只留匹配 children，全滤空整组隐藏", () => {
        const recs = [rec("c1", "convert", 30, "g1"), rec("d1", "detect", 25, "g1"), rec("j1", "judge", 10)];
        const d = buildSessionTree(recs, "convert");
        expect(d.nodes.map((n) => n.key)).toEqual(["g1"]);
        expect(d.nodes[0].children.map((c) => c.key)).toEqual(["c1"]);
        expect(buildSessionTree(recs, "regen").nodes).toHaveLength(0);
    });

    it("过滤后组不拆散：检测过滤下双成员组仍是一个 branch", () => {
        const d = buildSessionTree([rec("c1", "convert", 30, "g1"), rec("d1", "detect", 25, "g1")], "detect");
        expect(d.nodes).toHaveLength(1);
        expect(d.nodes[0]).toMatchObject({ kind: "branch", key: "g1" });
        expect(d.nodes[0].children.map((c) => c.key)).toEqual(["d1"]);
    });
});
