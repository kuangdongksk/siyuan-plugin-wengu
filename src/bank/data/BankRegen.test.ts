import { describe, expect, it } from "vitest";

// node 测试环境无 window：QuestionBank.markDirty 的防抖定时器走
// window.setTimeout——globalThis 顶上（同 BankHealth/BankSets 口径）
(globalThis as { window?: unknown }).window ??= globalThis;

/**
 * 题库重生成族友元函数（Issue #115）：BankHealth/BankRepair/BankRecording
 * 都有测试，独缺 BankRegen 这条**替换**路径。真机风险集中在三点：
 *  ① replaceRecordKramdown 换了 kramdown 却漏更新指纹/解析缓存 → 增量
 *     重转换按旧指纹判定「未变更」（漏转）或解析视图吃到旧题；
 *  ② 旧格式组链（group 写在容器 IAL 里）没随替换迁到记录字段 → 重生成
 *     一次就断组（20260903 审查 P1①）；
 *  ③ 重挂 kpRefs 不去重/不计数 → 「已处理」数字虚高或二次重挂。
 * 这里用内存真题库逐条钉死（内核 IO 不进单测）。
 */

import {
    addGenerated,
    appendToCollection,
    collectKpRefs,
    ensureCollection,
    questionsRelatedToDoc,
    recordOf,
    recordsByKeys,
    recordsOfDoc,
    remapKpRef,
    replaceRecordKramdown,
} from "./BankRegen";
import { parseQuestionKramdown, questionHash } from "./BankParse";
import { QuestionBank } from "./QuestionBank";
import type { BankData, BankRecord } from "./QuestionBank";

/** 合法题目 kramdown（契约 §一 的落盘形态）：容器超级块 `{{{row` +
 *  尾行容器 IAL（custom-plugin-wengu-q / -type）+ part 子块。 */
function kd(text: string, extraAttr = ""): string {
    return [
        "{{{row",
        "{{{",
        text,
        '{: custom-plugin-wengu-part="stem"}',
        "}}}",
        "",
        "{{{",
        "解析……",
        '{: custom-plugin-wengu-part="solution"}',
        "}}}",
        "}}}",
        `{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"${extraAttr}}`,
    ].join("\n");
}

function rec(qid: string, patch: Partial<BankRecord> = {}): BankRecord {
    const kramdown = patch.kramdown ?? kd(`题干 ${qid}`);
    return {
        qid,
        kramdown,
        type: "single",
        kpRefs: [],
        sourceDocId: "",
        hash: questionHash(kramdown),
        stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
        ...patch,
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
        docStats: {},
        sets: {},
        materials: {},
        ...seed,
    } as unknown as BankData;
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

describe("replaceRecordKramdown · 重生成替换", () => {
    it("换 kramdown：指纹同步换新、新指纹可反查 qid、旧指纹条目清掉", async () => {
        const old = kd("旧题干");
        const { bank, read } = newBank([rec("q1", { kramdown: old })]);
        const next = kd("新题干");
        expect(questionHash(next)).not.toBe(questionHash(old)); // 前提：内容变了指纹就得变
        expect(await replaceRecordKramdown(bank, "q1", next)).toBe(true);
        const data = read();
        expect(data.records.q1.kramdown).toBe(next);
        expect(data.records.q1.hash).toBe(questionHash(next));
        expect(data.hashed[questionHash(next)]).toBe("q1");
        expect(data.hashed[questionHash(old)]).toBeUndefined();
    });

    it("题不存在返回 false 且不动数据", async () => {
        const { bank, read } = newBank([rec("q1")]);
        expect(await replaceRecordKramdown(bank, "nope", kd("x"))).toBe(false);
        expect(Object.keys(read().records)).toEqual(["q1"]);
    });

    it("解析缓存被失效（下一次 parsedOf 落空，不会吃到旧题的解析）", async () => {
        const { bank } = newBank([rec("q1")]);
        const parsed = parseQuestionKramdown(kd("题干 q1"), "q1")!;
        bank.cacheParsed("q1", questionHash(kd("题干 q1")), parsed);
        expect(bank.parsedOf("q1", questionHash(kd("题干 q1")))).toBeDefined();
        await replaceRecordKramdown(bank, "q1", kd("改了"));
        expect(bank.parsedOf("q1", questionHash(kd("题干 q1")))).toBeUndefined();
    });

    it("旧格式组链（group 在容器 IAL 里）趁替换迁到记录字段", async () => {
        const legacy = `${kd("题干 q1")}\n{: custom-plugin-wengu-group="g1"}`;
        const { bank, read } = newBank([rec("q1", { kramdown: legacy, group: undefined })]);
        await replaceRecordKramdown(bank, "q1", kd("重生成后的题"));
        expect(read().records.q1.group).toBe("g1");
        // 新 kramdown 不再落 group IAL（迁移是单向的）
        expect(read().records.q1.kramdown).not.toContain("wengu-group");
    });

    it("已是新格式（记录已带 group）不覆盖为 IAL 里的值", async () => {
        const legacy = `${kd("题干 q1")}\n{: custom-plugin-wengu-group="old"} `;
        const { bank, read } = newBank([rec("q1", { kramdown: legacy, group: "kept" })]);
        await replaceRecordKramdown(bank, "q1", kd("新"));
        expect(read().records.q1.group).toBe("kept");
    });

    it('IAL 里 group="prev" 是相对占位，不迁（否则组链指针变成字面量）', async () => {
        const legacy = `${kd("题干 q1")}\n{: custom-plugin-wengu-group="prev"}`;
        const { bank, read } = newBank([rec("q1", { kramdown: legacy, group: undefined })]);
        await replaceRecordKramdown(bank, "q1", kd("新"));
        expect(read().records.q1.group).toBeUndefined();
    });
});

describe("collectKpRefs / remapKpRef · 引用收集与重挂", () => {
    it("收集全库引用 id→标题，同 id 只留首次标题", async () => {
        const { bank } = newBank([
            rec("q1", { kpRefs: [{ id: "kp-1", title: "极限" }] }),
            rec("q2", {
                kpRefs: [
                    { id: "kp-1", title: "极限" },
                    { id: "kp-2", title: "导数" },
                ],
            }),
            rec("q3"),
        ]);
        expect([...(await collectKpRefs(bank)).entries()]).toEqual([
            ["kp-1", "极限"],
            ["kp-2", "导数"],
        ]);
    });

    it("重挂只动引用该 id 的记录，返回被改记录数并落盘", async () => {
        const { bank, read } = newBank([
            rec("q1", { kpRefs: [{ id: "kp-old", title: "极限" }] }),
            rec("q2", { kpRefs: [{ id: "kp-other", title: "导数" }] }),
        ]);
        expect(await remapKpRef(bank, "kp-old", "kp-new", "极限")).toBe(1);
        expect(read().records.q1.kpRefs).toEqual([{ id: "kp-new", title: "极限" }]);
        expect(read().records.q2.kpRefs).toEqual([{ id: "kp-other", title: "导数" }]);
    });

    it("同一记录里的重复引用全部换掉（重挂幂等：二次重挂零命中）", async () => {
        const { bank } = newBank([
            rec("q1", {
                kpRefs: [
                    { id: "kp-old", title: "极限" },
                    { id: "kp-old", title: "极限" },
                ],
            }),
        ]);
        expect(await remapKpRef(bank, "kp-old", "kp-new", "极限")).toBe(1); // 记为「一条记录」
        expect(await remapKpRef(bank, "kp-old", "kp-new", "极限")).toBe(0); // 已无该 id
    });

    it("无命中返回 0（不白记脏）", async () => {
        const { bank } = newBank([rec("q1")]);
        expect(await remapKpRef(bank, "kp-old", "kp-new", "极限")).toBe(0);
    });
});

describe("questionsRelatedToDoc · 反查", () => {
    it("两条判据取并集：sourceDocId 命中 或 kpRefs 落在该文档下", async () => {
        const { bank } = newBank([
            rec("q1", { sourceDocId: "doc-1" }),
            rec("q2", { kpRefs: [{ id: "kp-1", title: "极限" }] }),
            rec("q3", { sourceDocId: "doc-9", kpRefs: [{ id: "kp-2", title: "导数" }] }),
        ]);
        const roots = new Map([
            ["kp-1", "doc-1"],
            ["kp-2", "doc-2"],
        ]);
        const out = await questionsRelatedToDoc(bank, "doc-1", roots);
        expect(out.map((r) => r.qid)).toEqual(["q1", "q2"]);
        expect(out[0].stem).toContain("题干 q1"); // 题干摘要（剥离 md 后截 60 字）
    });

    it("空 docId → 空清单（不误把全库当相关）", async () => {
        const { bank } = newBank([rec("q1", { sourceDocId: "doc-1" })]);
        expect(await questionsRelatedToDoc(bank, "", new Map())).toEqual([]);
    });

    it("全量不截断（弹窗与专题题单须逐条一致）", async () => {
        const records = Array.from({ length: 60 }, (_v, i) => rec(`q${i}`, { sourceDocId: "doc-1" }));
        const { bank } = newBank(records);
        expect((await questionsRelatedToDoc(bank, "doc-1", new Map())).length).toBe(60);
    });
});

describe("recordsByKeys · 薄弱键取记录", () => {
    it("kp:/kn:/ch: 三类键都命中（kn 键双向归一）", async () => {
        const { bank } = newBank([
            rec("q1", { kpRefs: [{ id: "kp-1", title: "极限" }] }),
            rec("q2", { knowledge: "极限的运算" }),
            rec("q3", { chapter: "第一章" }),
        ]);
        expect((await recordsByKeys(bank, ["kp:kp-1"])).map((r) => r.qid)).toEqual(["q1"]);
        expect((await recordsByKeys(bank, ["kn:极限的运算"])).map((r) => r.qid)).toEqual(["q2"]);
        expect((await recordsByKeys(bank, ["ch:第一章"])).map((r) => r.qid)).toEqual(["q3"]);
    });

    it("无关键返回空（不误召回）", async () => {
        const { bank } = newBank([rec("q1", { chapter: "第一章" })]);
        expect(await recordsByKeys(bank, ["ch:第九章"])).toEqual([]);
    });
});

describe("recordsOfDoc · 按源卷取题", () => {
    it("只取该源卷、按 qid 稳定序（变式取模板】）", async () => {
        const { bank } = newBank([
            rec("q-b", { sourceDocId: "doc-1" }),
            rec("q-a", { sourceDocId: "doc-1" }),
            rec("q-c", { sourceDocId: "doc-2" }),
        ]);
        expect((await recordsOfDoc(bank, "doc-1")).map((r) => r.qid)).toEqual(["q-a", "q-b"]);
    });
});

describe("addGenerated / ensureCollection / appendToCollection", () => {
    it("新题入库：qid 自分配、指纹入表、可反查", async () => {
        const { bank, read } = newBank([]);
        const text = kd("生成的新题");
        const qid = await addGenerated(bank, text, [{ id: "kp-1", title: "极限" }], "专题A");
        expect(qid.startsWith("gen-")).toBe(true);
        const r = read().records[qid];
        expect(r.kramdown).toBe(text);
        expect(r.type).toBe("single");
        expect(r.kpRefs).toEqual([{ id: "kp-1", title: "极限" }]);
        expect(r.sourceDocId).toBe(""); // 生成题无源卷
        expect(read().hashed[questionHash(text)]).toBe(qid);
    });

    it("同一内容二次生成直接复用 qid（指纹去重、不重复入库）", async () => {
        const { bank, read } = newBank([]);
        const text = kd("生成的新题");
        const first = await addGenerated(bank, text, [], "专题A");
        const second = await addGenerated(bank, text, [], "专题A");
        expect(second).toBe(first);
        expect(Object.keys(read().records)).toEqual([first]);
    });

    it("从解析取 knowledge/chapter/difficulty 落到记录字段", async () => {
        const { bank, read } = newBank([]);
        const text = kd("题干", ' custom-plugin-wengu-knowledge="极限" custom-plugin-wengu-chapter="第一章"');
        const qid = await addGenerated(bank, text, [], "专题A");
        expect(read().records[qid].knowledge).toBe("极限");
        expect(read().records[qid].chapter).toBe("第一章");
    });

    it("解析失败抛错（不落半条脏记录）", async () => {
        const { bank, read } = newBank([]);
        await expect(addGenerated(bank, "", [], "专题A")).rejects.toThrow("generated question parse failed");
        expect(Object.keys(read().records)).toEqual([]);
    });

    it("目标专题存在则该题同时入集（同题不重复挂）", async () => {
        const { bank, read } = newBank([], {
            collections: [{ id: "col-1", title: "专题A", qids: [], origin: "manual", createdAt: 0 }],
        } as Partial<BankData>);
        const qid = await addGenerated(bank, kd("新题"), [], "专题A");
        expect(read().collections[0].qids).toEqual([qid]);
        await appendToCollection(bank, "专题A", qid); // 重复挂被去重
        await appendToCollection(bank, "专题A", qid);
        expect(read().collections[0].qids).toEqual([qid]);
    });

    it("无专题时不建（appendToCollection 只管已有集）", async () => {
        const { bank, read } = newBank([]);
        await appendToCollection(bank, "不存在", "q-x");
        expect(read().collections).toEqual([]);
    });

    it("ensureCollection 建缺失的专题，已存在则幂等", async () => {
        const { bank, read } = newBank([]);
        await ensureCollection(bank, "专题A");
        await ensureCollection(bank, "专题A");
        expect(read().collections.map((c) => c.title)).toEqual(["专题A"]);
        expect(read().collections[0].origin).toBe("manual");
        expect(read().collections[0].qids).toEqual([]);
    });
});

describe("recordOf", () => {
    it("取到存档记录；不存在返回 undefined", async () => {
        const { bank } = newBank([rec("q1")]);
        expect((await recordOf(bank, "q1"))?.qid).toBe("q1");
        expect(await recordOf(bank, "nope")).toBeUndefined();
    });
});
