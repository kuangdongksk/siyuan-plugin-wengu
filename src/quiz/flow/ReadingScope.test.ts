import { describe, expect, it } from "vitest";
import type { DrillUnit } from "../render/DrillUnits";
import { QuestionType, type WenguQuestion, type WenguMaterial } from "../../types";
import { isReadingUnit, readingShellScope, unitStartIdx, wrapPlanOf } from "./ReadingScope";

/**
 * 阅读面作用域判定（Issue #81，Issue #83 **改结构判据**）——阅读面（凹槽
 * 阅读栏 + 衬线正文 + ¶ 段落序号 + 题卡间距阶梯）的判据是**材料组结构**
 * （材料块 + 依附小题 = 一题多问），与学科/题型**零关系**：英语阅读/完形、
 * 语文文言文、政治材料分析、工科一题多问都产出材料组，都该美化；独立题
 * （数学单选/填空）不挂。
 *
 * ⚠️ #81/#82 的「英语卷判别」是修错方向（#83 根因）：英语判别只服务
 * 「标生词」（见 AnnoScope.test）。本文件**不引入任何学科/题型输入**，
 * 正是这条「零学科依赖」的回归锁。
 */

/** 最小题（单元组装只读 id/group/type）。 */
const q = (id: string, extra: Partial<WenguQuestion> = {}): WenguQuestion => ({
    id,
    attempts: 0,
    wrongCount: 0,
    ...extra,
});

const mat = (id: string): WenguMaterial => ({ id, bodyMd: "正文" });

/** 组单元（材料组 = 材料块 + 依附小题，「一题多问」）。 */
const group = (mid: string, idxs: number[]): DrillUnit => ({
    kind: "group",
    mid,
    material: mat(mid),
    qs: idxs.map((idx) => ({ q: q(`g${idx}`, { group: mid }), idx })),
});

/** 独立题单元。 */
const single = (idx: number, type: QuestionType = QuestionType.Single): DrillUnit => ({
    kind: "single",
    q: q(`s${idx}`, { type }),
    idx,
});

describe("unitStartIdx：单元段首整卷下标（与 buildSetGroups.start 同口径）", () => {
    it("独立题取 idx、材料组取组内首题、空单元 -1", () => {
        expect(unitStartIdx(single(7))).toBe(7);
        expect(unitStartIdx(group("m1", [3, 4]))).toBe(3);
        expect(unitStartIdx({ kind: "group", mid: "m2", qs: [] })).toBe(-1);
        expect(unitStartIdx({ kind: "single" })).toBe(-1);
    });
});

describe("isReadingUnit 唯一真判据：材料组结构（Issue #83 验收 3）", () => {
    it("材料组单元判真、独立题单元判假", () => {
        expect(isReadingUnit(group("m1", [0, 1]))).toBe(true);
        expect(isReadingUnit(single(0))).toBe(false);
    });

    it("零依赖：判定不吃学科/题型（同结构不同题型 ⇒ 同结果）", () => {
        // 语文作文/翻译题（essay/trans）与英语单选在旧口径下会互判相反——
        // 现在两者都是「独立题单元」⇒ 一律判假，与题型无关
        expect(isReadingUnit(single(0, QuestionType.Single))).toBe(false);
        expect(isReadingUnit(single(1, QuestionType.Essay))).toBe(false);
        expect(isReadingUnit(single(2, QuestionType.Trans))).toBe(false);
        // 材料组同理：里面的题不管什么题型，单元判据只看结构
        expect(isReadingUnit(group("m1", [0]))).toBe(true);
    });
});

describe("readingShellScope 整壳类名口径（Issue #83 验收 1/2/3）", () => {
    it("验收 1/2：整卷都是材料组（英语阅读与语文文言文同形）⇒ 挂整壳", () => {
        expect(readingShellScope([group("m1", [0, 1])])).toBe(true);
        expect(readingShellScope([group("m1", [0, 1]), group("m2", [2])])).toBe(true);
    });

    it("验收 3：纯独立题卷（数学单选/填空）⇒ 不挂整壳（产物逐字节不变）", () => {
        expect(readingShellScope([single(0), single(1)])).toBe(false);
    });

    it("验收 3：同卷「独立题 + 一题多问」⇒ 不挂整壳（避免独立题卡被染上阅读面）", () => {
        expect(readingShellScope([single(0), group("m1", [1, 2])])).toBe(false);
        expect(readingShellScope([group("m1", [0, 1]), single(2)])).toBe(false);
    });

    it("空单元表 ⇒ 不挂（无题/未开刷）", () => {
        expect(readingShellScope([])).toBe(false);
    });
});

describe("wrapPlanOf 包装计划（Issue #83 验收 3/4；渲染层施工唯一依据）", () => {
    const plan = (units: DrillUnit[], segOf: number[]) => wrapPlanOf(units, segOf);

    it("整壳已覆盖（全材料组）⇒ 全 -1（零包装，产物与改造前同形）", () => {
        expect(plan([group("m1", [0, 1])], [0])).toEqual([-1]);
        expect(plan([group("m1", [0]), group("m2", [1])], [0, 0])).toEqual([-1, -1]);
    });

    it("验收 4：只给材料组单元开包装（独立题单元一律 -1，零装饰）", () => {
        // 数学段（独立题）在前、阅读段（材料组）在后
        expect(plan([single(0), single(1), group("m1", [2, 3])], [0, 0, 1])).toEqual([-1, -1, 0]);
        // 阅读段在前、数学段在后
        expect(plan([group("m1", [0, 1]), single(2), single(3)], [0, 0, 1, 1])).toEqual([0, -1, -1]);
        // 交错：中间插了独立题 ⇒ 每个材料组各起一个包装（序号单调）
        expect(plan([single(0), group("m1", [1]), single(2), group("m2", [3])], [0, 0, 1, 1])).toEqual([-1, 0, -1, 1]);
    });

    it("连续同段的材料组单元**共用**一个包装（少插 DOM）", () => {
        // 混一道独立题才不进「整壳覆盖」分支（全材料 ⇒ 全 -1，见上条）
        expect(plan([single(9), group("m1", [0]), group("m2", [1]), group("m3", [2])], [0, 0, 0, 0])).toEqual([
            -1, 0, 0, 0,
        ]);
    });

    it("⚠️ 跨题集段必须**断链**（否则该段首题跑到自己那行题集标题上面）", () => {
        // 题集标题行插在包装**外**，复用同一包装会让第二段的标题行落在
        // 包装之后、而首题被追加进包装（在标题行前）
        expect(plan([single(9), group("m1", [0]), group("m2", [1])], [0, 0, 1])).toEqual([-1, 0, 1]);
        // 段内继续复用、跨段断链（同一份表里两种情形都在）
        expect(plan([single(9), group("a", [0]), group("b", [1]), group("c", [2])], [0, 0, 0, 1])).toEqual([
            -1, 0, 0, 1,
        ]);
    });

    it("整壳已覆盖（全材料组）时跨段也不开包装（产物同形，标题行落外层）", () => {
        expect(plan([group("m1", [0]), group("m2", [1])], [0, 1])).toEqual([-1, -1]);
        expect(plan([group("a", [0]), group("b", [1]), group("c", [2])], [0, 0, 1])).toEqual([-1, -1, -1]);
    });

    it("验收 3：纯独立题卷 ⇒ 全 -1（非材料卷零装饰、逐字节不变）", () => {
        expect(plan([single(0), single(1)], [0, 0])).toEqual([-1, -1]);
    });

    it("空单元表 ⇒ 空计划；段表缺省/越界按 -1 段兜底（同段复用）", () => {
        expect(plan([], [])).toEqual([]);
        expect(plan([single(9), group("m1", [0])], [0])).toEqual([-1, 0]);
        expect(plan([single(9), group("m1", [0]), group("m2", [1])], [])).toEqual([-1, 0, 0]);
    });
});
