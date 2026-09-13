import { describe, expect, it } from "vitest";
import {
    buildBatchQueue,
    hasTextProbeSql,
    isBatchQueue,
    middleLayerIds,
    shellIds,
    type SubDocPlan,
    type SubDocRef,
} from "../source/SubDocs";
// @ts-expect-error 仓库 tsconfig 不带 @types/node（node:sqlite 无类型声明）；判空探针的真行为必须真跑 SQL 才算验过
import { DatabaseSync } from "node:sqlite";

/**
 * 批量转换队列组装（Issue #37）：纯函数口径——勾选「连同子文档」=根+后代；
 * 文件夹式文档（根空）在不勾选时也自动展开为只跑后代，避免对空根白跑一趟
 * 报「文档内容为空」。isBatchQueue 定「是否真起队列」。
 *
 * Issue #42 追加：`middleLayerIds` 定「谁是目录」（hPath 是别人前缀），
 * 调用方据此只对候选问一次 SQL，**空壳中间层不入队**。
 */

const root = { id: "20260828145729-djgn748", title: "肖秀荣1000题-题解版" };
const kids = [
    { id: "20260828145730-aaaaaaaa", title: "01-马原-题解" },
    { id: "20260828145731-bbbbbbbb", title: "02-毛中特-题解" },
];

describe("isBatchQueue", () => {
    it("多篇：起队列", () => {
        expect(isBatchQueue([root, ...kids], root.id)).toBe(true);
    });

    it("单篇且就是源自身：不起队列（与单篇流程等价）", () => {
        expect(isBatchQueue([root], root.id)).toBe(false);
    });

    it("空队列：不起队列（回落单篇，把报错交给它）", () => {
        expect(isBatchQueue([], root.id)).toBe(false);
    });

    it("单篇但**不是**源自身：起队列（空壳文件夹只有 1 个子文档，转的必须是子文档）", () => {
        expect(isBatchQueue([kids[0]], root.id)).toBe(true);
    });
});

describe("buildBatchQueue", () => {
    it("勾选「连同子文档」：根在前 + 全部后代", () => {
        const plan: SubDocPlan = { root, children: kids, rootEmpty: false };
        expect(buildBatchQueue(plan, true).map((d) => d.id)).toEqual([root.id, kids[0].id, kids[1].id]);
    });

    it("未勾选且根非空：只跑根自身", () => {
        const plan: SubDocPlan = { root, children: kids, rootEmpty: false };
        expect(buildBatchQueue(plan, false).map((d) => d.id)).toEqual([root.id]);
    });

    it("文件夹式文档（根空）：未勾选也自动展开为只跑后代", () => {
        const plan: SubDocPlan = { root, children: kids, rootEmpty: true };
        expect(buildBatchQueue(plan, false).map((d) => d.id)).toEqual([kids[0].id, kids[1].id]);
    });

    it("空根且勾选连带：不把空根塞进队列（零产物白跑一趟）", () => {
        const plan: SubDocPlan = { root, children: kids, rootEmpty: true };
        expect(buildBatchQueue(plan, true).map((d) => d.id)).toEqual([kids[0].id, kids[1].id]);
    });

    it("空根且无后代：空队列（调用方回落单篇流程，报「文档内容为空」）", () => {
        const plan: SubDocPlan = { root, children: [], rootEmpty: true };
        expect(buildBatchQueue(plan, true)).toEqual([]);
        expect(buildBatchQueue(plan, false)).toEqual([]);
    });

    it("根非空但无后代：未勾选=只根；勾选也=只根（无后代可带）", () => {
        const plan: SubDocPlan = { root, children: [], rootEmpty: false };
        expect(buildBatchQueue(plan, false).map((d) => d.id)).toEqual([root.id]);
        expect(buildBatchQueue(plan, true).map((d) => d.id)).toEqual([root.id]);
    });
});

/** 660 式两层树：根下 3 个中间篇，每篇下 2 篇题解（真机结构）。 */
const folderRoot: SubDocRef = { id: "20260912000001-root00", title: "基础过关660-数一", hPath: "MinerU/660-数一" };
const mids: SubDocRef[] = [
    { id: "20260912000002-mid000", title: "概率篇", hPath: "MinerU/660-数一/概率篇" },
    { id: "20260912000003-mid001", title: "线代篇", hPath: "MinerU/660-数一/线代篇" },
    { id: "20260912000004-mid002", title: "高数篇", hPath: "MinerU/660-数一/高数篇" },
];
const leaves: SubDocRef[] = [
    { id: "20260912000005-leaf00", title: "第1章 随机事件", hPath: "MinerU/660-数一/概率篇/第1章" },
    { id: "20260912000006-leaf01", title: "第2章 随机变量", hPath: "MinerU/660-数一/概率篇/第2章" },
    { id: "20260912000007-leaf02", title: "第1章 行列式", hPath: "MinerU/660-数一/线代篇/第1章" },
    { id: "20260912000008-leaf03", title: "第2章 矩阵", hPath: "MinerU/660-数一/线代篇/第2章" },
    { id: "20260912000009-leaf04", title: "第1章 函数极限", hPath: "MinerU/660-数一/高数篇/第1章" },
    { id: "20260912000010-leaf05", title: "第2章 导数", hPath: "MinerU/660-数一/高数篇/第2章" },
];

describe("middleLayerIds", () => {
    it("两层树：根与 3 个中间篇都是目录；叶子一篇都不算", () => {
        const ids = middleLayerIds([folderRoot, ...mids, ...leaves]);
        expect(ids.sort()).toEqual([folderRoot.id, ...mids.map((m) => m.id)].sort());
        for (const leaf of leaves) expect(ids).not.toContain(leaf.id);
    });

    it("平铺 5 篇（肖秀荣场景）：无目录，零候选 → 不发起任何 SQL", () => {
        const flat: SubDocRef[] = Array.from({ length: 5 }, (_, i) => ({
            id: `2026082814573${i}-flat00${i}`,
            title: `0${i + 1}-题解`,
            hPath: `MinerU/肖1000/0${i + 1}-题解`,
        }));
        expect(middleLayerIds(flat)).toEqual([]);
    });

    it("同前缀不同目录不误判（「A/B」不是「A/BC」的前缀）", () => {
        const refs: SubDocRef[] = [
            { id: "20260912000011-ab0000", title: "B", hPath: "A/B" },
            { id: "20260912000012-abc000", title: "BC", hPath: "A/BC" },
            { id: "20260912000013-abc001", title: "BC-1", hPath: "A/BC/1" },
        ];
        expect(middleLayerIds(refs)).toEqual(["20260912000012-abc000"]);
    });

    it("hPath 缺失（查不到标题路径）不参与判定，也不因空串误伤", () => {
        const refs: SubDocRef[] = [
            { id: "20260912000014-nohp00", title: "无路径根" },
            { id: "20260912000015-hp0000", title: "有路径子", hPath: "X/Y" },
        ];
        expect(middleLayerIds(refs)).toEqual([]);
    });

    it("去重：同一目录被列两次只回一个 id", () => {
        const dup: SubDocRef[] = [
            { id: "20260912000016-dup000", title: "篇", hPath: "R/篇" },
            { id: "20260912000017-dup001", title: "章", hPath: "R/篇/章" },
            { id: "20260912000018-dup002", title: "章二", hPath: "R/篇/章二" },
        ];
        expect(middleLayerIds(dup)).toEqual(["20260912000016-dup000"]);
    });
});

describe("buildBatchQueue（Issue #42 真机结构）", () => {
    it("空壳中间层已剔：未勾选 → 队列=6 篇叶子，根与中间篇都不在", () => {
        const trimmed = leaves; // planSubDocs 已按「空壳才剔」滤过中间层
        const plan: SubDocPlan = { root: folderRoot, children: trimmed, rootEmpty: true };
        const queue = buildBatchQueue(plan, false);
        expect(queue.map((d) => d.id)).toEqual(leaves.map((l) => l.id));
        expect(queue.some((d) => d.id === folderRoot.id)).toBe(false);
        expect(queue.some((d) => mids.some((m) => m.id === d.id))).toBe(false);
    });

    it("勾选「连同子文档」：根与中间篇同样不入队（有内容没内容都不入目录）", () => {
        const plan: SubDocPlan = { root: folderRoot, children: leaves, rootEmpty: true };
        expect(buildBatchQueue(plan, true).map((d) => d.id)).toEqual(leaves.map((l) => l.id));
    });

    it("中间层有真实内容（未剔）时照常入队——剔除只认空壳", () => {
        const withMid: SubDocRef[] = [
            leaves[0],
            { id: "20260912000019-mid003", title: "上篇", hPath: "MinerU/660-数一/上篇" },
        ];
        const plan: SubDocPlan = { root: folderRoot, children: withMid, rootEmpty: false };
        expect(buildBatchQueue(plan, true).map((d) => d.id)).toEqual([
            folderRoot.id,
            leaves[0].id,
            "20260912000019-mid003",
        ]);
    });
});

/**
 * 判空探针的真行为（Issue #42 复审）：**端到端跑真 SQLite**——极性（回的是
 * 「有正文」还是「空壳」）与 LIMIT 截断这两条口径在纯函数断言里都验不出来，
 * 而它们各自都能静默毁掉一个真机场景：
 *  - 极性反了 → 有货的中间层被当空壳剔除 = **静默漏转**（比不剔除更坏）；
 *  - 带了 LIMIT 1 → 整批只回一篇，多候选判定失真。
 * 故这里建内存库复刻 660 真机结构，拿 probeSql 的产物直接查。
 */
describe("hasTextProbeSql / shellIds（真机结构，真 SQL）", () => {
    /** 复刻 blocks 表（判空只用 root_id/type/content 三列）。 */
    function dbWith(rows: [string, string, string][]) {
        const db = new DatabaseSync(":memory:");
        db.exec("CREATE TABLE blocks(id TEXT, root_id TEXT, type TEXT, content TEXT);");
        const ins = db.prepare("INSERT INTO blocks VALUES (?,?,?,?)");
        for (const [id, rootId, content] of rows) ins.run(id, rootId, "p", content);
        return db;
    }
    const query = (db: InstanceType<typeof DatabaseSync>, ids: string[]): string[] =>
        (db.prepare(hasTextProbeSql(ids)).all() as { docId: string }[]).map((r) => r.docId);

    /** 660 真机结构：根 + 3 个中间篇（各 1 个**空段落**）+ 3 篇有正文叶子。 */
    const MID = ["20260912000002-mid000", "20260912000003-mid001", "20260912000004-mid002"];
    const LEAF = ["20260912000005-leaf00", "20260912000006-leaf01", "20260912000007-leaf02"];
    const db = dbWith([
        ["20260912000001-root00-p", "20260912000001-root00", ""],
        ...MID.map((m): [string, string, string] => [m + "-p", m, ""]),
        ...LEAF.map((l): [string, string, string] => [l + "-p", l, "第 1 题 求极限"]),
    ]);

    it("空段落不算货：满屏空段落的中间篇一律不落「有正文」集合", () => {
        expect(query(db, ["20260912000001-root00", ...MID])).toEqual([]);
    });

    it("只含换行/制表符的段落同样不算货（TRIM 只去空格，故先 REPLACE）", () => {
        const db2 = dbWith([["20260912000008-mid003-p", "20260912000008-mid003", "\n\t\r  \n"]]);
        expect(query(db2, ["20260912000008-mid003"])).toEqual([]);
    });

    it("每篇一行：多候选一次查全（LIMIT 1 会让这里只剩一篇 → 锁定该回归）", () => {
        expect(query(db, LEAF).sort()).toEqual([...LEAF].sort());
    });

    it("有正文的中间层不落空壳（防「极性反了 = 静默漏转有货文档」）", () => {
        const cand = [...MID];
        const withText = query(db, cand);
        expect(shellIds(cand, withText).sort()).toEqual([...MID].sort()); // 3 篇全空壳 → 全剔
        // 其中「概率篇」补上正文 → 只有它被留住（不再剔除）
        const db3 = dbWith([["20260912000009-mid009-p", "20260912000009-mid009", "本篇正文"]]);
        expect(shellIds(["20260912000009-mid009"], query(db3, ["20260912000009-mid009"]))).toEqual([]);
    });

    it("SQL 形状：DISTINCT 按篇聚合、无 LIMIT（64 行截断坑同族）", () => {
        const sql = hasTextProbeSql(MID);
        expect(sql).toContain("DISTINCT");
        expect(sql).not.toMatch(/LIMIT/i);
        expect(hasTextProbeSql([])).toBe("");
        expect(hasTextProbeSql(["a", "a"]).split("'a'").length - 1).toBe(1); // 去重：同一 id 只进 IN 列表一次
    });
});
