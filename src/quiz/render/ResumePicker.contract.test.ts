import { describe, expect, it } from "vitest";
import START_PANEL from "./StartPanel.ts?raw";
import MOBILE_DRILL from "../../mobile/core/MobileDrill.ts?raw";
import MOBILE_ROUND from "../../mobile/core/MobileRound.ts?raw";
import PICKER from "../service/ResumePicker.ts?raw";
import QUIZ_INDEX from "../index.ts?raw";

/**
 * 「未完成轮」候选查找的**唯一性**契约（Issue #169）。
 *
 * 坑的形状：桌面候选原写「只看数组末位」（`rounds[rounds.length - 1]`），
 * 尾随空轮一占末位，前面「有作答且未收卷」的轮就被永久埋掉；而判据散在
 * 面板模型与开轮两处、移动端还各有一份——漂移一次就是「面板不显示」或
 * 「点了继续却从零开刷」这类**不报错的**静默错配。故把「取谁」与「怎么判」
 * 都钉成源级断言（CI 无 jsdom，行为断言在 `ResumePicker.test.ts` /
 * `StartPanel.test.ts` / `MobileDrillResume.test.ts`）。
 */

const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

/** 剥注释后的源码（注释里复述写法不算引用，同 RoundReport.contract 口径）。 */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("候选查找单一实现（Issue #169）", () => {
    it("判据与查找只在 ResumePicker 里定义一次", () => {
        expect(count(PICKER, "export function lastUnfinishedRound")).toBe(1);
        expect(count(PICKER, "export function isUnfinishedRound")).toBe(1);
        // 判据本体：只看 answered（按块 id 归并）+ endedAt
        expect(PICKER).toMatch(/!s\.endedAt && answeredQuestionCount\(s\) > 0/);
        // 从尾向前扫（不许退回「只看末位」）
        expect(PICKER).toMatch(/for \(let i = list\.length - 1; i >= 0; i--\)/);
    });

    it("桌面两处（面板模型 / 开轮）都取它，谁都不许再自己看末位", () => {
        // 引用两处（import 1 + 调用 2 = 3）
        expect(count(code(START_PANEL), "lastUnfinishedRound")).toBe(3);
        // 旧的「末位即候选」写法必须已消失（末位只剩 lastWrong 的范围用）
        expect(code(START_PANEL)).not.toMatch(/unfinished\s*=\s*[^;]*rounds\[[^\]]*length\s*-\s*1/);
        expect(code(START_PANEL)).not.toMatch(/const lastAnswered\b/);
    });

    it("移动端探测同样只收未完成轮（判据不在此另写一份）", () => {
        expect(count(code(MOBILE_ROUND), "isUnfinishedRound")).toBe(3); // import + 判据转发 + 探测过滤
        // 旧的自写判据（endedAt + resultsByQid）已收口到 ResumePicker
        expect(code(MOBILE_ROUND)).not.toMatch(/return\s*!s\.endedAt\s*&&\s*resultsByQid/);
        // 薄转发保住 #167 起的导出名（切片用例仍取它）
        expect(MOBILE_ROUND).toMatch(
            /export function isUnfinishedSession\(s: WenguSession\): boolean \{\s*return isUnfinishedRound\(s\);\s*\}/
        );
    });
});

describe("弃轮擦除接线（Issue #169 调查项）", () => {
    it("擦除判据全仓只有一份实现（弃轮＝零作答且未收卷）", () => {
        expect(count(PICKER, "export function isAbandonedRound")).toBe(1);
        // 双条件 + 保守方向：answered 记账字段与 results 真相都为 0 才算弃轮
        // （宁可留一条无害空轮，不可删一条有内容的轮）
        expect(PICKER).toMatch(/!s\.endedAt && s\.answered <= 0 && answeredQuestionCount\(s\) === 0/);
        // 移动端不许再自写一份判据（原写法 `s.endedAt` + `answeredQuestionCount > 0` 已收口）
        expect(code(MOBILE_ROUND)).not.toMatch(/if \(answeredQuestionCount\(s\) > 0\) return/);
    });

    it("两个擦除入口都在 MobileRound 里，执行体只认 isAbandonedRound", () => {
        const drop = /export function dropAbandonedRoundIn[\s\S]*?\n}/.exec(MOBILE_ROUND)?.[0] ?? "";
        expect(drop).not.toBe("");
        expect(drop).toContain("isAbandonedRound(s)");
        expect(drop).toContain("removeSession(s.id)");
        // 卸载结算（dock destroy 链）与返回键同判据：空轮擦、有作答只结算用时
        const settle = /export function settleOnUnmount[\s\S]*?\n}/.exec(MOBILE_ROUND)?.[0] ?? "";
        expect(settle).not.toBe("");
        expect(settle).toContain("isAbandonedRound(s)");
        expect(settle).toContain("removeSession(s.id)");
        expect(settle).toContain("upsert(s)");
        // ⚠️ 移动端离屏**不封卷**（与桌面 finishSession 语义不同源）：
        // 写了 endedAt 就把「继续上次」的依托变成已收卷轮
        expect(settle).not.toContain("endedAt =");
    });

    it("编排类只转发，不许出现 removeSession（桌面 index.ts 同口径）", () => {
        expect(count(code(MOBILE_DRILL), "dropAbandonedRoundIn")).toBe(2); // import + 调用
        expect(count(code(MOBILE_DRILL), "settleOnUnmount")).toBe(2); // import + 调用
        expect(code(MOBILE_DRILL)).not.toMatch(/removeSession/);
        expect(code(QUIZ_INDEX)).not.toMatch(/removeSession/);
    });
});
