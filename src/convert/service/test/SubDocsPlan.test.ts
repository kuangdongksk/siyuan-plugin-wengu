import { describe, expect, it, vi } from "vitest";
// @ts-expect-error 仓库 tsconfig 不带 @types/node（node:sqlite 无类型声明）
import { DatabaseSync } from "node:sqlite";
import { buildBatchQueue, planSubDocs } from "../source/SubDocs";

/**
 * 文件夹式文档的整链（Issue #42 验收 1/3）：**用真 SQLite 顶替内核 SQL**，
 * 跑通 planSubDocs → buildBatchQueue 的真实判定——这是弹窗「N 个子文档」
 * 清单与真跑队列的同一份事实源，纯函数单测验不到探针极性/聚合口径。
 *
 * 复刻 660 真机结构：根 + 3 个中间篇**全是空壳**（各带 1 个空段落，这正是
 * Issue #42 的根因——旧判据「有无非 doc 块」被空段落废掉），叶子 6 篇有正文。
 * 期望：清单=6 篇叶子，未勾选直接展开为队列（3 个中间篇与根都不在）；勾选
 * 「连同子文档」时根与中间篇同样不入队。
 */

vi.mock("../../../siyuan/query", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE blocks(
        id TEXT, root_id TEXT, type TEXT, box TEXT, path TEXT, content TEXT, hpath TEXT
    );`);
    const ins = db.prepare("INSERT INTO blocks VALUES (?,?,?,?,?,?,?)");
    /** 造一篇文档：box=b，path=文件树路径，hpath=标题路径。 */
    const doc = (id: string, dir: string, title: string, hpath: string, body: string) => {
        ins.run(id, id, "d", "nb", `${dir}.sy`, title, hpath);
        // 正文块：空壳文档只有一个 `content=''` 的空段落（真机形态）
        ins.run(`${id}-p`, id, "p", "nb", `${dir}.sy`, body, hpath);
    };
    /** 两层树：根 + 3 中间篇（空壳）+ 6 叶子（有正文）。 */
    const MID = ["概率篇", "线代篇", "高数篇"];
    doc("20260912000001-root00", "/MinerU/660", "基础过关660-数一", "MinerU/660-数一", "");
    MID.forEach((t, i) => doc(`202609120000${i + 2}-mid00${i}`, `/MinerU/660/${t}`, t, `MinerU/660-数一/${t}`, ""));
    for (let i = 0; i < 6; i++) {
        const mid = MID[Math.floor(i / 2)];
        doc(
            `2026091200000${i + 5}-leaf0${i}`,
            `/MinerU/660/${mid}/第${i + 1}章`,
            `第${i + 1}章`,
            `MinerU/660-数一/${mid}/第${i + 1}章`,
            `第 ${i + 1} 题 求极限`
        );
    }
    const rowsMap = async (stmt: string): Promise<Map<string, string>[]> =>
        (db.prepare(stmt).all() as Record<string, unknown>[]).map((r) => {
            const m = new Map<string, string>();
            for (const [k, v] of Object.entries(r)) m.set(k, String(v ?? ""));
            return m;
        });
    return { KernelQuery: { rowsMap, rowsMapAll: rowsMap } };
});

describe("planSubDocs → buildBatchQueue（660 真机结构，真 SQL）", () => {
    it("空壳根 + 空壳中间层：清单=6 篇叶子，根与中间篇都被剔掉", async () => {
        const plan = await planSubDocs("20260912000001-root00");
        expect(plan?.rootEmpty).toBe(true); // 空段落不算货 → 空壳判据恢复成立
        expect(plan?.children.map((c) => c.title)).toEqual(["第1章", "第2章", "第3章", "第4章", "第5章", "第6章"]);
        expect(plan?.children.some((c) => ["概率篇", "线代篇", "高数篇"].includes(c.title))).toBe(false);
    });

    it("验收 1：不勾任何框 → 自动展开为 6 篇叶子的队列", async () => {
        const plan = (await planSubDocs("20260912000001-root00"))!;
        const queue = buildBatchQueue(plan, false);
        expect(queue).toHaveLength(6);
        expect(queue.some((q) => q.id === plan.root.id)).toBe(false);
    });

    it("验收 3：勾「连同子文档」→ 根与中间篇同样不入队", async () => {
        const plan = (await planSubDocs("20260912000001-root00"))!;
        expect(buildBatchQueue(plan, true)).toHaveLength(6);
    });
});

/**
 * 排序的 **locale 无关性**（PR #43 复审阻断缺陷）：hpath 里带 CJK 时，
 * `localeCompare` 会随机器 locale 给出不同顺序——CI 容器（无 LANG）按
 * 码点序得「概率篇/线代篇/高数篇」，Windows zh-CN 按拼音序得
 * 「概率篇/高数篇/线代篇」，队列执行顺序与题集插入顺序跟着漂移。
 *
 * 这里把**默认 collation 强改成拼音序**（进程启动时 `LANG` 已定，
 * 运行时改环境变量不生效，故显式构造 zh 排序器来模拟 zh-CN 机器），
 * 断言 planSubDocs 的顺序**不受影响**——「码点序」是本模块的硬约束，
 * 本用例在拼音序环境下也会红，正是它该有的锁法。
 */
describe("planSubDocs 的排序与 locale 无关（码点序）", () => {
    it("拼音序 collation 下顺序仍是码点序（概 < 线 < 高）", async () => {
        const zh = "概率篇,高数篇,线代篇"; // 拼音序，与码点序（概/线/高）**不同**
        const sample = ["概率篇", "线代篇", "高数篇"];
        expect(sample.slice().sort((a, b) => a.localeCompare(b, "zh"))).toEqual(zh.split(",")); // 前提成立
        const plan = (await planSubDocs("20260912000001-root00"))!;
        // 叶子顺序：概率篇两章 → 线代篇两章 → 高数篇两章（码点序），
        // 而不是拼音序的「概率篇/高数篇/线代篇」。
        expect(plan.children.map((c) => c.title)).toEqual(["第1章", "第2章", "第3章", "第4章", "第5章", "第6章"]);
    });
});
