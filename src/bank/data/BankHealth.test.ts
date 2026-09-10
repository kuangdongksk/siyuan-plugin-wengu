import { describe, expect, it } from "vitest";
import { parseDrafts, renderUnit } from "../../convert/service/draft/QuestionDraft";
import { parseQuestionKramdown, questionHash } from "./BankParse";
import { applyBankHealth, scanBankHealth } from "./BankHealth";
import type { HealthAutoKind } from "./BankHealth";
import { QuestionBank } from "./QuestionBank";
import type { BankData, BankRecord } from "./QuestionBank";

// node 测试环境无 window（vitest 不启 jsdom），markDirty 防抖定时器走
// window.setTimeout——globalThis 顶上（同 BankSets.test）
(globalThis as { window?: unknown }).window ??= globalThis;

/**
 * 题库体检核心不变量：① 结构检查按题型出正确的问题标签（健康题零误报，
 * 挤行形态不再影子误报 answer-range）；② 引用/索引类发现与应用闭环
 * （应用后重扫归零，含孤儿材料→组链解除的级联顺序）；③ 挤行走
 * planOptionRepair 的预览即所得产物；④ 重复内容只报告不动数据。
 * fixture 走真实管线（parseDrafts+renderUnit）。
 */

const reply = (...lines: string[]): string => lines.join("\n");

const healthySingle = reply(
    "@@Q type=single",
    "@@P stem",
    "下列说法正确的是",
    "@@P opt",
    "甲",
    "@@P opt",
    "乙",
    "@@P opt",
    "丙",
    "@@P opt",
    "丁",
    "@@P ans",
    "A",
    "@@P sol",
    "解析……",
    "@@END"
);

/** 挤行协议回复：全部选项一行一个塞进同一 @@P opt（真机损坏形态）。 */
const packedSingle = reply(
    "@@Q type=single",
    "@@P stem",
    "3 位教师分配教 6 个班级，则分配方案共有",
    "@@P opt",
    "360种\n240种\n120种\n60种",
    "@@P ans",
    "C",
    "@@P sol",
    "解析……故选 A。",
    "@@END"
);

function kdOf(text: string): string {
    return renderUnit(parseDrafts(text)[0]);
}

function rec(qid: string, kd: string, extra: Partial<BankRecord> = {}): BankRecord {
    return {
        qid,
        kramdown: kd,
        type: parseQuestionKramdown(kd, qid)?.type ?? "brief",
        kpRefs: [],
        sourceDocId: "",
        hash: questionHash(kd),
        stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
        ...extra,
    };
}

function newBank(records: BankRecord[], seed: Partial<BankData> = {}): { bank: QuestionBank; read: () => BankData } {
    let cache: BankData = {
        version: 1,
        records: Object.fromEntries(records.map((r) => [r.qid, r])),
        collections: [],
        migratedDocs: [],
        hashed: Object.fromEntries(records.map((r) => [r.hash, r.qid])),
        knowRoots: [],
        folders: [],
        knowHidden: [],
        docStats: {},
        sets: {},
        materials: {},
        ...seed,
    } as BankData;
    return {
        bank: new QuestionBank(
            async () => cache,
            async (v) => {
                cache = v;
            }
        ),
        read: () => cache,
    };
}

/** auto 行的 kind→count 视图。 */
function autoMap(scan: Awaited<ReturnType<typeof scanBankHealth>>): Partial<Record<HealthAutoKind, number>> {
    return Object.fromEntries(scan.auto.map((r) => [r.kind, r.count]));
}

describe("scanBankHealth · 结构检查", () => {
    it("健康题（单选/判断/多选/多步/完形）零误报", async () => {
        const kds = [
            kdOf(healthySingle),
            kdOf(reply("@@Q type=judge", "@@P stem", "判断", "@@P ans", "对", "@@END")),
            kdOf(
                reply(
                    "@@Q type=multiple",
                    "@@P stem",
                    "多选",
                    "@@P opt",
                    "甲",
                    "@@P opt",
                    "乙",
                    "@@P opt",
                    "丙",
                    "@@P ans",
                    "AB",
                    "@@END"
                )
            ),
            kdOf(
                reply(
                    "@@Q type=steps steps=method",
                    "@@P stem",
                    "大题",
                    "@@P step",
                    "用什么方法",
                    "@@P step-opt",
                    "对称性",
                    "@@P step-ans",
                    "A",
                    "@@END"
                )
            ),
            kdOf(reply("@@Q type=cloze", "@@P stem", "完形", "@@P slot-opt", "甲", "@@P slot-ans", "A", "@@END")),
        ];
        const { bank } = newBank(kds.map((kd, i) => rec(`q${i}`, kd)));
        const s = await scanBankHealth(bank);
        expect(s.scanned).toBe(5);
        expect(s.regen).toHaveLength(0);
        expect(s.fixable).toHaveLength(0);
        expect(s.auto).toHaveLength(0);
        expect(s.dups).toHaveLength(0);
    });
    it("解析失败（容器属性残缺）不再静默不可见", async () => {
        const { bank } = newBank([rec("q1", "残缺内容，没有容器属性行")]);
        const s = await scanBankHealth(bank);
        expect(s.regen).toEqual([{ qid: "q1", stem: expect.any(String), set: "", issues: ["parse-fail"] }]);
    });
    it("判分断点：缺答案 / 答案字母越界 / 判断题答案形态非法 / 无选项", async () => {
        const noAns = kdOf(reply("@@Q type=single", "@@P stem", "题干", "@@P opt", "甲", "@@P opt", "乙", "@@END"));
        const range = kdOf(
            reply(
                "@@Q type=single",
                "@@P stem",
                "题干",
                "@@P opt",
                "甲",
                "@@P opt",
                "乙",
                "@@P opt",
                "丙",
                "@@P ans",
                "D",
                "@@END"
            )
        );
        const badJudge = kdOf(reply("@@Q type=judge", "@@P stem", "判断", "@@P ans", "也许", "@@END"));
        const noOpts = kdOf(reply("@@Q type=match", "@@P stem", "匹配", "@@P ans", "A", "@@END"));
        const { bank } = newBank([rec("q1", noAns), rec("q2", range), rec("q3", badJudge), rec("q4", noOpts)]);
        const s = await scanBankHealth(bank);
        expect(s.regen.map((r) => [r.qid, r.issues])).toEqual([
            ["q1", ["no-answer"]],
            ["q2", ["answer-range"]],
            ["q3", ["bad-answer"]],
            ["q4", ["noopts"]], // match 无选项部件：挤行判定链先收口（判分断点检查跳过）
        ]);
    });
    it("完形无空 / 空答案字母越界 / 多步题步答案缺失 / 题干缺失", async () => {
        const noSlots = kdOf(reply("@@Q type=cloze", "@@P stem", "完形", "@@P ans", "A", "@@END"));
        const slotRange = kdOf(
            reply("@@Q type=cloze", "@@P stem", "完形", "@@P slot-opt", "甲", "@@P slot-ans", "B", "@@END")
        );
        const noStepAns = kdOf(
            reply("@@Q type=steps steps=method", "@@P stem", "大题", "@@P step", "用什么方法", "@@END")
        );
        // 无题干形态 draft 管线会丢弃（hasStemPart），手写契约 kramdown
        const noStem = [
            "{{{row",
            "> 略",
            '{: custom-plugin-wengu-part="answer"}',
            "}}}",
            '{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="brief"}',
        ].join("\n");
        const { bank } = newBank([rec("q1", noSlots), rec("q2", slotRange), rec("q3", noStepAns), rec("q4", noStem)]);
        const s = await scanBankHealth(bank);
        expect(s.regen.map((r) => [r.qid, r.issues])).toEqual([
            ["q1", ["slots-broken"]],
            ["q2", ["answer-range"]],
            ["q3", ["steps-broken"]],
            ["q4", ["no-stem"]],
        ]);
    });
    it("挤行：single 进 fixable（不再影子误报 answer-range），multiple 进 regen", async () => {
        const packedMulti = kdOf(
            reply("@@Q type=multiple", "@@P stem", "多选", "@@P opt", "甲\n乙\n丙", "@@P ans", "AC", "@@END")
        );
        const { bank } = newBank([rec("q1", kdOf(packedSingle)), rec("q2", packedMulti)]);
        const s = await scanBankHealth(bank);
        expect(s.fixable).toHaveLength(1);
        expect(s.fixable[0].opts).toHaveLength(4);
        expect(s.regen.map((r) => [r.qid, r.issues])).toEqual([["q2", ["packed-multi"]]]);
    });
});

describe("scanBankHealth · 引用完整性与索引", () => {
    it("悬空 qid / 缺题集条目 / 孤儿材料 / 组链悬空 / 无题集标签", async () => {
        const kd = kdOf(healthySingle);
        const { bank } = newBank(
            [
                rec("q1", kd, { sourceDocId: "doc1" }),
                rec("q6", kd, { group: "mat2" }),
                rec("q7", kd, { group: "matX" }),
            ],
            {
                sets: { s1: { id: "s1", title: "卷一", qids: ["q1", "ghost"], createdAt: 0 } },
                collections: [{ id: "c1", title: "专题", qids: ["ghost2"], origin: "manual", createdAt: 0 }],
                materials: {
                    mat1: { id: "mat1", setId: "s1" }, // 无题引用 → 孤儿
                    mat2: { id: "mat2", setId: "gone" }, // 题集已删 → 孤儿
                },
            }
        );
        const s = await scanBankHealth(bank);
        expect(autoMap(s)).toEqual({
            "set-dangling": 1,
            "set-missing": 1,
            "col-dangling": 1,
            "mat-missing": 1, // q7→matX（q6→mat2 因扫描快照不算，应用时级联解除）
            "mat-orphan": 2,
        });
        // 无题集归属（gen- 题）显示标签由 UI 兜底，扫描里 set 为空串
        expect(s.scanned).toBe(3);
    });
    it("指纹失真 / 索引悬空 / 知识引用缺口 / 统计缺失 / 元数据漂移 / 重复内容", async () => {
        const kd = kdOf(healthySingle);
        const withKp = kdOf(
            reply(
                "@@Q type=single",
                "@@P stem",
                "题干",
                "@@P opt",
                "甲",
                "@@P opt",
                "乙",
                "@@P ans",
                "A",
                "@@P sol",
                '见 ((20260101010101-abcdef1 "洛必达法则"))',
                "@@END"
            )
        );
        const { bank } = newBank(
            [
                rec("q1", kd, { hash: "tampered" }),
                rec("q2", withKp, { stats: undefined as unknown as BankRecord["stats"] }),
                rec("q3", kd, { type: "brief" }),
                rec("q4", kd),
                rec("q5", kd),
            ],
            // 受控索引：ghost 悬空 + q1 现指纹缺项，其余记录条目齐全
            { hashed: { stale: "ghost", [questionHash(withKp)]: "q2", [questionHash(kd)]: "q4" } }
        );
        const s = await scanBankHealth(bank);
        expect(autoMap(s)).toEqual({
            "hash-bad": 1,
            "hashed-stale": 2, // ghost 悬空 + q1 新指纹缺项
            "kpref-gap": 1,
            "stats-missing": 1,
            "meta-drift": 1,
        });
        expect(s.dups).toHaveLength(1); // q1/q3/q4/q5 同内容（q1 指纹失真也按现算指纹归组）
        expect(s.dups[0].rows.map((r) => r.qid).sort()).toEqual(["q1", "q3", "q4", "q5"]);
    });
});

describe("applyBankHealth · 修复闭环", () => {
    it("引用与索引全修：应用后数据归位，重扫 auto 清零", async () => {
        const kd = kdOf(healthySingle);
        const withKp = kdOf(
            reply(
                "@@Q type=single",
                "@@P stem",
                "题干",
                "@@P opt",
                "甲",
                "@@P opt",
                "乙",
                "@@P ans",
                "A",
                "@@P sol",
                '见 ((20260101010101-abcdef1 "洛必达法则"))',
                "@@END"
            )
        );
        const { bank, read } = newBank(
            [
                rec("q1", kd, { sourceDocId: "doc1", hash: "tampered" }),
                rec("q6", kd, { group: "mat2" }),
                rec("q7", kd, { group: "matX" }),
                rec("q8", withKp),
            ],
            {
                sets: { s1: { id: "s1", title: "卷一", qids: ["q1", "ghost"], createdAt: 0 } },
                collections: [{ id: "c1", title: "专题", qids: ["ghost2"], origin: "manual", createdAt: 0 }],
                materials: { mat1: { id: "mat1", setId: "s1" }, mat2: { id: "mat2", setId: "gone" } },
            }
        );
        const all = new Set<HealthAutoKind>([
            "set-dangling",
            "set-missing",
            "col-dangling",
            "mat-missing",
            "mat-orphan",
            "hash-bad",
            "hashed-stale",
            "kpref-gap",
            "stats-missing",
            "meta-drift",
        ]);
        const n = await applyBankHealth(bank, all, []);
        expect(n.auto).toBeGreaterThan(0);
        const d = read();
        expect(d.sets.s1.qids).toEqual(["q1"]);
        expect(d.sets.doc1).toMatchObject({ id: "doc1", qids: ["q1"] }); // 缺条目补建
        expect(d.collections[0].qids).toEqual([]);
        expect(d.materials).toEqual({}); // 孤儿材料清除（含被 q6 引用但题集已删的 mat2）
        expect(d.records.q1.hash).toBe(questionHash(kd)); // 指纹重算
        expect(d.records.q6.group).toBeUndefined(); // 级联解除（mat2 先删后剥组链）
        expect(d.records.q7.group).toBeUndefined();
        expect(d.records.q8.kpRefs).toEqual([{ id: "20260101010101-abcdef1", title: "洛必达法则" }]);
        for (const [h, qid] of Object.entries(d.hashed)) expect(d.records[qid]?.hash).toBe(h); // 索引重建自洽
        const again = await scanBankHealth(bank);
        expect(again.auto).toHaveLength(0);
    });
    it("挤行修复：预览产物原样回写，判分闭环成立", async () => {
        const { bank, read } = newBank([rec("q1", kdOf(packedSingle))]);
        const s = await scanBankHealth(bank);
        expect(s.fixable).toHaveLength(1);
        const n = await applyBankHealth(
            bank,
            new Set(),
            s.fixable.map((r) => ({ qid: r.qid, kd: r.kd }))
        );
        expect(n.packed).toBe(1);
        const r = read().records.q1;
        const parsed = parseQuestionKramdown(r.kramdown, "q1");
        expect(parsed?.optionMd).toHaveLength(4);
        expect(parsed?.answer).toBe(s.fixable[0].answer);
        expect(r.hash).toBe(questionHash(r.kramdown));
        expect(read().hashed[r.hash]).toBe("q1");
    });
    it("重复内容只报告：不勾选任何类别时数据不动", async () => {
        const kd = kdOf(healthySingle);
        const { bank, read } = newBank([rec("q1", kd), rec("q2", kd)]);
        const s = await scanBankHealth(bank);
        expect(s.dups[0].rows).toHaveLength(2);
        await applyBankHealth(bank, new Set(), []);
        expect(Object.keys(read().records)).toEqual(["q1", "q2"]);
    });
});
