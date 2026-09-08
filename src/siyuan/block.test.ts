import { describe, expect, it } from "vitest";
import { byDocOrder, kramdownBlockOrder } from "./block";

/** 块 id 样例（内核形态：14 位时戳-后缀）。 */
const id = (suffix: string): string => `20260805153221-${suffix}`;

describe("kramdownBlockOrder 文档序位置表", () => {
    it("按 IAL id 出现序编号（独立行/行内尾随/引用前缀三种 IAL 形态同收）", () => {
        const kd = [
            "### 一、矩阵的概念及运算",
            `{: id="${id("hv5m9pd")}" updated="20260806113439"}`,
            "#### 1. 矩阵的概念",
            `{: id="${id("mz3koua")}" updated="20260806113439"}`,
            `- 列表项{: id="${id("x7nhv8d")}"}`,
            "> 引用内小节",
            `> {: id="${id("qb9p3y")}"}`,
        ].join("\n");
        const order = kramdownBlockOrder(kd);
        expect([...order.keys()]).toEqual([id("hv5m9pd"), id("mz3koua"), id("x7nhv8d"), id("qb9p3y")]);
        expect(order.get(id("hv5m9pd"))).toBe(0);
    });

    it("块引用中的外来 id 不进表（锚定 id= 只认 IAL）", () => {
        const kd = ['正文提到别的块 ((20260701120000-abc1234 "外部标题"))', `{: id="${id("aaa")}"}`].join("\n");
        const order = kramdownBlockOrder(kd);
        expect(order.has("20260701120000-abc1234")).toBe(false);
        expect([...order.keys()]).toEqual([id("aaa")]);
    });

    it("重复出现的 id 取首次位置", () => {
        const kd = `{: id="${id("first")}" updated="x"}\n\n{: id="${id("second")}" updated="x"}\n\n{: id="${id("first")}"}`;
        expect([...kramdownBlockOrder(kd).keys()]).toEqual([id("first"), id("second")]);
    });

    it("无 IAL 的纯文本返回空表", () => {
        expect(kramdownBlockOrder("普通正文\n没有属性")).toEqual(new Map());
    });
});

describe("byDocOrder SQL 行回排", () => {
    const order = new Map([
        [id("c"), 0],
        [id("a"), 1],
        [id("b"), 2],
    ]);
    const idOf = (r: { id: string }): string => r.id;

    it("按位置表排序；无位置的行沉底并保持原相对序", () => {
        const rows = [{ id: id("a") }, { id: id("x") }, { id: id("c") }, { id: id("y") }, { id: id("b") }];
        expect(byDocOrder(rows, idOf, order).map((r) => r.id)).toEqual([id("c"), id("a"), id("b"), id("x"), id("y")]);
    });

    it("位置表为空（kramdown 拉取失败降级）= 原样返回", () => {
        const rows = [{ id: id("b") }, { id: id("a") }];
        expect(byDocOrder(rows, idOf, new Map())).toEqual(rows);
    });
});
