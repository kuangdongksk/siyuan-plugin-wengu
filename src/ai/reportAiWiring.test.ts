import { describe, expect, it } from "vitest";
import * as sass from "sass";
import { CAUSE_LIST, TAG_MAX_CHARS } from "./prompts/common";
import { byBaseQid } from "./prompts/judge";
import type { WenguSession } from "../quiz/service/HistoryStore";

/**
 * 「AI 报告下游」独立验收（5/5）：**接线与依赖形状**（全源级/结构断言）。
 *
 * PR 改的是「报告 AI 输出的下游」：prompt → 出口 → 容器。这三段各自有
 * 单测之后，剩下的失效模式全在**接线**上——某个消费方没换出口、容器类名
 * 被改、报告的 `.wengu-bar` 高度写死（脏 sec 就再也看不出来）、prompt 注册表
 * 漏登记。本文件把这些「改一处忘一处」的入口钉住。
 */

/** 全仓源文件（`?raw`；本仓无 @types/node，不用 node:fs）。
 *  ⚠️ **scss 走 `?raw` 恒为空串**（同 `ui/ButtonVariants.test.ts` /
 *  `ai/aiMdStyle.test.ts` 的注释）——样式断言一律用 `sass.compile` 真编译，
 *  本 glob 只收 `.ts` / `.svelte`。 */
const SRC = import.meta.glob("../**/*.{ts,svelte}", { query: "?raw", import: "default", eager: true }) as Record<
    string,
    string
>;

/** scss 真编译产物（注释/`@charset` 先剥，避免注释里的示例选择器误判）。 */
const css = (file: string): string =>
    sass
        .compile(`src/${file}`)
        .css.replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/@charset[^;]+;/g, "");
/** glob key 相对**本测试文件**（`../quiz/...` / `./prompts/...`）——
 *  统一成「相对 src/」的展示名（同 i18n/dict.test.ts 的 relOf）。 */
const rel = (k: string): string => k.replace(/^\.\.\//, "").replace(/^\.\//, "ai/");
/** 按「相对 src/」的名字取源：glob key 相对本文件（`ai/*` 自己域是
 *  `./x`，其余是 `../x`），两种都试。 */
const file = (name: string): string => SRC[`../${name}`] ?? SRC[`./${name.replace(/^ai\//, "")}`] ?? "";

describe("接线：两个消费方都走同一出口，且传参形状一致", () => {
    const round = file("quiz/components/RoundReportApp.svelte");
    const stats = file("stats/core/StatsCtl.ts");

    it("全仓只有报告/统计两个消费方调 runAgentTextOrPanel（不许旁路自建输出）", () => {
        expect(round).toContain("runAgentTextOrPanel({");
        expect(stats).toContain("runAgentTextOrPanel({");
        const consumers = Object.entries(SRC)
            .filter(([k]) => !/\.test\.ts$/.test(k))
            .filter(([k]) => !/^ai\/reportAi/.test(rel(k))) // 本目录验收文件自身不算
            .filter(([k]) => !k.endsWith("./agentPanel.ts")) // 出口自己的定义不算消费
            .filter(([, v]) => v.includes("runAgentTextOrPanel({"))
            .map(([k]) => rel(k))
            .sort();
        expect(consumers).toEqual(["quiz/components/RoundReportApp.svelte", "stats/core/StatsCtl.ts"]);
    });

    it("两处调用都传齐六项（prompt/btn/out/modelId/三条文案），且文案键走 i18n", () => {
        for (const src of [round, stats]) {
            const call = src.slice(src.indexOf("runAgentTextOrPanel({"));
            const body = call.slice(0, call.indexOf("});"));
            for (const key of ["prompt:", "btn", "out", "modelId", "loadingText:", "emptyText:", "failPrefix:"]) {
                expect(body, `${key} 缺失`).toContain(key);
            }
            expect(body).toMatch(/t\("[a-zA-Z]+"\)/); // 文案必须走取词器
        }
    });

    it("报告侧的输出区类名与 PR 宣称的 markdown 基线类一致（样式落在同一类名上）", () => {
        expect(round).toContain('class="wengu-report-ai"');
        expect(css("scss/ai-md.scss")).toContain(".wengu-report-ai :where(.p)");
        expect(css("scss/report.scss")).toContain(".wengu-report-ai");
    });
});

describe("接线：报告图表的 .wengu-bar 高度必须来自内联 style（脏 sec 一眼可见）", () => {
    const round = file("quiz/components/RoundReportApp.svelte");
    const bars = file("scss/report.scss");

    it('三处柱元素都写 `style="height:{h}%"`（改回固定 CSS 高度就丢掉数据映射）', () => {
        const heights = [...round.matchAll(/style="height:\{(\w+)\.h\}%"/g)].map((m) => m[1]);
        expect(heights.length).toBe(3);
        expect(new Set(heights)).toEqual(new Set(["b"]));
    });

    it("`.wengu-bar` 样式表里**不写死 height**（否则内联值与 CSS 打架、柱高失真看不出来）", () => {
        void bars; // 源码路径不用（scss 走真编译）
        const sheet = css("scss/report.scss");
        // 高度来源是 Svelte 模板的内联 style（下面锁），样式表只给外观
        expect(round).toContain('style="height:{b.h}%"');
        const seg = sheet.slice(sheet.indexOf(".wengu-bar {"), sheet.indexOf(".wengu-bar-right"));
        expect(seg.length).toBeGreaterThan(0);
        expect(seg).not.toMatch(/(^|[;{])\s*height:/); // 也不许有 min-height（下限在 TimeBars 的 MIN_H）
        expect(seg).not.toMatch(/min-height/);
    });

    it("组柱同样带高度内联值（聚合档不能退化成等高柱）", () => {
        expect(round).toContain('class="wengu-bar wengu-bar-score" style="height:{b.h}%"');
    });
});

describe("接线：prompt 注册表与报告模型", () => {
    it("判分族 prompt 全部从 prompts/judge.ts 导出（集中收口：报告与判卷同族，不许散落别处）", () => {
        const judge = file("ai/prompts/judge.ts");
        for (const name of ["buildAnalysisPrompt", "byBaseQid", "buildBriefPrompt", "buildCluePrompt"]) {
            expect(judge).toContain(`export function ${name}`);
        }
        expect(judge).toContain("export const TIME_UNKNOWN_TEXT");
        // 公共片段仍从 prompts/common 取（口径常量单一落点）
        expect(typeof CAUSE_LIST).toBe("string");
        expect(TAG_MAX_CHARS).toBeGreaterThan(0);
    });

    it("报告 prompt 的构建点唯一（除 prompts/judge.ts 外无第二处拼「刷题判卷助手」）", () => {
        const hits = Object.entries(SRC)
            .filter(([k]) => !/\.test\.ts$/.test(k))
            .filter(([k]) => !/^ai\/reportAi/.test(rel(k)))
            .filter(([, v]) => v.includes("你是刷题判卷助手"))
            .map(([k]) => rel(k));
        expect(hits).toEqual(["ai/prompts/judge.ts"]);
    });

    it("报告组件的 model 字段与 buildAnalysisPrompt 入参对齐（session/list/rounds/totalSec/overtimeSec）", () => {
        const round = file("quiz/components/RoundReportApp.svelte");
        expect(round).toMatch(/buildAnalysisPrompt\(/);
        // 入参是 RoundReportModel 的子集，五字段齐 ⇒ 组件不应自己做加法
        const judge = file("ai/prompts/judge.ts");
        for (const f of ["session", "list", "rounds"]) expect(judge).toMatch(new RegExp(`${f}:`));
        for (const f of ["totalSec", "overtimeSec"]) expect(judge).toMatch(new RegExp(`m\\.${f}`));
    });

    it("报告图表与 prompt 的用时同源（都从 byBaseQid 取，不许各写一套）", () => {
        const round = file("quiz/components/RoundReportApp.svelte");
        expect(round).toContain("byBaseQid");
        const merged = byBaseQid({ results: [{ qid: "a", ok: true, submitted: "A", sec: 3 }] } as WenguSession);
        expect(merged.get("a")?.sec).toBe(3);
    });
});

describe("接线：scss 分片注册与行数红线", () => {
    it("ai-md.scss 被 index.scss 拉进来（不注册＝整片静默不落 dist/index.css）", () => {
        const src = css("index.scss");
        expect(src).toContain(".wengu-report-ai :where(.p)");
    });

    it("ai-md.scss 不写死颜色（只走 b3 令牌）、不用 pre-wrap", () => {
        const body = css("scss/ai-md.scss");
        expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(body).not.toMatch(/\brgba?\(/);
        expect(body).not.toContain("pre-wrap");
    });
});

describe("回归锁：既有 Markdown 渲染面零回退（renderMdHtml 的同源消费方）", () => {
    it("题卡/材料等既有渲染路径仍走 renderMdHtml / mdFragmentHtml（本单没有换掉任何一条）", () => {
        expect(file("quiz/service/MaterialDecorate.ts")).toContain("renderMdHtml");
        // 题卡/预览走同族的 mdFragmentHtml 壳（其实现就是 renderMdHtml，
        // 与报告出口同一渲染器 ⇒ 一处改坏会同时炸两处，值得一次性钉住）
        expect(file("quiz/service/ProtyleHost.ts")).toMatch(
            /export function mdFragmentHtml[\s\S]{0,60}renderMdHtml\(md\)/
        );
        expect(file("quiz/flow/PreviewFlow.ts")).toContain("mdFragmentHtml");
        expect(file("quiz/render/CardSteps.ts")).toContain("mdFragmentHtml");
    });

    it("报告/统计两域的既有测试文件仍在（改下游不许删既有回归网）", () => {
        const tests = Object.keys(SRC).map(rel);
        for (const t of [
            "ai/prompts/judge.test.ts",
            "ai/prompts/judge.ts",
            "ai/agentPanel.test.ts",
            "ai/aiMdStyle.test.ts",
            "quiz/render/TimeBars.test.ts",
            "quiz/render/RoundReport.view.test.ts",
            "ui/MdRender.test.ts",
        ]) {
            expect(tests, `${t} 缺失`).toContain(t);
        }
        expect(tests).toContain("quiz/render/RoundReport.view.test.ts");
        expect(SRC["../quiz/render/RoundReport.view.test.ts"] ?? "").toContain("buildTimeBars");
    });
});
