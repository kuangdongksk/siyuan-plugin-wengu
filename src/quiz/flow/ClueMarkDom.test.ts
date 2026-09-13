import { describe, expect, it } from "vitest";
import { SKIP_SELECTOR, SUP_SELECTOR } from "./ClueMarkDom";

/**
 * 线索高亮与词形联动的**接口契约**（Issue #51）。
 *
 * 这两条 selector 是「匹配源」与「不许被包」的分工，真机表现为
 * 「英语材料选段含联动词时标线索不出任何高亮」（静默降级，不报错）。
 * 纯字符串断言即可锁死回退：DOM 级行为在 CI 里没有 jsdom 环境，
 * 但把 `.wengu-gloss-link` 放回 SKIP_SELECTOR 一定会复现该缺陷。
 */
describe("SKIP_SELECTOR：谁是线索匹配的文本源", () => {
    it("词表区 .wengu-gloss 跳过（词条/音标/释义不是原文）", () => {
        expect(SKIP_SELECTOR).toContain(".wengu-gloss");
    });

    it("联动词形 .wengu-gloss-link **不跳过**（<u> 包的就是原文本身）", () => {
        // 回归 Issue #51：把它排除在匹配源外 ⇒ 含联动词的选段整段定位失败
        expect(SKIP_SELECTOR).not.toContain(".wengu-gloss-link");
    });

    it("序号上标 .wengu-gloss-sup 不跳过（它要参与匹配，只在落格时挡）", () => {
        expect(SKIP_SELECTOR).not.toContain(".wengu-gloss-sup");
    });
});

describe("SUP_SELECTOR：谁不许被包 mark", () => {
    it("序号上标不许被包（mark 套上去只会在高亮里冒出莫名数字）", () => {
        expect(SUP_SELECTOR).toContain("wengu-gloss-sup");
    });

    it("与 SKIP_SELECTOR 分工不同，不混进匹配源跳过表", () => {
        expect(SUP_SELECTOR).not.toBe(SKIP_SELECTOR);
    });
});
