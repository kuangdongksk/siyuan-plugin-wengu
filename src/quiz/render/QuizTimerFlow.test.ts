import { describe, expect, it } from "vitest";
import { mustHave, read } from "../../testkit/readSource";

/**
 * 计时落点接线红测试（Issue #182 R1/R6/R8）：源码级断言「谁在什么时机
 * 切焦点 / 结算」。
 *
 * 为什么源级：这类接线跨视图、组件与移动端三处，node 环境起不了 DOM；
 * 与既有 `SubheadHtml.test.ts`（primary 唯一）/ `RailMount.test.ts` 同款口径。
 *
 * ⚠️ 读源码一律走 `src/testkit/readSource.ts`（**相对仓根**的路径口径）。
 * 别再用 `import.meta.glob` 自行拼表（#189 实测）：`eager` 形态的键相对本文件、
 * 跨层同名会撞车，按 basename 查表还会**静默取错文件**；懒加载形态的键虽
 * 相对仓根，但取值有「裸字符串 / 模块壳」两形。详见该文件头注。
 */

/** 取源码原文（`mustHave` 先过在场闸 —— 文件不在就抛错，红即红在断言，
 *  不会因取不到而让 `.not.toContain` 类反向断言静默变绿）。 */
const src = (path: string): Promise<string> => {
    mustHave(path);
    return read(path);
};

/** 只剥块注释（`/* … *\/`）：行注释不剥——本仓大量源码里有 `//` 起始的
 *  字符串（URL、正则），按行剥会切掉半行代码导致取源码失真（#189 实测）。 */
const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "");

/** 断言几处「正向锚点」都在场——它们是下面**反向断言**的前提：
 *  锚点不在场多半意味着被读错了文件或源码被大改，此时反向断言会假绿。 */
function anchors(code: string, name: string, anchors: string[]): void {
    for (const a of anchors) expect(code, `${name} 未取到预期锚点 ${a}`).toContain(a);
}

describe("R1 点击即切：滚动不切焦点、切题只有点击路（源级）", () => {
    it("NumRail 的滚动跟踪不再回写计时焦点（onActive 只在点击/组导航路）", async () => {
        const code = strip(await src("/src/quiz/render/NumRail.ts"));
        anchors(code, "NumRail.ts", ["opts.onActive", '"scroll"', "setActiveOnly"]);
        // 两个出口各司其职：`setActiveOnly` 只刷高亮（滚动跟踪路）、
        // `setActive` 才上报视图（点击/组导航路）。
        const only = code.slice(code.indexOf("const setActiveOnly = "), code.indexOf("const setActive = "));
        expect(only, "setActiveOnly 不得上报视图").not.toContain("opts.onActive");
        expect(only).toContain("numsApp?.app.setActive(");
        // 滚动监听体（`addEventListener("scroll", … , { passive: true })`）
        // 里走的是 setActiveOnly，不是 setActive。
        // 取**最后一个** `scroller.addEventListener(` —— 文件头部的追赶滚动
        // 里另有一处同名调用（`type` 变量），取首个会滑到错误区间（#189 实测）
        const from = code.lastIndexOf("scroller.addEventListener(");
        const to = code.indexOf("{ passive: true }", from);
        expect(from, "未定位到滚动监听体").toBeGreaterThan(-1);
        expect(to, "未定位到滚动监听体的 options 边界").toBeGreaterThan(from);
        const scrollBody = code.slice(from, to);
        expect(scrollBody).toContain("setActiveOnly(");
        // 精确匹配 `setActive(`：`setActiveOnly(` 里也含该子串，故用调用边界判
        expect(scrollBody).not.toMatch(/[^y]setActive\(/);
    });

    it("挂载首帧不给视图上报当前题（R6：避免误记第 1 题）", async () => {
        const code = await src("/src/quiz/render/NumRail.ts");
        anchors(code, "NumRail.ts", ["bindNumRail", "setActive"]);
        expect(code).not.toMatch(/onActive\(1\)/);
        expect(code).not.toContain("opts.onActive?.(n - 1)");
    });

    it("视图切焦点只从题号/组导航的点击路进入 `newQuestionFor`（唯一入口）", async () => {
        const code = await src("/src/quiz/index.ts");
        expect(code, "src/quiz/index.ts 应仍是 QuizView 编排入口").toContain("class QuizView");
        anchors(code, "quiz/index.ts", ["newQuestionFor"]);
        expect(code).toContain("newQuestionFor(");
    });
});

describe("R6 恢复轮从落点题起算（源级）", () => {
    it("恢复路径在整壳重建后显式切到落点题（不再吃 NumRail 的 setActive(1)）", async () => {
        const code = await src("/src/quiz/render/QuizShell.ts");
        anchors(code, "QuizShell.ts", ["bindNumRail", "onActive"]);
        expect(code).toContain("focusQuestion");
    });
});

describe("R8 移动端：当前显示题即计时题（源级）", () => {
    it("goto 切题即切计时焦点（R8）", async () => {
        const code = await src("/src/mobile/core/MobileDrill.ts");
        expect(code, "MobileDrill.ts 应仍在 src/mobile/core/").toContain("goto(idx: number)");
        const goto = code.slice(code.indexOf("goto(idx: number)"), code.indexOf("prev(): void"));
        anchors(goto, "MobileDrill.goto", ["this."]);
        expect(goto).toContain("qTimer.focus(");
    });

    it("开轮/停轮同步单题计时的可见性闸（R5/R8）", async () => {
        const code = await src("/src/mobile/core/MobileDrill.ts");
        expect(code).toMatch(/startTicker\(\)[\s\S]{0,400}qTimer\.setRun\(true\)/);
        expect(code).toMatch(/stopTicker\(\)[\s\S]{0,400}qTimer\.setRun\(false\)/);
    });

    it("作答记账不再硬编码 sec=0", async () => {
        const code = await src("/src/mobile/core/MobileAnswering.ts");
        anchors(code, "MobileAnswering.ts", ["pushSessionAnswer(s"]);
        expect(code).not.toMatch(/pushSessionAnswer\([^)]*0\s*,/);
    });
});
