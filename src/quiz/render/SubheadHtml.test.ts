import { beforeAll, describe, expect, it } from "vitest";
import { renderSubheadHtml, type SubheadModel } from "./CardHtml";
import zh from "../../i18n/zh-CN.json";
import en from "../../i18n/en.json";
import type { WenguDoc } from "../../types";

/**
 * 头部统计条的分段输出（Issue #100）：题集名段 / 进度段 / 竖线 / 轮次段。
 * 三条硬口径——① 无进度、无轮次时不插悬挂分隔符；② 数字加重、题集名
 * 段逐字转义（标题里带数字不误加重）；③ 文案仍逐字来自既有 i18n 键。
 */

/** 题集元信息（其余字段测试不关心，给零值）。 */
function doc(over: Partial<WenguDoc> & { id?: string; title?: string }): WenguDoc {
    return { id: "d1", title: "", total: 0, attempted: 0, rightCount: 0, totalTime: 0, ...over };
}

const zhKeys = zh as Record<string, string>;
const enKeys = en as Record<string, string>;

/** 取词替身走真实 i18n 表（插件的真口径是 `i18n[key] || key`）。 */
const t = (k: string): string => (zh as Record<string, string>)[k] || k;

function model(over: Partial<SubheadModel> = {}): SubheadModel {
    return {
        t,
        doc: doc({ title: "概率论与数理统计-题解", total: 85 }),
        listCount: 85,
        rounds: [],
        ...over,
    };
}

const segs = (html: string): number => html.match(/class="wengu-head-seg/g)?.length ?? 0;

describe("renderSubheadHtml · 统计条结构化分段（Issue #100）", () => {
    it("无进度、无轮次：只有题集名段，不出现分隔符", () => {
        const html = renderSubheadHtml(model());
        expect(segs(html)).toBe(1);
        expect(html).toContain("wengu-head-seg is-title");
        expect(html).not.toContain("wengu-head-sep");
    });

    it("有进度、无轮次：题集名 + 进度段，仍无分隔符（单边不插）", () => {
        const html = renderSubheadHtml(model({ doc: doc({ title: "卷", total: 85, attempted: 20, rightCount: 14 }) }));
        expect(segs(html)).toBe(2);
        expect(html).not.toContain("wengu-head-sep");
    });

    it("无进度、有轮次：题集名 + 轮次段，不插空分隔符（现状会留悬挂竖线）", () => {
        const html = renderSubheadHtml(model({ rounds: [{ answered: 5, correct: 3 }] }));
        expect(segs(html)).toBe(4);
        expect(html).not.toContain("wengu-head-sep");
    });

    it("有进度、有轮次：两段之间正好一个竖线", () => {
        const html = renderSubheadHtml(
            model({
                doc: doc({ title: "卷", total: 85, attempted: 20, rightCount: 14 }),
                rounds: [{ answered: 5, correct: 3 }],
            })
        );
        expect(segs(html)).toBe(5);
        expect(html.match(/wengu-head-sep/g)?.length).toBe(1);
    });

    it("题集名段整段加重（正文色），题内数字不单独包 <b>；统计段数字包 <b>", () => {
        const html = renderSubheadHtml(
            model({
                doc: doc({ title: "2020Text1", total: 85, attempted: 20, rightCount: 14 }),
                rounds: [{ answered: 5, correct: 3 }],
            })
        );
        // 题集名段：整段就是加重位，标题里的 2020 不被单独包 <b>
        expect(html).toContain('<span class="wengu-head-seg is-title">《2020Text1》共 85 题</span>');
        expect(html).toContain("已刷 <b>20</b>/<b>85</b>");
        expect(html).toContain("已刷 <b>1</b> 轮");
        expect(html).toContain("最近 <b>3</b>/<b>5</b>");
        expect(html).toContain("最佳 <b>3</b>/<b>5</b>");
    });

    it("批注/HTML 注入不进产物：题集名逐字转义", () => {
        const html = renderSubheadHtml(model({ doc: doc({ title: "<img src=x>", total: 3 }) }));
        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img");
    });

    it("无 doc：空串（不渲染统计条）", () => {
        expect(renderSubheadHtml(model({ doc: undefined }))).toBe("");
    });
});

/**
 * 开刷面板的文案键（Issue #100）：面板全部文案都必须已有 zh/en 词条
 * ——「i18n 零新增键」是硬口径，缺任一侧就是硬编码中文或展示原始键名。
 */
describe("StartPanelApp · 用到的文案键两字典齐备（Issue #100）", () => {
    const KEYS = [
        "progressScopeTitle",
        "runSettingsTitle",
        "progressTitle",
        "continueHint",
        "scopeTitle",
        "scopeHint",
        "scopeAll",
        "revealTitle",
        "revealHint",
        "stepsModeTitle",
        "stepsModeHint",
        "timingTitle",
        "timingHint",
        "timingMinutes",
        "timingMinutesHint",
        "previewEntry",
        "startDrill",
        "reviewEntry",
    ];

    it("zh / en 两字典都有词条且非空串", () => {
        for (const k of KEYS) {
            expect(zhKeys[k], `缺 zh 词条: ${k}`).toBeTruthy();
            expect(enKeys[k], `缺 en 词条: ${k}`).toBeTruthy();
        }
    });
});

/**
 * 开刷面板的结构硬口径（Issue #100，源级断言）：Svelte 组件不进单测
 * （挂载内核不在范围内），但三条结构口径必须防回归——「刷题范围」行
 * 恒渲染、开始刷题是唯一 primary、动作行规格照稿（§〇6 的显式例外）。
 * 源码经 vitest 的 ?raw 导入（本仓无 @types/node，不用 node:fs）。
 */
describe("StartPanelApp · 结构硬口径（Issue #100）", () => {
    let src = "";

    beforeAll(async () => {
        src = (await import("../components/StartPanelApp.svelte?raw")).default;
    });

    it("「刷题范围」行在条件块之外（恒渲染，无错题时也出一项）", () => {
        const scopeIdx = src.indexOf('label={t("scopeTitle")}');
        expect(scopeIdx).toBeGreaterThan(0);
        // 范围行之前只允许「上次进度」那一个 {#if}，且它必须在范围行前闭合
        const before = src.slice(0, scopeIdx);
        expect(before.match(/\{#if\b/g)?.length).toBe(1);
        expect(before.match(/\{\/if\}/g)?.length).toBe(1);
        // 范围下拉恒含「全部题目」兜底项
        expect(src).toContain('{ value: "all", label: t("scopeAll") }');
    });

    it("「开始刷题」是唯一 primary 钮，预览/错题回顾维持 outline", () => {
        expect(src.match(/variant="primary"/g)?.length).toBe(1);
        expect(src.match(/variant="outline"/g)?.length).toBe(2);
    });

    it("两张卡片、卡头图标在卡内", () => {
        expect(src.match(/class="wengu-start-card"/g)?.length).toBe(2);
        expect(src).toContain('svgIcon("iconList"');
        expect(src).toContain('svgIcon("iconEye"');
    });

    it("标记区无硬编码中文（注释不算，取词一律走 t）", () => {
        // 剥掉 block 与行注释后再查：中文只允许出现在注释里
        const markup = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        const cjk = markup.match(/[\u4e00-\u9fff]+/g) ?? [];
        expect(cjk).toEqual([]);
    });
});
