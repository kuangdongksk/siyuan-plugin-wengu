import { describe, expect, it } from "vitest";
import type { AiSessionRecord } from "../data/AiSessions";
import { buildSessionTree, subjectOf } from "./SessionTree";

/** 贴真格式的记录构造：组标题/标题=「{动作} · {主题}」（ConvertBatch
 *  同款）；opts.fullGroup 模拟检测类真实形态——组标题=文档、自身标题
 *  带进度（前段检测 · N/21）。 */
const rec = (
    id: string,
    kind: string,
    createdAt: number,
    opts: {
        group?: string;
        action?: string;
        subject?: string;
        status?: AiSessionRecord["status"];
        fullGroup?: boolean;
    } = {}
) => {
    const action = opts.action ?? kind;
    const subject = opts.subject ?? "高等数学";
    const title = `${action} · ${subject}`;
    const groupTitle = opts.fullGroup ? "转换 · 高等数学-题解" : title;
    return {
        id,
        kind,
        title,
        model: "m1",
        createdAt,
        status: opts.status ?? "done",
        turns: [{ role: "user", text: "q" }],
        ...(opts.group ? { group: opts.group, groupTitle } : {}),
    } as AiSessionRecord;
};

describe("subjectOf 主题提取", () => {
    it("取第一个「 · 」后的部分（组标题优先）；无分隔符/截取为空 → undefined", () => {
        expect(subjectOf({ title: "转换 · 高等数学", groupTitle: "转换 · 高等数学" } as AiSessionRecord)).toBe(
            "高等数学"
        );
        expect(subjectOf({ title: "前段检测 · 13/21", groupTitle: "转换 · 高等数学" } as AiSessionRecord)).toBe(
            "高等数学"
        );
        expect(subjectOf({ title: "裸标题" } as AiSessionRecord)).toBeUndefined();
        expect(subjectOf({ title: "前后 · " } as AiSessionRecord)).toBeUndefined();
    });
});

const zhLabel = (k: string): string => ({ convert: "转换", detect: "检测", judge: "判题" })[k] ?? k;

describe("buildSessionTree 种类优先树（20260903 改版）", () => {
    it("顶层一类一棵树：转换/检测各自成节点；同主题调用归文档节点并剥尾随主题", () => {
        const d = buildSessionTree(
            [
                rec("g5", "convert", 50, { group: "g1", action: "转换" }),
                rec("d21", "detect", 47, { group: "g1", action: "前段检测", subject: "21/21" }),
                rec("d20", "detect", 46, { group: "g1", action: "前段检测", subject: "20/21" }),
                rec("g4", "convert", 40, { group: "g1", action: "转换" }),
            ],
            "",
            zhLabel
        );
        expect(d.nodes.map((n) => [n.key, n.name])).toEqual([
            ["k:convert", "转换"],
            ["k:detect", "检测"],
        ]);
        // 转换树：两调用同主题 → 文档分支，成员行剥尾随「 · 高等数学」
        const conv = d.nodes[0];
        expect(conv.children.map((c) => [c.kind, c.name])).toEqual([["branch", "高等数学"]]);
        expect(conv.children[0].children.map((c) => c.name)).toEqual(["转换", "转换"]);
        // 检测树：每次调用主题各异（N/21）→ 不设文档层，全名直接出行
        expect(d.nodes[1].children.map((c) => c.name)).toEqual(["前段检测 · 21/21", "前段检测 · 20/21"]);
        expect(d.branchByKey.get("k:convert")).toMatchObject({ kind: "convert", createdAt: 50, status: "done" });
        expect(d.recByKey.get("g5")?.id).toBe("g5");
    });

    it("检测类真形态：组标题=文档 → 检测树也出文档层，成员行保留进度全名", () => {
        const d = buildSessionTree(
            [
                rec("d2", "detect", 2, { group: "g1", action: "前段检测", subject: "13/21", fullGroup: true }),
                rec("d1", "detect", 1, { group: "g1", action: "前段检测", subject: "12/21", fullGroup: true }),
            ],
            "",
            zhLabel
        );
        const detect = d.nodes[0];
        expect(detect.children.map((c) => c.name)).toEqual(["高等数学-题解"]);
        expect(detect.children[0].children.map((c) => c.name)).toEqual(["前段检测 · 13/21", "前段检测 · 12/21"]);
    });

    it("同主题 ≥2 条成文档分支；跨次运行同文档合并（转换树下高等数学/线代并列）", () => {
        const d = buildSessionTree(
            [
                rec("n1", "convert", 40, { group: "gB", action: "转换" }),
                rec("o1", "convert", 30, { group: "gA", action: "转换" }),
                rec("o2", "convert", 20, { group: "gA", action: "转换", subject: "线代" }),
            ],
            "",
            zhLabel
        );
        expect(d.nodes[0].children.map((c) => c.name)).toEqual(["高等数学", "转换 · 线代"]);
        expect(d.branchByKey.get("k:convert/高等数学")?.recs.map((r) => r.id)).toEqual(["n1", "o1"]);
        // 线代单条主题不设层，叶子上提保留全名（剥了就丢文档信息）
        expect(d.nodes[0].children[1]).toMatchObject({ kind: "doc", name: "转换 · 线代" });
    });

    it("单条种类不设种类层直接出行（判题等单发动作用）", () => {
        const d = buildSessionTree(
            [
                rec("j1", "judge", 10, { action: "判题", subject: "题干甲" }),
                rec("c1", "convert", 5, { group: "g1", action: "转换" }),
                rec("c2", "convert", 2, { group: "g1", action: "转换" }),
            ],
            "",
            zhLabel
        );
        expect(d.nodes.map((n) => n.key)).toEqual(["j1", "k:convert"]);
        expect(d.branchByKey.has("k:convert")).toBe(true);
    });

    it("状态聚合两级都生效：running > error > done", () => {
        const d = buildSessionTree(
            [
                rec("a", "convert", 3, { group: "g1", status: "running" }),
                rec("b", "convert", 2, { group: "g1", status: "error" }),
            ],
            "",
            zhLabel
        );
        expect(d.branchByKey.get("k:convert/高等数学")?.status).toBe("running");
        expect(d.branchByKey.get("k:convert")?.status).toBe("running");
    });

    it("类别过滤=记录透镜：只留该类记录，层级照常收敛；滤空整树消失", () => {
        const recs = [
            rec("c1", "convert", 30, { group: "g1", action: "转换" }),
            rec("d1", "detect", 25, { group: "g1", action: "前段检测" }),
            rec("d2", "detect", 20, { group: "g1", action: "前段检测" }),
            rec("j1", "judge", 10),
        ];
        const d = buildSessionTree(recs, "detect");
        expect(d.nodes.map((n) => n.key)).toEqual(["k:detect"]);
        expect(d.nodes[0].children[0].children.map((c) => c.key)).toEqual(["d1", "d2"]);
        expect(buildSessionTree(recs, "regen").nodes).toHaveLength(0);
    });
});
