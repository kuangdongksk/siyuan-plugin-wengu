import { describe, expect, it } from "vitest";
import { compile } from "svelte/compiler";
import * as sass from "sass";
import ROUND_REPORT from "./RoundReport.ts?raw";
import QUIZ_SHELL from "./QuizShell.ts?raw";
import QUIZ_INDEX from "../index.ts?raw";
import SIDE_MOUNT from "../flow/SideMount.ts?raw";
/** 报告区样式：scss 走 **sass 真编译**（`?raw` 对 .scss 在本仓 vitest
 *  下恒空串——`SpecListings.test.ts` 头注同款；本文件只关心规则在场与
 *  值，不钉分片再拆的自由）。 */
const REPORT_SCSS = sass.compile("src/scss/report.scss").css.replace(/\/\*[\s\S]*?\*\//g, "");
import SVELTE_SRC from "../components/RoundReportApp.svelte?raw";
import ZH from "../../i18n/zh-CN.json";
import EN from "../../i18n/en.json";

/**
 * 收卷总结形态（Issue #147 追加 1/2/3）的**源级 + 编译产物级**契约。
 *
 * 三件事都是「观感型」缺陷、真机截图实证，但根因全是**代码结构**：
 *  1. 出总结时题卷收起（追加 1）——原来报告与题卷并存，45 题长卷同屏；
 *  2. 报告已出态点「结束本次」有可见反馈（追加 2）——原实现 detach + 重挂
 *     同一份报告，视觉零变化；
 *  3. 报告区自身内滚、各区块高度自适应（追加 3）——原来区块按比例分配，
 *     1 轮历史下方留大片空白。
 *
 * CI 无 jsdom（vitest.config environment=node），行为断言落在纯函数
 * （已出态分支的**分派方向**）上，DOM 契约、CSS 生效范围与组件编译产物
 * 用**源级/编译级断言**锁死（同 `RoundReport.contract.test.ts` /
 * `StartPanelStyle.test.ts` 口径；`?raw` 而非 `node:fs`——本仓无 @types/node）。
 */

const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

describe("收卷总结形态（Issue #147 追加 1）· 源级", () => {
    it("收卷链尾进总结态，且「返回题卷」走同一条出口", () => {
        // showRoundReportNow 挂完组件即 enterSummaryView（出总结=题卷收起）
        expect(ROUND_REPORT).toMatch(/enterSummaryView\(ctx\.el\);[\s\S]*?\n}/);
        // 「返回题卷」经组件 prop 给出口，出口函数就是 exitSummaryView
        expect(ROUND_REPORT).toMatch(/onBackToQuiz:\s*\(\)\s*=>\s*exitSummaryView\(ctx\.el\)/);
        // 头/尾成对，摘类即回原状（题卷 DOM 不动——题卡是 Svelte 挂载物）
        expect(count(ROUND_REPORT, "function enterSummaryView")).toBe(1);
        expect(count(ROUND_REPORT, "function exitSummaryView")).toBe(1);
    });

    it("头部按钮在报告已出态**继续在**（不许收成 disabled 或卸掉）", () => {
        // canEndRound 必须把 finishedSession() 算进去——原先只看 started，
        // 收卷后钮就没了，「点结束本次没反应」的另一半根因
        expect(QUIZ_SHELL).toMatch(/const canEndRound = \(v\.started \|\| !!v\.finishedSession\(\)\) && !pv;/);
        expect(QUIZ_SHELL).toMatch(/mountHeadFor\(sideQuizAccess\(v\), "drill", subhead, canEndRound/);
    });

    it("题卷收起由主区状态类实现，类挂在 .wengu-main（壳重建即不残留）", () => {
        // 题卷收起 = 主区带类；CSS 选择器按 .wengu-main.类 前缀（不外溢题卡）
        expect(REPORT_SCSS).toMatch(/\.wengu-main\.wengu-summary-view \.wengu-body,/);
        expect(REPORT_SCSS).toMatch(/\.wengu-main\.wengu-summary-view \[data-report\] \{/);
        // 报告区撑满剩余高度 + 内滚（#96：面板不出页面级滚动条）
        expect(REPORT_SCSS).toMatch(
            /\.wengu-main\.wengu-summary-view \.wengu-report-scroll \{[\s\S]*?overflow-y: auto;/
        );
    });
});

describe("报告已出态点「结束本次」（Issue #147 追加 2）· 源级", () => {
    it("endRound 的 finished 分支改走 focusFinishedRound，不再重挂报告", () => {
        expect(QUIZ_INDEX).toMatch(/else if \(this\.finished\) focusFinishedRound\(roundFinishCtx\(this\)\)/);
        // 原病灶：该分支直调 showRoundReportNow（detach+重挂，视觉零变化）
        expect(QUIZ_INDEX).not.toContain("if (this.finished) showRoundReportNow");
        // finished 分支与收卷路（守卫）互斥且都在同一个入口里
        expect(count(QUIZ_INDEX, "focusFinishedRound(roundFinishCtx(this))")).toBe(1);
        expect(count(QUIZ_INDEX, "finishRoundGuarded(roundFinishCtx(this))")).toBe(2);
    });

    it("已出态点击是**总结视图开关**：两态都有可见反馈、绝不静默返回", () => {
        // 总结开着 ⇒ 收起回题卷；已在题卷 ⇒ 重开总结 + 滚回顶部（+ 脉冲）
        expect(ROUND_REPORT).toMatch(
            /export function focusFinishedRound[\s\S]*?isSummaryView\(ctx\.el\)\) exitSummaryView[\s\S]*?enterSummaryView\(ctx\.el\)[\s\S]*?scrollReportTop\(ctx\.el\)[\s\S]*?pulseReport\(ctx\.el\)/
        );
        // 头部文案随态换语义：开关后通知挂载方重挂头部
        expect(ROUND_REPORT).toMatch(/onSummaryToggle\?\.\(\)/);
        expect(QUIZ_SHELL).toMatch(/bindSummaryToggle\(remountHead\)/);
        expect(QUIZ_SHELL).toMatch(/bindSummaryToggle\(undefined\)/); // 旧壳闭包作废
        // ⚠️ 重挂头部后计时器标签位是空的（组件只产壳、文本命令式写）——
        // 重挂体必须自带一次 updateLabel，否则收卷后标签永久空着
        expect(QUIZ_SHELL).toMatch(
            /const remountHead = \(\): void => \{[\s\S]*?mountHeadFor\([\s\S]*?v\.timerBinder\.updateLabel\(\);\s*\};/
        );
        // 高亮脉冲确在（「回到总结」要跳回顶部并闪一下，不是光跳不闪）
        expect(ROUND_REPORT).toMatch(/classList\.add\("wengu-report-pulse"\)/);
        expect(REPORT_SCSS).toMatch(/\.wengu-report-pulse \{[\s\S]*?animation:/);
        expect(REPORT_SCSS).toMatch(/@keyframes wengu-report-flash/);
    });

    it("头部按钮随总结态换语义（返回题卷 / 查看总结 / 结束本次）", () => {
        expect(SIDE_MOUNT).toMatch(/summaryOpen\s*\?\s*"reportBackToQuiz"/);
        expect(SIDE_MOUNT).toMatch(/reportShown\s*\?\s*"reportShowSummary"/);
        // 收卷后开关两态都在头部有钮（canEndRound 含 finishedSession）
        expect(QUIZ_SHELL).toMatch(/const canEndRound = \(v\.started \|\| !!v\.finishedSession\(\)\) && !pv;/);
    });

    it("按钮不禁用（项目既定原则「停止键别 disabled」）", () => {
        // 头部交卷/结束钮不得被挂 disabled；lockAllCards 只锁题卡内控件
        expect(QUIZ_SHELL).not.toMatch(/wengu-end-round[\s\S]{0,80}disabled/);
        expect(SVELTE_SRC).not.toMatch(/data-act="end-round"[\s\S]{0,200}disabled/);
    });
});

describe("总结面板高度自适应（Issue #147 追加 3）· 编译产物", () => {
    it("各区块按内容定高（flex:none），不按比例铺满", () => {
        expect(REPORT_SCSS).toMatch(/\.wengu-report-chart \{[\s\S]*?flex: none;/);
        // 报告块本身不定高、不留大片空白：外层脚手架才有 height:100% 语义
        expect(REPORT_SCSS).toMatch(
            /\.wengu-report \{[\s\S]*?padding: 16px;[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/
        );
        // 「历史轮次得分率」区块沿用既有 `rounds.length > 0` 条件渲染
        // （0 轮不出整区；1 轮 = 一条 4px 高的条 + 标签，无空白）
        expect(SVELTE_SRC).toMatch(/\{#if rounds\.length > 0\}/);
        expect(SVELTE_SRC).toMatch(/h: Math\.max\(4, ratePct\(r\.correct, r\.answered\)\)/);
    });

    it("「返回题卷 / 查看总结」是新 i18n 键，且两个语言文件都有", () => {
        expect(SVELTE_SRC).toMatch(/t\("reportBackToQuiz"\)/);
        for (const key of ["reportBackToQuiz", "reportShowSummary"]) {
            expect(Object.keys(ZH as Record<string, string>)).toContain(key);
            expect(Object.keys(EN as Record<string, string>)).toContain(key);
        }
    });
});

describe("RoundReportApp.svelte <style>（design-spec §13 绑定口径）", () => {
    it("Svelte 真编译零 unused 选择器（迁入即失配的闸门）", () => {
        const out = compile(SVELTE_SRC, { css: "external", dev: false, filename: "RoundReportApp.svelte" });
        const unused = out.warnings.filter((w) => w.code === "css_unused_selector").map((w) => String(w.message));
        expect(unused, `unused 选择器：${unused.join(" / ")}`).toEqual([]);
    });

    it("注入的 CSS 含操作行规则（组件独占样式确已落进产物）", () => {
        const out = compile(SVELTE_SRC, { css: "external", dev: false, filename: "RoundReportApp.svelte" });
        const css = out.css?.code ?? "";
        expect(css).toContain("wengu-report-acts");
        // 报告滚动窗的**桩**留在共享片（TS innerHTML 触达）；组件内同名规则
        // 只留 flex 行布局，两者不重定义 overflow（一个落点一条口径）
        expect(css).not.toMatch(/wengu-report-scroll \{[\s\S]*?overflow/);
    });
});
