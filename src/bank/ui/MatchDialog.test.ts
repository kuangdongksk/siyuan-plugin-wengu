import { describe, expect, it } from "vitest";
import type { BankRecord } from "../data/QuestionBank";
import { routeTextOf, sourceDocOptions } from "./MatchDialog";

const rec = (qid: string, src: string): BankRecord =>
    ({
        qid,
        kramdown: "",
        type: "brief",
        kpRefs: [],
        sourceDocId: src,
        hash: qid,
        stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
    }) as BankRecord;

describe("sourceDocOptions", () => {
    it("按源卷聚合计数、题数降序；gen- 生成题（无源卷）不计入", () => {
        const out = sourceDocOptions([rec("q1", "docA"), rec("q2", "docA"), rec("q3", "docB"), rec("q4", "")]);
        expect(out).toEqual([
            { docId: "docA", count: 2 },
            { docId: "docB", count: 1 },
        ]);
    });

    it("空题库 → 空候选", () => {
        expect(sourceDocOptions([])).toEqual([]);
    });
});

describe("routeTextOf", () => {
    it("题干+选项优先，解析失败退整段 kramdown", () => {
        const kd = `{{{row
{: custom-plugin-wengu-part="stem"}
函数极限的保号性

{: custom-plugin-wengu-part="option-1"}
A. 对

{: custom-plugin-wengu-part="answer"}
A
}}}
{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="choice"}`;
        expect(routeTextOf({ ...rec("q9", "d"), kramdown: kd })).toContain("保号性");
        // 解析失败（无容器结构）退整段 kramdown
        expect(routeTextOf({ ...rec("q9", "d"), kramdown: "裸文本题目" })).toBe("裸文本题目");
    });
});
