import { describe, expect, it } from "vitest";
import { classifyChunks, srcAttrsOf, structuralChunks, withSrcAttrs, type SrcGroup } from "./SrcChunk";

/** 造一份带标题结构的源 markdown（两个章节 + 前导段）。 */
const MD = `开头引言，不属于任何章节。

# 第一章 极限

极限的定义与性质。

## 1.1 数列极限

数列极限的 ε-N 定义。

# 第二章 导数

导数的定义。
`;

/** 最小题目单元（容器 + 容器 IAL 行）。 */
const UNIT = `{{{row
题干
{: custom-plugin-wengu-part="stem"}
}}}
{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"}`;

const MATERIAL = `{{{row
材料正文
{: custom-plugin-wengu-part="body"}
}}}
{: custom-plugin-wengu-material="1"}`;

describe("structuralChunks（结构切块）", () => {
    it("按标题切：前导段 P0 + 各标题区间一块（含标题行本身），键=标题链", () => {
        const cs = structuralChunks(MD);
        expect(cs.map((c) => c.key)).toEqual(["P0", "H:第一章 极限", "H:第一章 极限/1.1 数列极限", "H:第二章 导数"]);
        expect(cs[1].text).toContain("# 第一章 极限");
        expect(cs[1].text).not.toContain("1.1"); // 小节归自己的块
        expect(cs[2].text).toContain("## 1.1 数列极限");
    });

    it("切块覆盖全文且偏移连续（续跑 offset 过滤不漏段）", () => {
        const cs = structuralChunks(MD);
        for (const c of cs) {
            expect(c.offset).toBeLessThan(MD.length);
            expect(c.offset + c.text.length).toBeLessThanOrEqual(MD.length + 2);
        }
        for (let i = 1; i < cs.length; i++) expect(cs[i].offset).toBeGreaterThanOrEqual(cs[i - 1].offset);
    });

    it("同键重复标题追加 ~2 消歧", () => {
        const cs = structuralChunks("# 同名\nA\n# 同名\nB\n");
        expect(cs.map((c) => c.key)).toEqual(["H:同名", "H:同名~2"]);
    });

    it("超阈值大块按空行二切，子块键挂父块名下（#k）", () => {
        const para = "段落内容。".repeat(120); // ~600 字
        const big = `# 大章\n\n${para}\n\n${para}\n\n${para}\n`;
        expect(structuralChunks(big).length).toBe(1); // 默认 5000 阈值内不切
        const subs = structuralChunks(big, 1000);
        expect(subs.length).toBeGreaterThan(1);
        for (let i = 0; i < subs.length; i++) expect(subs[i].key).toBe(`H:大章#${i}`);
        expect(subs[0].text).toContain("# 大章"); // 标题行随首子块
    });

    it("确定性：同输入两次切块逐项相等（键/指纹/文本/偏移）", () => {
        const a = structuralChunks(MD);
        const b = structuralChunks(MD);
        expect(a).toEqual(b);
    });

    it("中间插一段：只有所在块的指纹变，其他块指纹不变（结构稳定性的意义）", () => {
        const before = structuralChunks(MD);
        const edited = MD.replace("导数的定义。", "导数的定义。\n\n新增的插段。");
        const after = structuralChunks(edited);
        const byKey = new Map(after.map((c) => [c.key, c]));
        for (const c of before) {
            if (c.key === "H:第二章 导数") continue; // 被编辑的块
            expect(byKey.get(c.key)?.hash).toBe(c.hash);
        }
        expect(byKey.get("H:第二章 导数")?.hash).not.toBe(before[3].hash);
    });
});

describe("withSrcAttrs / srcAttrsOf（容器 IAL 注入）", () => {
    it("题目与材料容器的 IAL 行末尾追加键与指纹；幂等（重写先剥旧）", () => {
        const out1 = withSrcAttrs(UNIT, "H:第一章", "abc-123");
        expect(out1).toContain('custom-plugin-wengu-src-key="H:第一章"');
        expect(out1).toContain('custom-plugin-wengu-src-hash="abc-123"');
        const out2 = withSrcAttrs(out1, "H:第二章", "def-456");
        expect(out2).not.toContain("abc-123");
        expect(srcAttrsOf(out2)).toEqual({ key: "H:第二章", hash: "def-456" });
        // 原 q 属性仍在，容器结构未被破坏
        expect(out2).toContain('custom-plugin-wengu-q="1"');
        expect(srcAttrsOf(withSrcAttrs(MATERIAL, "P0", "h1-h2")).hash).toBe("h1-h2");
    });

    it("键值消毒：引号/换行剥掉、限长", () => {
        const out = withSrcAttrs(UNIT, 'a"b\nc', "x");
        expect(out).not.toContain('""');
        expect(srcAttrsOf(out).key).toBe("a b c");
    });

    it("无容器 IAL 行原样返回（防御）", () => {
        expect(withSrcAttrs("普通文本", "k", "h")).toBe("普通文本");
    });

    it("stale 旧标记随重写一起剥掉", () => {
        const stale = withSrcAttrs(UNIT, "k", "h").replace(
            /custom-plugin-wengu-src-hash="h"/,
            'custom-plugin-wengu-src-hash="h" custom-plugin-wengu-src-stale="1"'
        );
        const rewritten = withSrcAttrs(stale, "k", "h2");
        expect(rewritten).not.toContain("src-stale");
    });
});

describe("classifyChunks（三态分类）", () => {
    /** 造分组：hash 即内容。 */
    const g = (key: string, hash: string, blocks: string[]): SrcGroup => ({ key, hash, blocks });

    it("指纹一致=相同（键变了也算同——标题改名内容不动零成本跳过）", () => {
        const old = [g("H:旧标题", "ha", ["b1"])];
        const cur = structuralChunks("# 新标题\n内容A\n").map((c) => ({ ...c, hash: "ha" }));
        const plan = classifyChunks(old, cur);
        expect(plan.same).toBe(1);
        expect(plan.changed).toHaveLength(0);
        expect(plan.removed).toHaveLength(0);
    });

    it("键同指纹异=变更配对；键指纹都新=新增；旧组两头不沾=消失", () => {
        const old = [g("H:A", "h1", ["b1"]), g("H:B", "h2", ["b2"]), g("H:C", "h3", ["b3"])];
        const cur = [
            { key: "H:A", hash: "h1x", text: "A改", offset: 0 },
            { key: "H:D", hash: "h4", text: "D新", offset: 10 },
        ];
        const plan = classifyChunks(old, cur);
        expect(plan.same).toBe(0);
        expect(plan.changed).toHaveLength(1);
        expect(plan.changed[0].old.blocks).toEqual(["b1"]);
        expect(plan.fresh.map((c) => c.key)).toEqual(["H:D"]);
        expect(plan.removed.map((r) => r.key)).toEqual(["H:B", "H:C"]);
    });

    it("子块序漂移被指纹解救：内容没变的子块按指纹判同，不再误报变更", () => {
        const old = [g("H:大#0", "s0", ["b0"]), g("H:大#1", "s1", ["b1"])];
        // 中间插入一段后序号漂移：#0 内容还在（现 #1）、原 #1 变 #2
        const cur = [
            { key: "H:大#0", hash: "sNEW", text: "插入", offset: 0 },
            { key: "H:大#1", hash: "s0", text: "原0", offset: 5 },
            { key: "H:大#2", hash: "s1", text: "原1", offset: 9 },
        ];
        const plan = classifyChunks(old, cur);
        expect(plan.same).toBe(2);
        expect(plan.fresh.map((c) => c.key)).toEqual(["H:大#0"]);
        expect(plan.changed).toHaveLength(0);
        expect(plan.removed).toHaveLength(0);
    });

    it("一组不被两头重复匹配（指纹吃掉后键不再配它）", () => {
        const old = [g("H:A", "h1", ["b1"])];
        const cur = [
            { key: "H:A", hash: "h1", text: "", offset: 0 }, // 指纹匹配
            { key: "H:A", hash: "h9", text: "", offset: 1 }, // 键同名但组已消费 → 新增
        ];
        const plan = classifyChunks(old, cur);
        expect(plan.same).toBe(1);
        expect(plan.fresh).toHaveLength(1);
        expect(plan.removed).toHaveLength(0);
    });

    it("无键旧组只按指纹匹配（缺 key 的防御路径）", () => {
        const old = [g("", "h1", ["b1"])];
        const same = [{ key: "H:X", hash: "h1", text: "", offset: 0 }];
        expect(classifyChunks(old, same).same).toBe(1);
        const diff = [{ key: "H:X", hash: "h2", text: "", offset: 0 }];
        const plan = classifyChunks(old, diff);
        expect(plan.removed).toHaveLength(1);
        expect(plan.fresh).toHaveLength(1);
    });
});
