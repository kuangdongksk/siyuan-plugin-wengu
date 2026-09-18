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
import TIME_BARS from "./TimeBars.ts?raw";
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
        // 「返回题卷」经组件 prop 给出口，出口函数是 backToQuiz（含通知重画头部）
        expect(ROUND_REPORT).toMatch(/onBackToQuiz:\s*\(\)\s*=>\s*backToQuiz\(ctx\)/);
        // 显隐与视图态成对：只摘类 ⇒ 报告卡仍压在卷首（没真收起）
        expect(ROUND_REPORT).toMatch(/export function enterSummaryView[\s\S]*?showReportHost\(el, true\)/);
        expect(ROUND_REPORT).toMatch(/export function exitSummaryView[\s\S]*?showReportHost\(el, false\)/);
        // 本片给 [data-report] 上了 display:flex ⇒ 必须显式关掉一次 hidden
        // （作者 display 压过 UA 的 [hidden]{display:none}），否则收起后仍照显
        expect(REPORT_SCSS).toMatch(/\[data-report\]\[hidden\] \{[\s\S]*?display: none;/);
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

describe("报告滚动窗唯一性（Issue #147 回归）· 源级", () => {
    it("标记由组件渲染，TS 侧不再放同标记的桩", () => {
        // 曾用挂载前 innerHTML 放 [data-report-scroll] 桩，组件又渲染一个
        // ⇒ 两个 flex:1 窗把面板劈成半空白，且 query 命中的是空桩
        // （scrollTop 恒 0）⇒「滚回总结顶部」静默失效
        expect(ROUND_REPORT).not.toMatch(/innerHTML\s*=\s*['"`][^'"`]*data-report-scroll/);
        expect(SVELTE_SRC).toMatch(/<div class="wengu-report-scroll" data-report-scroll>/);
        // 渲染点只有一处（注疏里的提及不算）
        expect(count(SVELTE_SRC, '<div class="wengu-report-scroll" data-report-scroll>')).toBe(1);
        // 查询一律经常量走（单一口径）
        expect(ROUND_REPORT).toMatch(/const REPORT_SCROLL_SEL = "\[data-report\] \[data-report-scroll\]"/);
        expect(count(ROUND_REPORT, "REPORT_SCROLL_SEL")).toBe(3); // 定义 1 + 用 2
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
            /export function focusFinishedRound[\s\S]*?isSummaryView\(ctx\.el\)\) backToQuiz\(ctx\);[\s\S]*?enterSummaryView\(ctx\.el\)[\s\S]*?scrollReportTop\(ctx\.el\)[\s\S]*?pulseReport\(ctx\.el\)/
        );
        // 四处通知：backToQuiz（收起支，与报告内钮共用）+ 本函数进态支 +
        // showRoundReportNow 收卷链尾 + closeEmptyRound 空轮关轮（#155）
        expect(count(ROUND_REPORT, "onSummaryToggle?.()")).toBe(4);
        // 报告节点已不在（整壳重建）⇒ 先补挂再切态，否则进的是空宿主
        // （题卷被 CSS 收起 + 报告又不在 ⇒ 整片空白）
        expect(ROUND_REPORT).toMatch(
            /focusFinishedRound[\s\S]*?\[data-report\] \.wengu-report"[\s\S]*?mountReportNode\(ctx, ctx\.finished, host\)/
        );
        // 补挂**不走收卷链**（不重复落库/停表/AI 归因）：只在
        // focusFinishedRound 体内取断言——全文尾部另有 manualFinishRound
        // 调 showRoundReportNow（那条是正路，不算越界）
        const focusBody = /export function focusFinishedRound[\s\S]*?\n}/.exec(ROUND_REPORT)?.[0] ?? "";
        expect(focusBody).not.toBe("");
        expect(focusBody).not.toContain("showRoundReportNow");
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

    it("「回题卷」两个入口同一条路（报告内钮与头部钮），都通知重画头部", () => {
        // 唯一执行体 backToQuiz = 摘类 + 通知；两条入口都调它
        expect(ROUND_REPORT).toMatch(
            /export function backToQuiz\(ctx: RoundFinishCtx\): void \{\s*exitSummaryView\(ctx\.el\);\s*onSummaryToggle\?\.\(\);\s*\}/
        );
        expect(ROUND_REPORT).toMatch(/onBackToQuiz:\s*\(\)\s*=>\s*backToQuiz\(ctx\)/);
        expect(ROUND_REPORT).toMatch(/isSummaryView\(ctx\.el\)\) backToQuiz\(ctx\)/);
        // ⚠️ 报告内那个钮不许直调 exitSummaryView：少一次通知，头部文案就
        // 留在「返回题卷」不改（总结已收起、钮还在喊「返回题卷」＝文案说谎）
        expect(ROUND_REPORT).not.toMatch(/onBackToQuiz:\s*\(\)\s*=>\s*exitSummaryView/);
        // exitSummaryView 的调用点：backToQuiz（回题卷）+ closeEmptyRound
        // （#155 空轮关轮收态）——定义 1 + 调用 2
        expect(count(ROUND_REPORT, "exitSummaryView(")).toBe(3);
    });

    it("头部按钮随总结态换语义（返回题卷 / 查看总结 / 结束本次）", () => {
        expect(SIDE_MOUNT).toMatch(/summaryOpen\s*\?\s*"reportBackToQuiz"/);
        expect(SIDE_MOUNT).toMatch(/reportReady\s*\?\s*"reportShowSummary"/);
        // ⚠️「报告已出」的判据必须是**报告卡在不在**，不是宿主的 hidden——
        // 显隐是总结视图态的从属量（退态会设回 hidden），用错则「返回题卷」
        // 后头部读成「还没收卷」、文案退回「结束本次」
        expect(SIDE_MOUNT).not.toMatch(/\[data-report\]:not\(\[hidden\]\)/);
        expect(SIDE_MOUNT).toMatch(
            /const reportReady = !!v\.el\.querySelector<HTMLElement>\("\[data-report\] \.wengu-report"\)/
        );
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
        // 卡片也按内容定高：flex:1 会把它强压成容器高 ⇒ 内容矮时留空白、
        // 内容高时溢出卡片盒（滚动窗量不到 ⇒ 长报告滚不到底）
        expect(REPORT_SCSS).toMatch(/\.wengu-main\.wengu-summary-view \.wengu-report \{[\s\S]*?flex: none;/);
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

describe("用时图分组聚合（Issue #155 块 B）· 源级", () => {
    it("组装走纯函数 buildTimeBars，且两档形状一致（组件不按档分叉取明细）", () => {
        expect(SVELTE_SRC).toMatch(/buildTimeBars\(barInputs, \{/);
        // 逐题档也带 items（单元素）——两档同形状，组件只吃 items
        expect(SVELTE_SRC).toMatch(/<div class="wengu-bar {b\.cls}" style="height:\{b\.h\}%"><\/div>/);
        // 组件侧不再自己算 maxSec / 自己拼 4% 下限（口径全在纯函数里）
        expect(SVELTE_SRC).not.toContain("maxSec");
        // 用时图那条链里不许再自己压 4% 下限（历史得分图的 ratePct 不属本单）
        expect(SVELTE_SRC).not.toMatch(/timeBars[\s\S]{0,400}Math\.max\(4,/);
    });

    it("组柱是可聚焦按钮（键盘可达）+ aria-expanded；再点收起", () => {
        expect(SVELTE_SRC).toMatch(
            /<button[\s\S]{0,200}data-bar-group[\s\S]{0,200}aria-expanded=\{expanded\.has\(i\)\}/
        );
        // 同一个 onclick 既展开又收起（toggleGroup），Enter/Space 是 button 原生行为
        expect(SVELTE_SRC).toMatch(
            /function toggleGroup\(i: number\)[\s\S]*?if \(next\.has\(i\)\) next\.delete\(i\);\s*else next\.add\(i\);/
        );
        expect(SVELTE_SRC).toMatch(/onclick=\{\(\) => toggleGroup\(i\)\}/);
    });

    it("组详情渲染在条形图正下方，逐题明细复用既有 title", () => {
        expect(SVELTE_SRC).toMatch(/\{#if expanded\.size > 0\}/);
        expect(SVELTE_SRC).toMatch(/data-bar-detail/);
        expect(SVELTE_SRC).toMatch(/class="wengu-bar-detail-dot \{it\.cls\}"/);
        expect(SVELTE_SRC).toMatch(/\{it\.title\}/);
    });

    it("组柱语义（阈值/分组粒度/组色/组高度）全在纯函数里锁死", () => {
        expect(TIME_BARS).toContain("export const BAR_AGG_MAX = 60");
        expect(TIME_BARS).toMatch(/if \(len <= BAR_AGG_MAX\) return 1;/);
        expect(TIME_BARS).toMatch(/return Math\.ceil\(len \/ BAR_AGG_MAX\);/);
        expect(TIME_BARS).toMatch(/group\.every\(\(x\) => x\.unanswered\)\) return "wengu-bar-muted"/);
        expect(TIME_BARS).toMatch(/group\.some\(\(x\) => !x\.unanswered && x\.wrong\)\) return "wengu-bar-wrong"/);
        expect(TIME_BARS).toMatch(/group\.some\(\(x\) => !x\.unanswered && x\.partial\)\) return "wengu-bar-partial"/);
        // 组总用时与柱高都过 secOf 归一（Issue #177：脏用时按 0 收拾，
        // 源头已在 byBaseQid 修掉，出口再防一道——不许算出 height:NaN%）
        expect(TIME_BARS).toMatch(
            /const sec = group\.reduce\(\(sum, x\) => sum \+ \(x\.unanswered \? 0 : secOf\(x\)\), 0\)/
        );
        expect(TIME_BARS).toMatch(
            /cols\.forEach\(\(c, i\) => \(c\.h = Math\.max\(MIN_H, Math\.round\(\(groupSec\[i\] \/ max\) \* 100\)\)\)\)/
        );
        expect(TIME_BARS).toMatch(/return Number\.isFinite\(x\.sec\) \? x\.sec : 0;/);
    });

    it("组 title 是新 i18n 键 reportGroupTime，两个语言文件都有（尾键）", () => {
        expect(SVELTE_SRC).toMatch(/t\("reportGroupTime"\)/);
        for (const key of ["reportGroupTime"]) {
            expect(Object.keys(ZH as Record<string, string>)).toContain(key);
            expect(Object.keys(EN as Record<string, string>)).toContain(key);
        }
        // 新键放文件尾（并行单 #154 撞尾时的 rebase 判据）
        const tail = (o: Record<string, string>): string => Object.keys(o).slice(-1)[0];
        expect(tail(ZH as Record<string, string>)).toBe("reportGroupTime");
        expect(tail(EN as Record<string, string>)).toBe("reportGroupTime");
    });

    it("组柱/明细样式：TS 拼串触达的 .wengu-bar-* 留共享片，组件独占的明细块进 <style>", () => {
        // 色类由 render/TimeBars.ts 拼串产生 ⇒ 不能搬进组件 <style>
        for (const cls of ["wengu-bar-muted", "wengu-bar-right", "wengu-bar-wrong", "wengu-bar-partial"])
            expect(REPORT_SCSS).toContain(`.${cls}`);
        // 组柱按钮外观取消 UA 默认（柱与逐题档逐像素同形）
        expect(REPORT_SCSS).toMatch(/\.wengu-bar-hit \{[\s\S]*?padding: 0;/);
        expect(REPORT_SCSS).toMatch(/\.wengu-bar-hit \{[\s\S]*?background: none;/);
        // 展开态强调
        // ⚠️ sass 编译会去掉属性值两端的引号（[aria-expanded=true]）
        expect(REPORT_SCSS).toMatch(/\.wengu-bar-hit\[aria-expanded=true\] \.wengu-bar \{/);
        // 明细块是组件独占（零 TS 触达）⇒ 编译产物里必须有
        const out = compile(SVELTE_SRC, { css: "external", dev: false, filename: "RoundReportApp.svelte" });
        const css = out.css?.code ?? "";
        expect(css).toContain("wengu-bar-detail-list");
        expect(css).toContain("wengu-bar-detail-dot");
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
