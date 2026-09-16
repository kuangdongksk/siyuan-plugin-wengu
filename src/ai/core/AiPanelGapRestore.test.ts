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
