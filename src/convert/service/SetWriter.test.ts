import { describe, expect, it } from "vitest";
import type { BankData, QuestionBank } from "../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../bank/data/QuestionBank";
import { questionHash } from "../../bank/data/BankParse";
import { SetWriter } from "./SetWriter";
import type { DraftUnit } from "./QuestionDraft";
import { parseQuestionKramdown } from "../../bank/data/BankParse";

// node 测试环境无 window，markDirty 防抖定时器走 globalThis 顶上
(globalThis as { window?: unknown }).window ??= globalThis;

/**
 * 题集写入器（20260903 转换产物直写题库）：渲染-解析回路一致性
 * （record.kramdown 能被 BankParse 原样解析、字段与旧「落文档再回读」
 * 产物同构）、材料直配 group、丢弃回收。
 */

function newBank(): { bank: QuestionBank; data: () => BankData } {
    let cache: BankData | undefined;
    const bank = new Bank(
        async () =>
            (cache ??= {
                version: 1,
                records: {},
                collections: [],
                migratedDocs: [],
                hashed: {},
                knowRoots: [],
                folders: [],
                knowHidden: [],
                docStats: {},
                sets: {},
                materials: {},
            } as BankData),
        async (v) => {
            cache = v;
        }
    );
    return { bank, data: () => cache! };
}

const question = (extra: Record<string, string> = {}): DraftUnit => ({
    material: false,
    attrs: { type: "single", knowledge: "极限", ...extra },
    parts: [
        { name: "stem", text: "求 $\\lim_{x \\to 0}$" },
        { name: "option-0", text: "正确项" },
        { name: "option-0", text: "干扰项" },
        { name: "answer", text: "A" },
        { name: "solution", text: "解析文字" },
    ],
});

const material = (): DraftUnit => ({
    material: true,
    attrs: {},
    parts: [
        { name: "body", text: "阅读原文第一段。" },
        { name: "trans", text: "译文。" },
    ],
});

describe("SetWriter", () => {
    it("openSet 建集与源卷影子专题；append 写记录（渲染-解析回路一致）", async () => {
        const { bank, data } = newBank();
        const w = new SetWriter(bank);
        const setId = await w.openSet({ title: "高数讲义", srcId: "src-1", hPath: "/数学/高数讲义" });
        const out = await w.append(setId, [{ draft: question(), srcKey: "H:a/b", srcHash: "hh-1" }]);
        const d = data();
        expect(out.qids).toHaveLength(1);
        const qid = out.qids[0];
        const r = d.records[qid]!;
        // 与旧 refreshDocFor 产物同构：kramdown 可解析、指纹同口径、元数据齐
        const parsed = parseQuestionKramdown(r.kramdown, qid, setId);
        expect(parsed).toMatchObject({ type: "single", knowledge: "极限", stemMd: "求 $\\lim_{x \\to 0}$" });
        expect(r.hash).toBe(questionHash(r.kramdown));
        expect(r.srcKey).toBe("H:a/b");
        expect(r.srcHash).toBe("hh-1");
        expect(r.sourceDocId).toBe(setId);
        expect(d.hashed[r.hash]).toBe(qid);
        expect(d.sets?.[setId]).toMatchObject({ title: "高数讲义", srcId: "src-1", qids: [qid] });
        expect(d.collections.find((c) => c.id === `doc:${setId}`)?.qids).toEqual([qid]);
    });

    it("材料入 bank.materials；紧随小题的 group=prev 直配材料 id（跨批保持）", async () => {
        const { bank, data } = newBank();
        const w = new SetWriter(bank);
        const setId = await w.openSet({ title: "英语卷" });
        const first = await w.append(setId, [
            { draft: material() },
            { draft: question({ type: "cloze", group: "prev" }) },
        ]);
        const mid = first.materials[0].id;
        expect(data().materials[mid]).toMatchObject({ setId, bodyMd: "阅读原文第一段。", transMd: "译文。" });
        expect(data().records[first.qids[0]].group).toBe(mid);
        // 下一批（新 flush）的 group=prev 仍指上一个材料
        const second = await w.append(setId, [{ draft: question({ type: "cloze", group: "prev" }) }]);
        expect(data().records[second.qids[0]].group).toBe(mid);
    });

    it("空材料跳过（body/trans 全空不入库）；渲染解析回路失败的题跳过", async () => {
        const { bank, data } = newBank();
        const w = new SetWriter(bank);
        const setId = await w.openSet({ title: "卷" });
        const out = await w.append(setId, [
            { draft: { material: true, attrs: {}, parts: [] } },
            { draft: { material: false, attrs: {}, parts: [{ name: "stem", text: "无 type 容器解析失败" }] } },
            { draft: question() },
        ]);
        expect(Object.keys(data().materials)).toHaveLength(0);
        expect(out.qids).toHaveLength(1);
        expect(data().sets?.[setId].qids).toHaveLength(1);
    });

    it("discard：题集全部来自本次写入 → 连集/材料/影子专题一起删；部分 → 只删记录", async () => {
        const { bank, data } = newBank();
        const w = new SetWriter(bank);
        const setId = await w.openSet({ title: "卷" });
        const a = await w.append(setId, [{ draft: question() }, { draft: question() }]);
        await w.discard(setId, a.qids.slice(0, 1)); // 部分丢弃
        expect(data().sets?.[setId].qids).toEqual([a.qids[1]]);
        await w.discard(setId, a.qids); // 清空
        expect(data().sets?.[setId]).toBeUndefined();
        expect(Object.keys(data().records)).toHaveLength(0);
        expect(data().collections.some((c) => c.id === `doc:${setId}`)).toBe(false);
    });
});

describe("SetWriter · 20260903 审查修复", () => {
    it("冷启动播种：新 writer 接管既有题集，首块 group=prev 指向库内最新材料", async () => {
        const { bank } = newBank();
        const w1 = new SetWriter(bank);
        const setId = await w1.openSet({ title: "英语卷" });
        await w1.append(setId, [{ draft: material() }, { draft: question({ type: "cloze", group: "prev" }) }]);
        const mid = (await bank.all()).materials ? Object.keys((await bank.all()).materials)[0] : "";
        // 新 writer（增量重转换/续跑同款）：不播种会丢跨块 group
        const w2 = new SetWriter(bank);
        await w2.openSet({ setId, title: "英语卷" });
        const out = await w2.append(setId, [{ draft: question({ type: "brief", group: "prev" }) }]);
        expect(out.questions[0]?.group).toBe(mid);
        expect(Object.values((await bank.all()).records).find((r) => r.qid === out.qids[0])?.group).toBe(mid);
    });

    it("渐进预览出口：out.questions 的材料组题带 group（DrillUnits 组装直用）", async () => {
        const { bank } = newBank();
        const w = new SetWriter(bank);
        const setId = await w.openSet({ title: "英语卷" });
        const out = await w.append(setId, [
            { draft: material() },
            { draft: question({ type: "cloze", group: "prev" }) },
        ]);
        expect(out.questions[0]?.group).toBe(out.materials[0]?.id);
    });

    it("丢弃空题集（只出材料的批）连 set/材料/影子专题一起回收", async () => {
        const { bank, data } = newBank();
        const w = new SetWriter(bank);
        const setId = await w.openSet({ title: "空卷" });
        const out = await w.append(setId, [{ draft: material() }]);
        expect(out.qids).toHaveLength(0);
        await w.discard(setId, out.qids);
        expect(data().sets?.[setId]).toBeUndefined();
        expect(Object.keys(data().materials ?? {})).toHaveLength(0);
        expect(data().collections.find((c) => c.id === `doc:${setId}`)).toBeUndefined();
    });
});
