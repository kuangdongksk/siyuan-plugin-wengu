import { describe, expect, it } from "vitest";
import {
    advanceCursor,
    buildNormIndex,
    fallbackCursor,
    locateToAnchor,
    normalizeKeep,
    parseToDirective,
    STEP_CHARS,
    stepWindow,
    stripToDirective,
} from "../source/CursorWindow";

const MD = [
    "# 第一章 极限",
    "",
    "## 习题1",
    "求 $\\lim_{x \\to 0}\\frac{\\sin x}{x}$ 的值。",
    "",
    "> 答案：1",
    "",
    "## 习题2",
    "已知函数 $f(x)=x^2$，求 $f'(x)$。",
    "",
].join("\n");

describe("stepWindow（取窗口）", () => {
    it("文档短于窗口时整篇返回", () => {
        const w = stepWindow(MD, 0, STEP_CHARS);
        expect(w.start).toBe(0);
        expect(w.end).toBe(MD.length);
        expect(w.text).toBe(MD);
    });

    it("长文档按阈值截断且尽量收在空行边界", () => {
        const long = `${"一行内容\n\n".repeat(3000)}尾段`;
        const w = stepWindow(long, 0, 200);
        expect(w.text.length).toBeLessThanOrEqual(200);
        expect(w.end).toBeLessThanOrEqual(200);
        expect(long.slice(w.start, w.end)).toBe(w.text);
        expect(w.text.endsWith("\n\n")).toBe(true); // 收在空行边界，不切行
    });

    it("从游标起取窗口且不越界", () => {
        const w = stepWindow(MD, 10, 40);
        expect(w.start).toBe(10);
        expect(w.text).toBe(MD.slice(10, w.end));
        const tail = stepWindow(MD, MD.length - 5, 100);
        expect(tail.end).toBe(MD.length);
    });

    it("游标越界时收敛到文档末尾", () => {
        const w = stepWindow(MD, MD.length + 999, 100);
        expect(w.start).toBe(MD.length);
        expect(w.text).toBe("");
        expect(w.end).toBe(MD.length);
    });

    it("片尾上限 limit：窗口不越片（分片并行用）", () => {
        const cut = MD.indexOf("## 习题2");
        const w = stepWindow(MD, 0, 1000, cut);
        expect(w.end).toBe(cut);
        expect(w.text).toBe(MD.slice(0, cut));
        // 游标已在片尾：空窗口（片内循环据此退出）
        const done = stepWindow(MD, cut, 1000, cut);
        expect(done.text).toBe("");
        expect(done.end).toBe(cut);
        // limit 仍受文档长约束（越界收敛）
        const over = stepWindow(MD, 0, 1000, MD.length + 999);
        expect(over.end).toBe(MD.length);
    });

    it("fallbackCursor = 窗口末尾", () => {
        expect(fallbackCursor(stepWindow(MD, 5, 30))).toBe(stepWindow(MD, 5, 30).end);
    });
});

describe("normalizeKeep（归一化）", () => {
    it("剥空白与标点，保留实义字符", () => {
        expect(normalizeKeep("求 $\\lim_{x \\to 0}$ 的值。")).toBe("求limxto0的值");
        expect(normalizeKeep("  ① 甲、乙；丙  ")).toBe("①甲乙丙"); // ①②③ 属数字类，保留
    });
});

describe("parseToDirective / stripToDirective（@@TO 行）", () => {
    it("识别 END 变体", () => {
        expect(parseToDirective("...\n@@TO: END")).toEqual({ kind: "end" });
        expect(parseToDirective("...\n@@TO: 结束")).toEqual({ kind: "end" });
    });

    it("识别锚点片段并剥引号", () => {
        expect(parseToDirective('...\n@@TO："求 $\\lim_{x \\to 0}$ 的值。"')).toEqual({
            kind: "anchor",
            text: "求 $\\lim_{x \\to 0}$ 的值。",
        });
    });

    it("没有 @@TO 行返回 undefined", () => {
        expect(parseToDirective("@@Q type=single\n@@P stem\n题干\n@@END")).toBeUndefined();
        expect(parseToDirective("@@TO:")).toBeUndefined();
    });

    it("剥离 @@TO 行后行协议解析不受污染", () => {
        const reply = "@@Q type=single\n@@P stem\n题干\n@@END\n@@TO: 求某函数的值";
        expect(stripToDirective(reply)).toBe("@@Q type=single\n@@P stem\n题干\n@@END\n");
    });
});

describe("locateToAnchor（片段 → 新游标）", () => {
    it("命中后推进到该行下一行行首", () => {
        const idx = buildNormIndex(MD);
        const next = locateToAnchor(MD, 0, "求 $\\lim_{x \\to 0}\\frac{\\sin x}{x}$ 的值。", idx);
        expect(next).toBeDefined();
        expect(MD.slice(0, next!)).toContain("求 $\\lim");
        // 推进点之后紧接着的内容就是下一行（空行 + 答案行）
        expect(MD.slice(next!).startsWith("\n> 答案：1")).toBe(true);
    });

    it("标点/空白抄错也能命中（归一化）", () => {
        const idx = buildNormIndex(MD);
        const next = locateToAnchor(MD, 0, "已知函数 f(x)=x^2 求 f'(x)", idx);
        expect(next).toBeDefined();
        expect(MD.slice(0, next!)).toContain("已知函数 $f(x)=x^2$");
    });

    it("只在游标之后搜索，不倒退回上游文本", () => {
        const idx = buildNormIndex(MD);
        const from = MD.indexOf("## 习题2");
        const next = locateToAnchor(MD, from, "求 $\\lim_{x \\to 0}\\frac{\\sin x}{x}$ 的值。", idx);
        expect(next).toBeUndefined(); // 该片段在 from 之前，不应命中
    });

    it("片段过短或搜不到返回 undefined", () => {
        const idx = buildNormIndex(MD);
        expect(locateToAnchor(MD, 0, "极限", idx)).toBeUndefined();
        expect(locateToAnchor(MD, 0, "这段原文里根本不存在的句子内容", idx)).toBeUndefined();
    });

    it("末行命中时推进到文档末尾", () => {
        const md = "开头\n\n最后一段没有换行结尾";
        const next = locateToAnchor(md, 0, "最后一段没有换行结尾");
        expect(next).toBe(md.length);
    });
});

describe("advanceCursor（窗口 + @@TO → 新游标）", () => {
    /** 行行不同的长文本（每行归一化后都够长且唯一，避免误命中）。 */
    const long = `${Array.from({ length: 60 }, (_, i) => `第${i}行独特内容甲乙丙丁${i}`).join("\n\n")}\n\n尾段收口`;
    const win = stepWindow(long, 0, 200);

    it("END 走窗口末", () => {
        const r = advanceCursor(long, 0, win, { kind: "end" });
        expect(r).toEqual({ cursor: win.end, located: true });
    });

    it("片段命中走片段所在行的下一行", () => {
        const firstLine = long.split("\n")[0];
        const r = advanceCursor(long, 0, win, { kind: "anchor", text: firstLine });
        expect(r.located).toBe(true);
        expect(r.cursor).toBe(firstLine.length + 1); // 第一行行首 + 长度 + 换行
        expect(r.cursor).toBeLessThanOrEqual(win.end);
    });

    it("命中点越出本窗口视为失败（退回窗口末）", () => {
        const outside = long.slice(win.end + 5, win.end + 40);
        const r = advanceCursor(long, 0, win, { kind: "anchor", text: outside });
        expect(r).toEqual({ cursor: win.end, located: false });
    });

    it("无 @@TO 或片段不可定位时兜底到窗口末且不倒退", () => {
        expect(advanceCursor(long, 0, win, undefined)).toEqual({ cursor: win.end, located: false });
        expect(advanceCursor(long, 0, win, { kind: "anchor", text: "短" })).toEqual({
            cursor: win.end,
            located: false,
        });
        // 游标已越过窗口（异常态）也不能倒退
        const r = advanceCursor(long, win.end, win, undefined);
        expect(r.cursor).toBeGreaterThanOrEqual(win.end);
    });
});
