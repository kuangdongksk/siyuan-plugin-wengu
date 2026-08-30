import { describe, expect, it } from "vitest";
import { parseTsv, spreadWindow } from "./WordImport";
import zh from "../../i18n/zh-CN.json";
import en from "../../i18n/en.json";

describe("parseTsv 三列解析", () => {
    it("标准三列：词+中文状态+天数", () => {
        const r = parseTsv("abandon\t复习中\t3\nbenevolent\t复习完成\t10");
        expect(r.rows).toEqual([
            { w: "abandon", st: "reviewing", days: 3 },
            { w: "benevolent", st: "done", days: 10 },
        ]);
        expect(r.bad).toBe(0);
    });

    it("两列（无天数）→ days undefined，走默认打散", () => {
        const r = parseTsv("apple\t已标熟");
        expect(r.rows).toEqual([{ w: "apple", st: "familiar" }]);
    });

    it("英文枚举同认，大小写不敏感", () => {
        const r = parseTsv("apple\tREVIEWING\t2\nbanana\tUnlearned");
        expect(r.rows[0]).toEqual({ w: "apple", st: "reviewing", days: 2 });
        expect(r.rows[1]).toEqual({ w: "banana", st: "unlearned" });
    });

    it("表头行跳过（「状态」/「status」，剥 BOM 后仍识别）", () => {
        const r = parseTsv("\uFEFF单词\t状态\t天数\napple\t复习中");
        expect(r.rows).toEqual([{ w: "apple", st: "reviewing" }]);
        expect(r.bad).toBe(0);
    });

    it("BOM 只影响首行首列——剥掉后单词可正常匹配", () => {
        const r = parseTsv("\uFEFF" + "Tabandon\t复习中");
        expect(r.rows[0].w).toBe("Tabandon");
    });

    it("状态未识别的行进 bad 计数，词进样本", () => {
        const r = parseTsv("apple\t忘了\nbanana\t复习中");
        expect(r.rows).toEqual([{ w: "banana", st: "reviewing" }]);
        expect(r.bad).toBe(1);
        expect(r.badSample).toEqual(["apple"]);
    });

    it("天数非法（0/负/非整数/超 365/非数字）→ undefined", () => {
        const lines = ["a\t复习中\t0", "b\t复习中\t-3", "c\t复习中\t2.5", "d\t复习中\t366", "e\t复习中\tabc"];
        const r = parseTsv(lines.join("\n"));
        expect(r.rows.every((x) => x.days === undefined)).toBe(true);
    });

    it("CRLF 与空行、列尾随空格均容忍", () => {
        const r = parseTsv("apple \t 复习中 \t 5 \r\n\r\nbanana\t复习完成\r\n");
        expect(r.rows).toEqual([
            { w: "apple", st: "reviewing", days: 5 },
            { w: "banana", st: "done" },
        ]);
    });
});

describe("spreadWindow 错峰窗口随量自适应", () => {
    it("小量下限 7 天；700 词恰好每日 100；大量线性放大", () => {
        expect(spreadWindow(0)).toBe(7);
        expect(spreadWindow(300)).toBe(7); // 300/100=3 → 下限 7 兜住
        expect(spreadWindow(700)).toBe(7);
        expect(spreadWindow(701)).toBe(8);
        expect(spreadWindow(2000)).toBe(20);
        expect(spreadWindow(3000)).toBe(30);
    });

    it("封顶 60 天（整本大书手滑也不摊成俩月后）", () => {
        expect(spreadWindow(6000)).toBe(60);
        expect(spreadWindow(50000)).toBe(60);
    });
});

describe("i18n 模板自洽（复制按钮产物 ←→ 解析器）", () => {
    it("zh/en 两语言模板均被 parseTsv 干净解析：表头跳过、四状态各一、bad=0", () => {
        for (const [lang, tpl] of [
            ["zh-CN", zh.wordImportTplValue],
            ["en", en.wordImportTplValue],
        ] as const) {
            const r = parseTsv(tpl);
            expect(r.bad, lang).toBe(0);
            expect(r.rows.map((x) => x.st).sort(), lang).toEqual(["done", "familiar", "reviewing", "unlearned"]);
        }
    });
});
