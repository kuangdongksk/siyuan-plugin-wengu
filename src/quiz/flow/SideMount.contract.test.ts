import { describe, expect, it } from "vitest";
import SIDE_MOUNT from "./SideMount.ts?raw";
import CARD_HTML from "../render/CardHtml.ts?raw";
import REVIEW_INDEX from "../../review/index.ts?raw";
import RAIL_MOUNT from "../render/RailMount.ts?raw";

/**
 * 侧栏挂载链的**装配契约**（Issue #202）。
 *
 * 坑的形状：批次 6-5 侧栏 Svelte 化时，`mountSideFor` 把 SidePanelApp 直接
 * mount 进壳里的 `<div data-side-host>` 占位——`.wengu-side` 由「`.wengu-panel`
 * 的直接子元素（flex stretch 全高）」变成「无样式 block 宿主的子元素
 * （高度 auto）」，底色/右边框在内容结束处截止、`.wengu-side-body` 的
 * `flex:1 + overflow-y:auto` 内滚窗随父级无确定高一起失效。
 *
 * **必须锚法**（对齐 `RailMount.mountRailFor`）：组件根要作布局容器的直接
 * 子元素时不能包宿主 div ⇒ 以 `v.el` 为 target、占位当 `anchor`、挂后自删。
 * 这是**装配链**约定：`mountSideFor` 是纯编排、无返回值可断言，且 CI 无
 * jsdom（`vitest.config` environment=node）——纯函数测试锁不住它，只能源级
 * 断言钉死（同 `RoundReport.contract.test.ts` / `ResumePicker.contract.test.ts`
 * 口径；#141/#142 的教训：单元用例各自绿而链子整条不通）。
 *
 * `?raw` 而非 `node:fs`——本仓无 @types/node，`node:fs` 过不了 svelte-check。
 */

const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

/** 剥注释后的源码（注释里复述写法/键名不算引用，同 §8.4 口径）。 */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** mountSideFor 函数体（只取侧栏那一段，别把 mountHeadFor 的宿主形态算进来）。 */
const sideBody = (): string => {
    const m = /export function mountSideFor\([\s\S]*?\n}/.exec(code(SIDE_MOUNT));
    return m?.[0] ?? "";
};

describe("侧栏挂载＝锚法（Issue #202）", () => {
    it("mountSideFor 以 v.el 为 target、占位当 anchor、挂后自删", () => {
        const body = sideBody();
        expect(body).not.toBe("");
        // target 是视图根（.wengu-panel），不是宿主占位
        expect(body).toMatch(/mountSvelteApp\(\s*SidePanelApp,\s*v\.el,/);
        // 占位仍是挂载锚，且挂载后自删（同 mountRailFor 的 anchor 惯用法）
        expect(body).toMatch(/\{\s*anchor:\s*host\s*\}/);
        expect(body).toContain("host.remove()");
    });

    it("不许退回「以 [data-side-host] 为 target 直挂」的旧形态（防回退）", () => {
        const body = sideBody();
        expect(body).not.toMatch(/mountSvelteApp\(\s*SidePanelApp,\s*host,/);
        // host 只作锚：除 querySelector / anchor / remove 外不得被当挂载目标传
        expect(body).not.toMatch(/mount\([^)]*host/);
    });

    it("两处壳仍落 [data-side-host] 占位（锚不能被顺手删掉）", () => {
        // quiz 主壳与 review 壳各一处（删了锚 ⇒ 侧栏整个不挂，静默）
        expect(CARD_HTML).toContain("data-side-host");
        expect(REVIEW_INDEX).toContain('"<div data-side-host></div>"');
    });

    it("与 rail 的锚法同构（同一惯用法，不是自创第二条路）", () => {
        // rail：target=v.el + { anchor } + anchor.remove()
        expect(RAIL_MOUNT).toMatch(/mountSvelteApp\(\s*RailApp,\s*v\.el,/);
        expect(RAIL_MOUNT).toContain("anchor.remove()");
        // side 侧同样三件齐全
        const body = sideBody();
        expect(count(body, "v.el,")).toBeGreaterThanOrEqual(1);
        expect(body).toContain("host.remove()");
    });
});
