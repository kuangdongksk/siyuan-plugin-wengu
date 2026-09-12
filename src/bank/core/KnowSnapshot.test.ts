import { describe, expect, it } from "vitest";
import { collectNodeIds, sectionsByRoot, staleRootsOf } from "./KnowSnapshot";
import type { KnowSectionNode } from "../../convert/service/knowledge/KnowledgeLink";

/**
 * 快照过期归口（Issue #39）：根 → 子树小节 id 集、过期根判定。纯函数，
 * 零内核读。
 */

const tree = (id: string, children: KnowSectionNode[] = []): KnowSectionNode => ({ id, title: id, children });

describe("collectNodeIds / sectionsByRoot", () => {
    it("按根归口子树全部小节 id（含后代文档与嵌套子节）", () => {
        const byRoot = sectionsByRoot(
            new Map([
                ["r1", new Set(["d1", "d2"])],
                ["r2", new Set(["d3"])],
            ]),
            [
                { docId: "d1", sectionTree: [tree("h1", [tree("h1a")]), tree("h2")] },
                { docId: "d2", sectionTree: [tree("h3")] },
                { docId: "d3", sectionTree: [] },
            ]
        );
        expect([...(byRoot.get("r1") ?? [])].sort()).toEqual(["h1", "h1a", "h2", "h3"]);
        expect(byRoot.get("r2")).toEqual(new Set());
    });

    it("未展开的根不在表里（不误报）", () => {
        const byRoot = sectionsByRoot(new Map([["r1", new Set(["d1"])]]), [{ docId: "d1", sectionTree: [] }]);
        expect(byRoot.has("r2")).toBe(false);
    });

    it("入参缺省不抛（装载链异常兜底）", () => {
        expect(sectionsByRoot(undefined, []).size).toBe(0);
    });

    it("collectNodeIds 就地收集", () => {
        const into = new Set<string>();
        collectNodeIds([tree("a", [tree("b", [tree("c")])])], into);
        expect([...into].sort()).toEqual(["a", "b", "c"]);
    });
});

describe("staleRootsOf", () => {
    const byRoot = new Map([
        ["r1", new Set(["h1", "h2"])],
        ["r2", new Set(["h9"])],
    ]);

    it("子树内有变更小节 → 该根出「快照过期」", () => {
        expect([...staleRootsOf(["r1", "r2"], byRoot, new Set(["h2"]))]).toEqual(["r1"]);
    });

    it("无变更 / 变更不属任何登记根 → 空集", () => {
        expect(staleRootsOf(["r1", "r2"], byRoot, new Set()).size).toBe(0);
        expect(staleRootsOf(["r1", "r2"], byRoot, new Set(["h-other"])).size).toBe(0);
    });

    it("未登记根不报（即使它在表里）", () => {
        expect(staleRootsOf(["r2"], byRoot, new Set(["h1"])).size).toBe(0);
    });
});
