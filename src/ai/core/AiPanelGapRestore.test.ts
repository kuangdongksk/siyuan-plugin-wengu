import { describe, expect, it, beforeAll } from "vitest";
import { buildSessionTree } from "./SessionTree";
import type { AiSessionRecord } from "../data/AiSessions";

/**
 * #129 对稿还原的**结构级回归锁**（源级断言 + 纯逻辑断言）。
 *
 * 本单的两处「对稿后又被后来的需求改回去」的形态，必须钉在这里——Svelte
 * 组件不挂载进单测，故走 vite 的 `?raw` 读源码（同 SessionDetailCopy.test
 * 口径）：
 *  1. 详情头的 meta 槽**常空**（gap-list S7 落法 a：稿内无「时间 · 模型」
 *     串），模型名只在 h3 的 `title`；
 *  2. 状态徽标**自己**吃 `margin-left:auto`（`.wengu-aipanel-stbadge`），
 *     不许回退成 `.badge:last-child`——徽标后面还有一个 meta 槽，`:last-child`
 *     会落空并把徽标挤回中间（正是 S7 要消掉的形态）。
 *
 * 另有一条纯逻辑锁：树头「N 组」= **去重类别数**（稿的语义是种类数），
 * 单条种类不设层时数叶子会把组数数少。
 *
 * ⚠️ **高度链（整页不滚动）不属本单**：`#129` 曾把「单滚动窗」钉在本文件里，
 * Issue #146 已把面板恢复成 #96 的整页不滚动形态，相关断言挪进
 * `AiPanelScrollChain.test.ts`（两单口径相反，混在一处只会互相打架）。
 *
 * 样式侧走 `sass` 真编译（`?raw` 对 scss 恒空串，同 `SpecListings.test` 口径）。
 */

/** 造一条记录（只填树化用到的字段）。 */
function rec(id: string, kind: string, createdAt: number): AiSessionRecord {
    return { id, kind, title: `${kind} · 主题`, model: "m1", createdAt, status: "done", turns: [] };
}

const zhLabel = (k: string): string => ({ convert: "转换", judge: "判题" })[k] ?? k;

/**
 * 样式片清单（vitest 的 `?raw` 对 scss **恒为空串**——`css:false`，同
 * `SpecListings.test.ts` 头注）：只借 glob key 当**文件路径表**，内容交给
 * `sass` 真编译（编译产物才是真落进页面的那份 CSS）。 */
const SCSS_PATHS = Object.keys(
    import.meta.glob("../../scss/*.scss", { query: "?raw", import: "default", eager: true }) as Record<string, string>
);
/** glob key → 「项目根相对路径」（本文件在 `src/ai/core/`，键以 `../../` 起步）。 */
const relOf = (k: string): string => `src/${k.replace(/^\.\.\/\.\.\//, "")}`;

describe("树头组数=去重类别数（gap-list S9 的徽标语义）", () => {
    it("单条种类不设层（叶子直接上提）时，组数仍按类别计", () => {
        const d = buildSessionTree([rec("j1", "judge", 10)], "", zhLabel);
        // 树只有一个顶层节点（判题叶子上提）——照 tree.nodes.length 会数成 1
        expect(d.nodes).toHaveLength(1);
        // 去重类别数才是稿的「组」语义
        expect(new Set([rec("j1", "judge", 10)].map((r) => r.kind)).size).toBe(1);
    });

    it("多类别各留一棵树时两口径一致（不会因改口径而漂移）", () => {
        const recs = [rec("c1", "convert", 20), rec("c2", "convert", 15), rec("j1", "judge", 10)];
        const d = buildSessionTree(recs, "", zhLabel);
        expect(d.nodes).toHaveLength(2);
        expect(new Set(recs.map((r) => r.kind)).size).toBe(2);
    });
});

describe("Jev 判定类别（Issue #201：源级锁，组件不挂载进单测）", () => {
    let app = "";
    let zh: Record<string, string> = {};
    let en: Record<string, string> = {};

    beforeAll(async () => {
        app = (await import("../components/SessionPanelApp.svelte?raw")).default;
        zh = (await import("../../i18n/zh-CN.json")).default as unknown as Record<string, string>;
        en = (await import("../../i18n/en.json")).default as unknown as Record<string, string>;
    });

    it("KIND_KEYS 含 jev → aiKindJev（类别过滤条与徽标走同一张表）", () => {
        const i = app.indexOf("const KIND_KEYS");
        expect(i, "找不到 KIND_KEYS").toBeGreaterThan(-1);
        const table = app.slice(i, app.indexOf("};", i));
        expect(table).toMatch(/jev:\s*"aiKindJev"/);
    });

    it("中英各有一键（缺一个就会把键名渲染给用户）", () => {
        expect(zh.aiKindJev).toBeTruthy();
        expect(en.aiKindJev).toBeTruthy();
        expect(zh.aiKindJev).not.toBe(en.aiKindJev);
    });
});

describe("详情头形态（源级锁：meta 常空 + 徽标自吃 auto）", () => {
    let detail = "";
    let css = "";

    beforeAll(async () => {
        detail = (await import("../components/SessionDetail.svelte?raw")).default;
        // ⚠️ scss 的 `?raw` 恒为空串（vitest 默认 `css:false`，同 SpecListings
        // 头注）：故这里**真编译**样式片——编译产物就是落进页面的那份 CSS
        // （语法坏掉会直接抛，选择器形态也一并验）。
        const sass = await import("sass");
        const path = SCSS_PATHS.find((p) => p.endsWith("/scss/aipanel.scss"));
        expect(path, "找不到 aipanel.scss（glob 清单为空？）").toBeTruthy();
        css = sass.compile(relOf(path!)).css;
    });

    it("meta 槽渲染成空 span（不注入时间/模型串）", () => {
        // 槽在场、但内容为空：不许出现 `{view.head.modelText}` 之类注入
        expect(detail).toContain('class="wengu-aipanel-meta"></span>');
        const head = detail.slice(detail.indexOf("wengu-aipanel-dhead"), detail.indexOf("wengu-aipanel-dbody"));
        expect(head).not.toMatch(/wengu-aipanel-meta">\s*\{/);
        // 模型名仍进 h3 的 title 悬停（信息不丢，S7）
        expect(head).toContain("title={view.head.modelText}");
    });

    it("状态徽标自带 stbadge 类、样式用类选择器吃 auto（不用 :last-child）", () => {
        expect(detail).toContain("wengu-aipanel-stbadge");
        expect(css).toContain(".wengu-aipanel-dhead .wengu-aipanel-stbadge");
        expect(css).not.toContain(".wengu-aipanel-dhead .wengu-aipanel-badge:last-child");
    });

    it("组数徽标与叶行徽标都走 500 字重基形（B1：不许再压回 400）", () => {
        expect(css).toMatch(/\.wengu-aipanel-badge\s*\{[^}]*font-weight:\s*500/);
    });
});

/**
 * #170（20260918）**叶行注记的形态收窄**（真机报障：窄侧栏下叶子行
 * 「点 + 名 + 注记 + 徽标」四件塞满，稿里只有三件）：
 *  1. **运行中行整条不渲染注记**——判据取**视图**的 `lv.spin`（与徽标转圈
 *     同源）。刻意**不**用 `lv.dotCls === "run"`（色名＝视图词表）或
 *     `rec.status === "running"`（状态词＝数据词表）：#92 的踩坑正是两套
 *     词表混用——只有 `done` 重叠，`run` 会静默失效。
 *  2. **注记去类别段、只留「MM-DD HH:MM」**——种类优先两级树里叶子已挂在
 *     「转换」组行下，`· 转换`是同屏重复；且注记与**贴右**徽标同排
 *     （`.wengu-aipanel-badge { margin-left:auto }`），串越长越把徽标往左挤。
 *
 * 规格与上面的 S7 断言同口径：组件不挂载进单测，走 `?raw` 源级锁。
 */
describe("叶行注记形态（#170 源级锁：运行中不出 + 去类别段只留时刻）", () => {
    let app = "";
    let zh = "";
    let en = "";

    beforeAll(async () => {
        app = (await import("../components/SessionPanelApp.svelte?raw")).default;
        zh = (await import("../../i18n/zh-CN.json")).default.aiRowMeta as string;
        en = (await import("../../i18n/en.json")).default.aiRowMeta as string;
    });

    /** 树叶子行那段 main 片段（切到 `{/snippet}` 收口，防误伤组行/详情头）。 */
    const leafSnippet = (): string => {
        const i = app.indexOf("wengu-aipanel-dot is-");
        expect(i, "找不到叶行渲染片段").toBeGreaterThan(-1);
        const j = app.indexOf("{/snippet}", i);
        expect(j, "叶行片段没有收口").toBeGreaterThan(i);
        return app.slice(i, j);
    };

    it("运行中行不渲染注记（判据取视图 spin，与徽标转圈同源）", () => {
        const leaf = leafSnippet();
        // 注记的渲染条件自带 `!lv?.spin`——运行中整条让位给设计稿三件套
        expect(leaf).toContain("!lv?.spin");
        // 判据不许拿**色名**（视图词表）或**状态词**（数据词表）：见上「#92」
        const cond = leaf.slice(leaf.indexOf("{#if"), leaf.indexOf("wengu-aipanel-meta"));
        expect(cond).not.toContain("dotCls");
        expect(cond).not.toContain("status");
    });

    it("注记只喂时间：类别段已从模板与调用点双双移除", () => {
        const leaf = leafSnippet();
        expect(leaf).toContain('fmt(t("aiRowMeta"), {');
        expect(leaf).toContain("time: rowStamp(");
        expect(leaf).not.toContain("kind:");
        // 两语言模板都一段式（分隔符是排版约定，不该再拼类别）
        expect(zh.trim()).toBe("{time}");
        expect(en.trim()).toBe("{time}");
    });

    it("注记的排版形态未动（只收窄串长，不改 mono 弱注记位）", async () => {
        // 样式侧零规则改动：`.wengu-aipanel-tree .wengu-aipanel-meta` 仍是
        // mono + faint 的常驻弱注记（改的只是串长与运行中不出）
        const sass = await import("sass");
        const path = SCSS_PATHS.find((p) => p.endsWith("/scss/aipanel-tree.scss"));
        expect(path, "找不到 aipanel-tree.scss（glob 清单为空？）").toBeTruthy();
        const css = sass.compile(relOf(path!)).css;
        expect(css).toMatch(/\.wengu-aipanel-tree \.wengu-aipanel-meta\s*\{[^}]*flex:\s*none/);
        expect(css).toMatch(
            /\.wengu-aipanel-tree \.wengu-aipanel-meta\s*\{[^}]*font-family:\s*var\(--b3-font-family-code\)/
        );
    });
});
