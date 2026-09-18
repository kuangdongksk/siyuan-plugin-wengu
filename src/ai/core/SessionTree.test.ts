import { beforeAll, describe, expect, it } from "vitest";
import type { AiSessionRecord } from "../data/AiSessions";
import { buildSessionTree, groupRowName, leafStateOf, subjectOf } from "./SessionTree";
import { AI_STOPPED } from "../data/AiSessions";

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

describe("叶子行视图（Issue #88：状态点 + 任务名 + 状态徽标）", () => {
    it("三态各给一套点色/徽标色/词：running 带转圈，done/error 不带", () => {
        const d = buildSessionTree(
            [
                rec("r1", "convert", 30, { action: "转换", status: "running" }),
                rec("d1", "convert", 20, { action: "转换", status: "done" }),
                rec("e1", "convert", 10, { action: "转换", status: "error" }),
            ],
            "",
            zhLabel,
            (k) => ({ aiStatusRunning: "running", aiStatusDone: "done", aiStatusError: "error" })[k] ?? k
        );
        const conv = d.branchByKey.get("k:convert")!.recs.map((r) => r.id);
        expect(conv).toEqual(["r1", "d1", "e1"]);
        expect(d.leafViewByKey.get("r1")).toMatchObject({
            dotCls: "run",
            badgeCls: "run",
            badgeText: "running",
            spin: true,
        });
        expect(d.leafViewByKey.get("d1")).toMatchObject({ dotCls: "done", badgeCls: "done", spin: false });
        expect(d.leafViewByKey.get("e1")).toMatchObject({ dotCls: "fail", badgeCls: "fail", spin: false });
        // 行名=树里那份（剥过尾随主题），不会与 n.name 漂移
        const leafNode = d.nodes[0].children[0].children.find((n) => n.key === "r1")!;
        expect(d.leafViewByKey.get("r1")?.name).toBe(leafNode.name);
    });

    it("被停止的记录出「停止」态（琥珀 stopped），不与真失败混同", () => {
        const t2 = (k: string): string => k;
        const d = buildSessionTree(
            [
                { ...rec("s1", "convert", 20, { status: "error" }), error: AI_STOPPED } as never,
                rec("f1", "convert", 10, { status: "error" }),
            ],
            "",
            zhLabel,
            t2
        );
        expect(d.leafViewByKey.get("s1")).toMatchObject({ dotCls: "stop", badgeCls: "stop", spin: false });
        expect(d.leafViewByKey.get("f1")).toMatchObject({ dotCls: "fail", badgeCls: "fail" });
        // 展示态折算（比 record.status 多一档）：error + 停止哨兵 = stop
        expect(leafStateOf({ status: "error", error: AI_STOPPED } as never)).toBe("stop");
        expect(leafStateOf({ status: "error", error: "超时" } as never)).toBe("fail");
        expect(leafStateOf({ status: "running" } as never)).toBe("run");
        expect(leafStateOf({ status: "done" } as never)).toBe("done");
    });

    it("排队等槽不在树行发后缀（设计稿叶子行只有「点 + 名 + 徽标」三件）", () => {
        const t2 = (k: string): string => k;
        const run = buildSessionTree(
            [{ ...rec("q", "judge", 1, { status: "running" }), queued: true } as never],
            "",
            zhLabel,
            t2
        );
        expect(run.leafViewByKey.get("q")).toMatchObject({ dotCls: "run", spin: true });
        expect(Object.keys(run.leafViewByKey.get("q")!)).not.toContain("queuedNote");
    });

    it("二级组行名=「类别 · 文档名」组合；种类级（无主题）只出类别名", () => {
        expect(groupRowName("convert", "高等数学", zhLabel)).toBe("转换 · 高等数学");
        expect(groupRowName("convert", undefined, zhLabel)).toBe("转换");
    });

    it("状态词与色名是**两套词表**，组行不得拿状态词拼色类（Issue #92 踩坑）", () => {
        // 组行的聚合状态是**状态词**（running/done/error）——组件若照它拼
        // `is-{status}` 会得到 is-running/is-error 这类**无规则死类**
        // （样式族只认色名 run/done/fail），留下 8px 透明空位把 A1 的正文
        // 起点 14/27px 顶到 29/42px。故组行**不渲染色点**（设计稿 tg1/tg2
        // 也只有「caret + 名字」）。此例锁死两套词表互不相交这件事本身：
        // 一旦有人把色名改成状态词（或反过来），下面第一/二条会先炸。
        const d = buildSessionTree(
            [
                rec("r1", "convert", 30, { action: "转换", status: "running" }),
                rec("r2", "convert", 20, { action: "转换", status: "done" }),
                rec("r3", "convert", 10, { action: "转换", status: "error" }),
            ],
            "",
            zhLabel
        );
        const statusWords = new Set(["running", "done", "error"]);
        const colorNames = new Set(["run", "done", "fail", "skip", "stop", "queued", "cancel"]);
        // ① 分支视图给的是状态词（供文案/聚合判定用）
        const branchStatus = d.branchByKey.get("k:convert")!.status;
        expect(statusWords.has(branchStatus)).toBe(true);
        // ② 叶子视图给的是色名（可直接进 class）
        for (const key of ["r1", "r2", "r3"]) {
            const lv = d.leafViewByKey.get(key)!;
            expect(colorNames.has(lv.dotCls)).toBe(true);
            expect(colorNames.has(lv.badgeCls)).toBe(true);
        }
        // ③ 两套词表只在 done 上重叠——正是「拿状态词拼色类」看起来能过、
        //    实际只有 done 命中、running/error 静默失效的原因
        expect([...statusWords].filter((w) => colorNames.has(w))).toEqual(["done"]);
    });
});

/**
 * #170（20260918）**叶行注记的形态**：`wengu-aipanel-meta` 是 #129 的间隙期
 * 产物，它叠加在**常驻**徽标之后就是「点 + 名 + 注记 + 徽标」四件——设计稿
 * leaf 只有三件，窄侧栏下运行中行最挤。故运行中整条不渲染、其余行只留时刻
 * （类别由组行表达）。组件不挂载进单测，规格走**源级锁**（同
 * `AiPanelGapRestore.test` 口径：vite 的 `?raw` 读源码）。 */
describe("叶行注记形态（源级锁：运行中不出 + 去类别段只留时刻）", () => {
    let app = "";
    let zh = "";

    beforeAll(async () => {
        app = (await import("../components/SessionPanelApp.svelte?raw")).default;
        zh = (await import("../../i18n/zh-CN.json")).default.aiRowMeta as string;
    });

    /** 树叶子行的那段 main 片段（组行/ trailers 都在别处，切片防误伤详情头）。 */
    const leafSnippet = (): string => {
        const i = app.indexOf("wengu-aipanel-dot is-");
        const j = app.indexOf("</snippet>", i);
        expect(i, "找不到叶行渲染片段").toBeGreaterThan(-1);
        return app.slice(i, j);
    };

    it("运行中行不渲染注记（判据取视图 spin，与徽标转圈同源）", () => {
        const leaf = leafSnippet();
        // 注记的渲染条件自带 `!lv?.spin`——运行中整条让位给三件套
        expect(leaf).toContain("!lv?.spin");
        // ⚠️ 不许拿**色名**（视图词表）或**状态词**（数据词表）当判据：#92 的
        //    踩坑就是两套词表混用，只有 done 命中、run 静默失效
        const cond = leaf.slice(leaf.indexOf("{#if"), leaf.indexOf("wengu-aipanel-meta"));
        expect(cond).not.toContain("dotCls");
        expect(cond).not.toContain("status");
    });

    it("注记只喂时间：不再注入类别段（kind 参数已从模板与调用点双双移除）", () => {
        const leaf = leafSnippet();
        expect(leaf).toContain('fmt(t("aiRowMeta"), {');
        expect(leaf).toContain("time: rowStamp(");
        expect(leaf).not.toContain("kind:");
        // 两语言模板都一段式（分隔符是排版约定，不该再拼类别）
        expect(zh).not.toContain("{kind}");
        expect(zh.trim()).toBe("{time}");
    });

    it("详情头的 meta 槽不受影响（S7 留槽口径：常空 span 仍在）", async () => {
        const detail = (await import("../components/SessionDetail.svelte?raw")).default;
        expect(detail).toContain('class="wengu-aipanel-meta"></span>');
    });
});
