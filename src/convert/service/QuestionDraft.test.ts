import { describe, expect, it } from "vitest";
import { applyKnowDrafts, parseDrafts, renderUnit } from "./QuestionDraft";
import { shuffleDraftOptions } from "./OptionShuffle";
import type { KnowSection } from "./KnowledgeLink";

/**
 * 行协议解析/渲染（20260902）：AI 回复 → DraftUnit → 确定性契约 kramdown。
 * 容错焦点：坏一题不坏一批（漏 END/噪声行/未知标记）；渲染焦点：
 * 落盘形态与契约 §一 逐字兼容（容器/part IAL/字母/引述块），下游
 * BankParse 与 questionHash 零改动可用。
 */

const SIMPLE = `CAN_CONVERT: yes
REASON: 覆盖极限计算
@@Q type=single knowledge=洛必达 chapter=第一章
@@P stem
求极限 $\\lim_{x \\to 0}\\frac{\\sin x}{x}$。
@@P opt
$1$
@@P opt
$0$
@@P opt
$\\infty$
@@P ans
B
@@P sol
应用等价无穷小代换。
@@END`;

describe("parseDrafts 容错", () => {
    it("判定行/叙述噪声忽略，单题解析出全部部件", () => {
        const ds = parseDrafts(SIMPLE);
        expect(ds).toHaveLength(1);
        const d = ds[0];
        expect(d.attrs).toMatchObject({ type: "single", knowledge: "洛必达", chapter: "第一章" });
        expect(d.parts.map((p) => p.name)).toEqual(["stem", "option-0", "option-0", "option-0", "answer", "solution"]);
        expect(d.parts[0].text).toContain("$\\lim_{x \\to 0}\\frac{\\sin x}{x}$"); // 反斜杠零转义
        expect(d.parts[4].text).toBe("B");
    });
    it("漏 @@END 由下一个 @@Q 自动收口（坏一题不坏一批）", () => {
        const reply = `${SIMPLE}\n@@Q type=judge knowledge=导数\n@@P stem\n可导必连续？\n@@P ans\n√\n@@END`;
        const ds = parseDrafts(reply);
        expect(ds).toHaveLength(2);
        expect(ds[0].attrs.type).toBe("single");
        expect(ds[1].attrs.type).toBe("judge");
        expect(ds[1].parts[1].text).toBe("√");
    });
    it("末尾无 @@END 的题照样收口", () => {
        const ds = parseDrafts("@@Q type=fill\n@@P stem\n填空：____\n@@P ans\n1|2");
        expect(ds).toHaveLength(1);
        expect(ds[0].parts[1].text).toBe("1|2");
    });
    it("未知部件名/未知标记行丢弃该段，不影响后续", () => {
        const ds = parseDrafts(
            "@@Q type=single\n@@P stem\n题干\n@@P FOO\n垃圾内容\n@@P ans\nA\n@@END\n@@Q type=judge\n@@P stem\n判断\n@@P ans\n×\n@@END"
        );
        expect(ds).toHaveLength(2);
        expect(ds[0].parts.some((p) => p.name === "stem")).toBe(true);
        expect(ds[0].parts.map((p) => p.name)).not.toContain("FOO");
        expect(ds[0].parts.map((p) => p.text).join()).not.toContain("垃圾内容");
    });
    it("AI 退回 kramdown 习惯的噪声行（IAL/定界）按行剥除", () => {
        const ds = parseDrafts(
            '@@Q type=single\n@@P stem\n{{{row\n题干\n{: id="20260821165017-abcdef12"}\n@@P ans\nB\n}}}' + "\n@@END"
        );
        expect(ds).toHaveLength(1);
        expect(ds[0].parts[0].text).toBe("题干");
    });
    it("答案部件规整：引述前缀/「正确答案：」标签剥掉、\\| 还原", () => {
        const ds = parseDrafts("@@Q type=fill\n@@P stem\n____\n@@P ans\n> 正确答案：1\\|2");
        expect(ds[0].parts[1].text).toBe("1|2");
    });
    it("无 stem 的题目单元丢弃（与旧过滤口径一致）；材料块只要部件非空即收", () => {
        expect(parseDrafts("@@Q type=single\n@@P ans\nB\n@@END")).toHaveLength(0);
        const ds = parseDrafts("@@Q material=1\n@@P body\n阅读材料\n@@END");
        expect(ds).toHaveLength(1);
        expect(ds[0].material).toBe(true);
    });
    it("材料块与题目混排保序（group=prev 依赖顺序）", () => {
        const ds = parseDrafts(
            "@@Q material=1\n@@P body\n材料\n@@END\n@@Q type=single group=prev\n@@P stem\n题\n@@P ans\nA\n@@END"
        );
        expect(ds.map((d) => (d.material ? "m" : "q"))).toEqual(["m", "q"]);
        expect(ds[1].attrs.group).toBe("prev");
    });
});

describe("renderUnit 落盘形态", () => {
    it("单题渲染：容器定界/部件 IAL/字母按序/引述块/容器属性行", () => {
        const kd = renderUnit(parseDrafts(SIMPLE)[0]);
        expect(kd).toContain("{{{row");
        expect(kd).toMatch(/\n\}\}\}\n\{: custom-plugin-wengu-q="1"/);
        expect(kd).toContain('{: custom-plugin-wengu-part="stem"}');
        expect(kd).toContain('- A. $1$\n- B. $0$\n- C. $\\infty$\n{: custom-plugin-wengu-part="option-0"}');
        expect(kd).toContain('> B\n{: custom-plugin-wengu-part="answer"}');
        expect(kd).toContain('> 应用等价无穷小代换。\n{: custom-plugin-wengu-part="solution"}');
        expect(kd).toContain('custom-plugin-wengu-type="single"');
        expect(kd).toContain('custom-plugin-wengu-knowledge="洛必达"');
        // 容器 IAL 必须是收尾行（createDocWithMd 落属性的前提）
        expect(/^\s*$/.test(kd.slice(kd.lastIndexOf("\n") + 1))).toBe(false);
        expect(
            kd
                .trimEnd()
                .endsWith(
                    '{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single" custom-plugin-wengu-knowledge="洛必达" custom-plugin-wengu-chapter="第一章"}'
                )
        ).toBe(true);
    });
    it("多段题干=多个 stem 块；解析多段=多个 solution 块", () => {
        const d = parseDrafts(
            "@@Q type=brief\n@@P stem\n第一段。\n\n第二段。\n@@P sol\n解析一。\n\n解析二。\n@@END"
        )[0];
        const kd = renderUnit(d);
        expect(kd.match(/\{: custom-plugin-wengu-part="stem"\}/g)).toHaveLength(2);
        expect(kd.match(/\{: custom-plugin-wengu-part="solution"\}/g)).toHaveLength(2);
    });
    it("material 单元：material=1 容器、无 q 属性、部件为 body/trans", () => {
        const d = parseDrafts("@@Q material=1\n@@P body\n原文段落。\n\n第二段。\n@@P trans\n参考译文。\n@@END")[0];
        const kd = renderUnit(d);
        expect(kd).not.toContain("custom-plugin-wengu-q=");
        expect(kd).toContain('{: custom-plugin-wengu-material="1"}');
        expect(kd.match(/\{: custom-plugin-wengu-part="body"\}/g)).toHaveLength(2);
        expect(kd).toContain('{: custom-plugin-wengu-part="trans"}');
    });
    it("steps：步号部件齐全、steps 属性渲染、每步选项合并进各自列表块", () => {
        const reply = [
            "@@Q type=steps steps=method|result knowledge=考点",
            "@@P stem",
            "计算……",
            "@@P step",
            "第 1 步 · 选方法",
            "@@P step-opt",
            "洛必达",
            "@@P step-opt",
            "等价无穷小",
            "@@P step-ans",
            "AB",
            "@@P step",
            "第 2 步 · 结果",
            "@@P step-opt",
            "1",
            "@@P step-opt",
            "0",
            "@@P step-ans",
            "B",
            "@@P sol",
            "解析",
            "@@END",
        ].join("\n");
        const kd = renderUnit(parseDrafts(reply)[0]);
        expect(kd).toContain('custom-plugin-wengu-steps="method|result"');
        expect(kd).toContain('> AB\n{: custom-plugin-wengu-part="step-1-answer"}');
        expect(kd).toContain('- A. 洛必达\n- B. 等价无穷小\n{: custom-plugin-wengu-part="step-1-option-0"}');
        expect(kd).toContain('- A. 1\n- B. 0\n{: custom-plugin-wengu-part="step-2-option-0"}');
        expect(kd).toContain('> B\n{: custom-plugin-wengu-part="step-2-answer"}');
    });
    it("cloze：slot 部件空号递增、逐空选项合并", () => {
        const reply = [
            "@@Q type=cloze knowledge=完形",
            "@@P stem",
            "材料见前。",
            "@@P slot-opt",
            "A. 走", // AI 写不写字母都行——渲染只按位置编字母，内容原样
            "@@P slot-opt",
            "跑",
            "@@P slot-ans",
            "B",
            "@@P slot-opt",
            "大",
            "@@P slot-opt",
            "小",
            "@@P slot-ans",
            "A",
            "@@END",
        ].join("\n");
        const kd = renderUnit(parseDrafts(reply)[0]);
        expect(kd).toContain('- A. A. 走\n- B. 跑\n{: custom-plugin-wengu-part="slot-1-option-0"}');
        expect(kd).toContain('> B\n{: custom-plugin-wengu-part="slot-1-answer"}');
        expect(kd).toContain('- A. 大\n- B. 小\n{: custom-plugin-wengu-part="slot-2-option-0"}');
        expect(kd).toContain('> A\n{: custom-plugin-wengu-part="slot-2-answer"}');
    });
    it("src-key/src-hash 随容器 IAL 落盘（增量哈希基线）；difficulty 仅合法数字", () => {
        const d = parseDrafts("@@Q type=single difficulty=3\n@@P stem\n题\n@@P ans\nA\n@@END")[0];
        const kd = renderUnit(d, { srcKey: 'H:第一章/习题"1', srcHash: "abc-123" });
        expect(kd).toContain('custom-plugin-wengu-difficulty="3"');
        expect(kd).toContain('custom-plugin-wengu-src-key="H:第一章/习题 1"'); // 引号消毒
        expect(kd).toContain('custom-plugin-wengu-src-hash="abc-123"');
        const bad = parseDrafts("@@Q type=single difficulty=九\n@@P stem\n题\n@@END")[0];
        expect(renderUnit(bad)).not.toContain("difficulty");
    });
    it("渲染确定性：同 draft 两次渲染逐字相等（指纹稳定）", () => {
        const d = parseDrafts(SIMPLE)[0];
        expect(renderUnit(d)).toBe(renderUnit(d));
    });
    it("渲染结果可被 BankParse 消化（契约兼容的直接证据）", () => {
        const kd = renderUnit(parseDrafts(SIMPLE)[0]);
        expect(kd).toMatch(/\{\{\{row/);
        expect(kd).toContain('custom-plugin-wengu-q="1"');
        expect(kd).toContain('custom-plugin-wengu-type="single"');
    });
});

describe("applyKnowDrafts / kpRefs 渲染", () => {
    const byAlias = new Map<string, KnowSection>([
        ["K1", { id: "20260101000000-aaaaaaa", title: "极限", path: "高数/极限" }],
        ["K2", { id: "20260101000000-bbbbbbb", title: "等价无穷小", path: "高数/等价无穷小" }],
    ]);

    it("know 别名解析成 kpRefs、临时属性删除、引用并入解析块", () => {
        const ds = parseDrafts('@@Q type=single know="K1,K2"\n@@P stem\n题\n@@P ans\nA\n@@P sol\n解析。\n@@END');
        expect(applyKnowDrafts(ds, byAlias)).toBe(1);
        const kd = renderUnit(ds[0]);
        expect(kd).not.toContain("custom-plugin-wengu-know=");
        expect(kd).toContain('> 相关知识点：((20260101000000-aaaaaaa "极限")) ((20260101000000-bbbbbbb "等价无穷小"))');
        expect(kd).toContain('{: custom-plugin-wengu-part="solution"}');
    });
    it("无解别名：know 属性仍删除但不算注入成功；无解析块时补 solution 块", () => {
        const ds = parseDrafts('@@Q type=single know="K9"\n@@P stem\n题\n@@P ans\nA\n@@END');
        expect(applyKnowDrafts(ds, byAlias)).toBe(0);
        const kd = renderUnit(ds[0]);
        expect(kd).not.toContain("custom-plugin-wengu-know=");
        expect(kd).not.toContain("相关知识点");
        // 有解别名但题没有解析块：渲染补独立 solution 引述块挂引用
        const noSol = parseDrafts('@@Q type=single know="K1"\n@@P stem\n题\n@@P ans\nA\n@@END');
        expect(applyKnowDrafts(noSol, byAlias)).toBe(1);
        const kd2 = renderUnit(noSol[0]);
        expect(kd2).toContain('> 相关知识点：((20260101000000-aaaaaaa "极限"))');
        expect(kd2).toContain('{: custom-plugin-wengu-part="solution"}');
    });
});

describe("renderUnit · 答案字母与选项内容一致性（洗牌后渲染）", () => {
    it("洗牌后答案字母指向的渲染位置正是原正确项", () => {
        const d = parseDrafts(
            "@@Q type=single\n@@P stem\n题\n@@P opt\n正确项\n@@P opt\n干扰一\n@@P opt\n干扰二\n@@P opt\n干扰三\n@@P ans\nA\n@@END"
        )[0];
        shuffleDraftOptions(d);
        const kd = renderUnit(d);
        const ans = /^> ([A-D])$/m.exec(kd.split("{{{row")[1].split("}}}")[0])?.[1] ?? "";
        expect(ans).toMatch(/^[A-D]$/);
        const items = kd.match(/^- ([A-D])\. (.+)$/gm) ?? [];
        const pos = items.findIndex((l) => l.endsWith("正确项"));
        expect("ABCD".indexOf(ans)).toBe(pos);
    });
});
