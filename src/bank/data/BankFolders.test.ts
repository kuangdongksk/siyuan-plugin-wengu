import { describe, expect, it } from "vitest";
import { folderCreateIn, folderDeleteIn, folderRenameIn } from "./BankFolders";
import type { BankData, BankCollection } from "./QuestionBank";

/** 最小可测 BankData（folder 三函数只碰 collections/folders）。 */
function data(titles: string[], folders: string[]): BankData {
    const col = (title: string): BankCollection => ({
        id: `col-${title}`,
        title,
        qids: [],
        origin: "manual",
        createdAt: 0,
    });
    return {
        version: 1,
        records: {},
        collections: titles.map(col),
        migratedDocs: [],
        hashed: {},
        knowRoots: [],
        folders,
    };
}

describe("folderCreateIn", () => {
    it("规范化入列，重复/空忽略", () => {
        const d = data([], []);
        expect(folderCreateIn(d, " 高数 / 极限 ")).toBe(true);
        expect(d.folders).toEqual(["高数/极限"]);
        expect(folderCreateIn(d, "高数/极限")).toBe(false);
        expect(folderCreateIn(d, " / ")).toBe(false);
    });
});

describe("folderDeleteIn", () => {
    it("删严格前缀下的专题与子文件夹，返回被删专题 id；同名平铺专题不受牵连", () => {
        const d = data(["高数/极限/洛必达", "高数/错题本", "高数", "英语/阅读"], ["高数/极限", "高数/空", "英语"]);
        const dead = folderDeleteIn(d, "高数");
        expect(dead).toEqual(["col-高数/极限/洛必达", "col-高数/错题本"]);
        expect(d.collections.map((c) => c.title)).toEqual(["高数", "英语/阅读"]);
        expect(d.folders).toEqual(["英语"]);
    });

    it("空路径忽略", () => {
        const d = data(["a/b"], ["a"]);
        expect(folderDeleteIn(d, " ")).toEqual([]);
        expect(d.collections).toHaveLength(1);
        expect(d.folders).toEqual(["a"]);
    });
});

describe("folderRenameIn", () => {
    it("改写严格前缀专题标题与文件夹条目（含自身），条目去重", () => {
        const d = data(["数学/极限/洛必达", "数学/错题本", "数学"], ["数学/极限", "数学/空", "英语"]);
        expect(folderRenameIn(d, "数学", "高数/基础")).toBe(true);
        expect(d.collections.map((c) => c.title)).toEqual(["高数/基础/极限/洛必达", "高数/基础/错题本", "数学"]);
        expect(d.folders).toEqual(["高数/基础/极限", "高数/基础/空", "英语"]);
    });

    it("改写后超长按整段截断；空/同名忽略", () => {
        const d = data([`数学/${"a".repeat(50)}`], []);
        folderRenameIn(d, "数学", "b".repeat(30));
        const t = d.collections[0].title;
        expect(t.length).toBeLessThanOrEqual(60);
        expect(t.split("/").every((s) => s === "b".repeat(30) || s === "a".repeat(50))).toBe(true);
        const d2 = data(["x/y"], ["x"]);
        expect(folderRenameIn(d2, "x", " x ")).toBe(false);
        expect(folderRenameIn(d2, " ", "z")).toBe(false);
    });
});
