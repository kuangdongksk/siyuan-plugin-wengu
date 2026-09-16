import { describe, expect, it } from "vitest";
import { compile } from "svelte/compiler";

/**
 * 专题管理标题行的**布局收编**断言（Issue #145，20260916 真机走查：
 * 「按钮文本太长了」）。
 *
 * 为什么是源级断言（同 `ButtonVariants.test.ts` / `WorkspaceDesign.test.ts`
 * §13.2 口径）：这类「视觉挤不挤」的缺陷没有运行期错误可抓，改文案 / 换
 * 变体 / 塞回第四个钮都不会让四件套变红——只有把「什么在标题行、什么在
 * 菜单里」钉成断言才拦得住回退。
 *
 * ⚠️ 组件源码经 vitest 的 `?raw` 导入（本仓无 `@types/node`，不用 `node:fs`）；
 * 组件本身走 `svelte/compiler` 真编译（`css_unused_selector` 是唯一静态安全网，
 * 但 `check:svelte --threshold error` 会把它吞掉，同 §13.4 坑 2）。
 */

const RAW = import.meta.glob("./CollectionPanelApp.svelte", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;
const APP = RAW["./CollectionPanelApp.svelte"] ?? "";

/** 控制器源码（`?raw`）：菜单项在不在、锚点动作有没有落地。 */
const CTL_RAW = import.meta.glob("../core/ColPanelCtl.ts", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;
const CTL = CTL_RAW["../core/ColPanelCtl.ts"] ?? "";

/** i18n 字典原文（`?raw`，同 `dict.test.ts` 口径）——断言查**值**数量级。 */
const I18N = import.meta.glob("../../i18n/*.json", {
    query: "?raw",
    import: "default",
    eager: true,
}) as Record<string, string>;
const ZH = JSON.parse(I18N["../../i18n/zh-CN.json"]) as Record<string, string>;
const EN = JSON.parse(I18N["../../i18n/en.json"]) as Record<string, string>;

describe("专题管理标题行（Issue #145）", () => {
    it("标题行只留三钮：新建（outline）+ 刷新 + 更多，全部不换行", () => {
        const btns = APP.slice(APP.indexOf("wengu-ws-titlebtns"), APP.indexOf("wengu-col-list"));
        // 三钮且只有三钮
        expect(btns.match(/<Button\b/g)?.length).toBe(3);
        expect(btns).toContain('svgIcon("iconAdd")');
        expect(btns).toContain('svgIcon("iconRefresh")');
        expect(btns).toContain('svgIcon("iconMore")');
        // 主视觉重心只有一个：outline 只落在「新建」上，其余走 text
        expect(btns.match(/variant="outline"/g)?.length).toBe(1);
        expect(btns.match(/variant="text"/g)?.length).toBe(2);
    });

    it("被收编的两个动作仍在：按知识点收集… / 题库体检 落「更多」菜单，不变死键", () => {
        const menu = CTL.slice(CTL.indexOf("openMoreMenu("), CTL.indexOf("/** 点击专题"));
        expect(menu).toContain("this.openCollectDialog()");
        expect(menu).toContain("this.bankHealth()");
        expect(menu).toMatch(/new Menu\(/);
        // 菜单项图标走内核 Menu 的 icon 字段（sprite id），不是 emoji
        expect(menu).toMatch(/icon:\s*"iconSparkles"/);
        expect(menu).toMatch(/icon:\s*"iconCheck"/);
    });

    it("「更多」钮带 aria 语义（图标钮无文字，读屏靠它）", () => {
        expect(APP).toContain('aria-label={t("colMore")}');
        expect(APP).toContain('aria-haspopup="menu"');
        expect(APP).toMatch(/aria-expanded=\{moreMenu/);
    });

    it("文案收短：新建/体检 两语言同步缩短，功能名不丢", () => {
        // 「新建文件夹」6 字 → 「新建」2 字；「题库体检」4 字 → 「体检」2 字
        expect(ZH.colNewFolder).toBe("新建");
        expect(ZH.repairEntry).toBe("体检");
        expect(EN.colNewFolder).toBe("New");
        expect(EN.repairEntry).toBe("Checkup");
        // 键名不动（改动清单第 2 条：只改值，不新增/改键名）
        expect("colNewFolder" in ZH).toBe(true);
        expect("colCollect" in ZH).toBe(true);
    });

    it("菜单项沿用既有文案键（colCollect / repairEntry），标题行不再重复渲染它们", () => {
        const btns = APP.slice(APP.indexOf("wengu-ws-titlebtns"), APP.indexOf("wengu-col-list"));
        expect(btns).not.toContain("colCollect");
        expect(btns).not.toContain("repairEntry");
        expect(CTL).toContain('t("colCollect")');
        expect(CTL).toContain('t("repairEntry")');
    });

    it("§13.2 Svelte 真编译零 css_unused_selector（本组件无 `<style>`，防后续迁片静默删规则）", () => {
        expect(APP.length).toBeGreaterThan(0);
        const out = compile(APP, { css: "injected", dev: false, filename: "CollectionPanelApp.svelte" });
        const unused = out.warnings.filter((w) => w.code === "css_unused_selector").map((w) => String(w.message));
        expect(unused).toEqual([]);
    });
});
