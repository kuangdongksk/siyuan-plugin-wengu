import { describe, expect, it } from "vitest";
import { parseDrafts, renderUnit } from "../../convert/service/QuestionDraft";
import { LETTERS, optionDisplayMd } from "../../types";
import { parseQuestionKramdown } from "./BankParse";
import { planOptionRepair } from "./BankRepair";

/**
 * 选项挤行修复的核心不变量：**预览即所得 + 判分闭环**——修复产物必须
 * 能被 BankParse 反解出拆开的选项，且新答案字母指向的选项内容=原首行
 * （协议规定的正确项）；除选项块与答案行外逐字节不动（指纹面最小变化，
 * 容器 IAL 的 src-key/src-hash 原样 → 增量重转换口径不受影响）。
 * fixture 走真实管线（parseDrafts+renderUnit 不洗牌）——20260905 真机
 * 损坏形态就是 unpack 修复上线前的这条链落出来的。
 */

/** 挤行协议回复：全部选项一行一个塞进同一 @@P opt。 */
function packedReply(type: string, opts: string, ans: string): string {
    return [
        `@@Q type=${type}`,
        "@@P stem",
        "3 位教师分配教 6 个班级，则分配方案共有",
        "@@P opt",
        opts,
        "@@P ans",
        ans,
        "@@P sol",
        "解析……故总方案数为 360，选 A。",
        "@@END",
    ].join("\n");
}

function damagedKd(type = "single", opts = "360种\n240种\n120种\n60种", ans = "C"): string {
    const d = parseDrafts(packedReply(type, opts, ans))[0];
    return renderUnit(d, { srcKey: "H:章/节/P0/#1", srcHash: "abc-def" });
}

describe("planOptionRepair · 挤行修复", () => {
    it("拆回独立选项，新答案字母指向原首行（正确项），其余内容逐字节不动", () => {
        const kd = damagedKd();
        const before = parseQuestionKramdown(kd, "q1");
        expect(before?.optionMd).toHaveLength(1); // 损坏形态复现
        const plan = planOptionRepair(kd);
        expect(plan.kind).toBe("fixable");
        if (plan.kind !== "fixable") return;
        expect(plan.opts).toHaveLength(4);
        const after = parseQuestionKramdown(plan.kd, "q1");
        expect(after?.optionMd).toHaveLength(4);
        expect(after?.answer).toBe(plan.answer);
        expect(optionDisplayMd(after?.optionMd[LETTERS.indexOf(plan.answer)] ?? "")).toBe("360种"); // 正确项跟着答案走
        expect(after?.stemMd).toBe(before?.stemMd); // 题干不动
        expect(after?.solutionMd).toBe(before?.solutionMd); // 解析不动
        expect(plan.kd).toContain('custom-plugin-wengu-src-key="H:章/节/P0/#1"'); // 容器 IAL 原样
        expect(plan.kd).toContain('custom-plugin-wengu-src-hash="abc-def"');
        expect(plan.kd.startsWith(kd.slice(0, kd.indexOf("\n- A.")))).toBe(true); // 选项块之前逐字节一致
    });
    it("健康多选项（各占一行带标签）不修", () => {
        const d = parseDrafts(
            [
                "@@Q type=single",
                "@@P stem",
                "题干",
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
                "@@END",
            ].join("\n")
        )[0];
        expect(planOptionRepair(renderUnit(d)).kind).toBe("none");
    });
    it("multiple/match 挤行不可推导正确集合 → regen", () => {
        expect(planOptionRepair(damagedKd("multiple"))).toEqual({ kind: "regen", reason: "packed-multi" });
        expect(planOptionRepair(damagedKd("match"))).toEqual({ kind: "regen", reason: "packed-multi" });
    });
    it("非客观题与单选项题不修", () => {
        expect(planOptionRepair(damagedKd("brief")).kind).toBe("none");
        expect(planOptionRepair(damagedKd("single", "唯一", "A"))).toEqual({ kind: "regen", reason: "one" });
    });
    it("答案部件缺失 → regen（没法重写判分字母）", () => {
        const d = parseDrafts(["@@Q type=single", "@@P stem", "题干", "@@P opt", "甲\n乙", "@@END"].join("\n"))[0];
        expect(planOptionRepair(renderUnit(d))).toEqual({ kind: "regen", reason: "answer" });
    });
    it("位置敏感措辞：拆行但保序，答案 A 指向首行", () => {
        const plan = planOptionRepair(damagedKd("single", "正确项\n干扰项\n以上都对", "B"));
        expect(plan).toMatchObject({ kind: "fixable", opts: ["正确项", "干扰项", "以上都对"], answer: "A" });
    });
    it("洗牌后正确项离开 A 位（消剧透），rng 可注入复现", () => {
        const plan = planOptionRepair(damagedKd(), () => 0.42);
        expect(plan.kind).toBe("fixable");
        if (plan.kind !== "fixable") return;
        expect(plan.answer).not.toBe("A");
        expect(plan.opts[LETTERS.indexOf(plan.answer)]).toBe("360种");
        expect(planOptionRepair(damagedKd(), () => 0.42)).toEqual(plan); // 同种子同结果
    });
});
