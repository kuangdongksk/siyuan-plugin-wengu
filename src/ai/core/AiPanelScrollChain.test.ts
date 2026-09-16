import { describe, expect, it, beforeAll } from "vitest";
import * as sass from "sass";

/**
 * 「整页不滚动」高度链的**回归锁**（Issue #146：`#129` 对稿还原把 #96 的
 * 高度链删了 ⇒ AI 会话工作区又出全屏滚动条；本单恢复链，并把它钉死在测试里）。
 *
 * 组件不挂载进单测，故走两步（同 `AiPanelGapRestore.test` / `WorkspaceDesign.test`
 * 口径）：
 *  1. **样式侧**：`sass.compile` 真编译（`?raw` 对 scss 恒空串），断言链上每一
 *     级的规则**在场且取值正确**——缺任一级都只是「真机看着没生效」，靠人眼守
 *     不住，本项目已回归两次；
 *  2. **源级**：宿主档的开/关（挂载开、卸载收）与越界防线见 `PanelFit.test.ts`。
 *
 * ⚠️ 判据：`#146` 恢复的是**有稿例外**的形态（`docs/design-spec.md` §12 登记
 * 的例外 → 恢复后按 §12 技术要点落地，例外登记同步移除）——「滚动窗落在列上」，
 * 但**不**保证短内容时列不被压扁（卡外件 `flex:none` 是另一半）。
 */

/** scss 分片（`?raw` 恒空串，只借 glob key 当路径表，内容交给 sass）。 */
const PATH_OF = (name: string): string => `src/scss/${name}`;
const SCSS_NAMES = Object.keys(
    import.meta.glob("../../scss/*.scss", { query: "?raw", import: "default", eager: true }) as Record<string, string>
).map((k) => k.replace(/^\.\.\/\.\.\/scss\//, ""));

/** 某分片编译产物（剥注释，免注释里的示例值被当规则命中）。 */
function cssOf(name: string): string {
    return sass.compile(PATH_OF(name)).css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 取某选择器的规则体（第一条命中；找不到抛错，防「选择器被删还全绿」）。 */
function bodyOf(css: string, sel: string): string {
    const i = css.indexOf(sel);
    expect(i, `未找到选择器 ${sel}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf("{", i);
    const close = css.indexOf("}", open);
    return css.slice(open + 1, close);
}

let panel = "";
let tree = "";
let rail = "";

beforeAll(() => {
    expect(SCSS_NAMES).toContain("aipanel.scss");
    expect(SCSS_NAMES).toContain("aipanel-tree.scss");
    expect(SCSS_NAMES).toContain("rail.scss");
    panel = cssOf("aipanel.scss");
    tree = cssOf("aipanel-tree.scss");
    rail = cssOf("rail.scss");
});

describe("§12 宿主档：只改写挂档的那一份主区", () => {
    it("`.wengu-ws-main--fit` 双类改写 flex 列 + 隐藏溢出（原始骨架不动）", () => {
        const fit = bodyOf(rail, ".wengu-ws-main.wengu-ws-main--fit {");
        expect(fit).toContain("display: flex");
        expect(fit).toContain("flex-direction: column");
        expect(fit).toContain("overflow: hidden");
        // 原始骨架仍是共用滚动窗（三个不挂档的面板靠它自滚）
        const main = bodyOf(rail, ".wengu-ws-main {");
        expect(main).toContain("overflow-y: auto");
    });
});

describe("§12 高度链：主区 → 面板页根 → 卡 → 卡内两列", () => {
    it("面板页根是 flex 列且 min-height:0 + height:100%", () => {
        const page = bodyOf(panel, ".wengu-aipage {");
        expect(page).toContain("display: flex");
        expect(page).toContain("flex-direction: column");
        expect(page).toContain("min-height: 0");
        expect(page).toContain("height: 100%");
    });

    it("卡外件不伸缩（标题/hint/过滤条钉在视野里，不被压扁）", () => {
        expect(panel).toContain(".wengu-aipage > .wengu-ws-title,");
        const fixed = panel.slice(panel.indexOf(".wengu-aipage > .wengu-ws-title,"));
        expect(fixed.slice(0, fixed.indexOf("}"))).toContain("flex: none");
    });

    it("卡吃剩余高：flex:1 1 auto + min-height:0 + 行高显式分配", () => {
        const card = bodyOf(panel, ".wengu-aipanel {");
        expect(card).toContain("flex: 1 1 auto");
        expect(card).toContain("min-height: 0");
        // 缺 grid 行高分配 ⇒ 隐式行是 auto，卡被内容撑长、列没有「剩余高」
        expect(card).toContain("grid-template-rows: auto minmax(0, 1fr)");
    });

    it("卡内两列各自收内滚窗（滚动落在列上，不出页面级滚动条）", () => {
        const treeCol = bodyOf(tree, ".wengu-aipanel-tree {");
        expect(treeCol).toContain("min-height: 0");
        expect(treeCol).toContain("overflow-y: auto");
        expect(treeCol).toContain("scrollbar-gutter: stable");
        expect(treeCol).toContain("overscroll-behavior: contain");
        const detailCol = bodyOf(panel, ".wengu-aipanel-pane {");
        expect(detailCol).toContain("min-height: 0");
        expect(detailCol).toContain("overflow-y: auto");
        expect(detailCol).toContain("scrollbar-gutter: stable");
    });

    it("列内滚动窗落地后不冲突：详情块不设 max-height（行高归内容）", () => {
        const dbody = bodyOf(panel, ".wengu-aipanel-dbody {");
        expect(dbody).not.toContain("max-height");
        expect(dbody).not.toContain("overflow");
        // 展开态正文块自身可滚（长输出不把列撑爆）
        expect(bodyOf(panel, ".wengu-aipanel-logfull {")).toContain("overflow: auto");
    });

    it("折单列（≤1000px）保持内滚窗档，不给树列 40vh 上限", () => {
        const i = tree.indexOf("@media (max-width: 1000px)");
        expect(i, "未找到 ≤1000px 折单列 @media").toBeGreaterThanOrEqual(0);
        const seg = tree.slice(i);
        expect(seg).toContain("grid-template-areas:");
        // 树列折单列后仍有内滚窗（滚动窗在列上，不回退成页面级滚动）
        const narrowCol = bodyOf(seg, ".wengu-aipanel-tree {");
        expect(narrowCol).toContain("border-bottom: 1px solid var(--b3-border-color)");
        expect(narrowCol).not.toContain("max-height: 40vh");
    });
});
