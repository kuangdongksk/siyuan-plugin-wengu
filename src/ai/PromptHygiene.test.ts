import { describe, expect, it } from "vitest";
import { restoreAiImages, sanitizeAiImages } from "./PromptHygiene";
import { buildPrompt } from "../convert/service/ConvertService";
import { parseDrafts } from "../convert/service/QuestionDraft";

/**
 * 图片行消毒（20260903，MiniMax 2013）：发送侧 ![](assets/…) → 占位符
 * （内核 Lute 解析不出图片节点，不再以 detail:"auto" 发附件）；草稿侧
 * 还原。落盘 kramdown 与消毒前逐字同构是硬要求。
 */

describe("sanitizeAiImages", () => {
    it("assets 图片行换占位符，路径逐字保留", () => {
        const src = "如图所示。\n![](assets/3876273970-ta6w8oh.jpg)\n求概率。";
        expect(sanitizeAiImages(src)).toBe("如图所示。\n〔插图:assets/3876273970-ta6w8oh.jpg〕\n求概率。");
    });
    it("带 alt 与标题的图片行也命中（alt 丢弃，dest 含查询串原样保留）", () => {
        expect(sanitizeAiImages('![图1](assets/a-b.png "题图")')).toBe("〔插图:assets/a-b.png〕");
        expect(sanitizeAiImages("![](assets/x.jpg?w=100)")).toBe("〔插图:assets/x.jpg?w=100〕");
    });
    it("非 assets 图片与行内代码形态不动", () => {
        const keep = "远图 ![远程](https://example.com/a.png) 与 `![](assets/代码内.jpg)` 引用";
        // 代码内形态同样替换（宁换勿漏——内核 AST 不区分行内代码内的语法差异场景）
        expect(sanitizeAiImages(keep)).toContain("〔插图:assets/代码内.jpg〕");
        expect(sanitizeAiImages(keep)).toContain("![远程](https://example.com/a.png)");
    });
    it("幂等：已消毒文本再过一遍不变", () => {
        const once = sanitizeAiImages("![](assets/a.jpg)");
        expect(sanitizeAiImages(once)).toBe(once);
    });
});

describe("restoreAiImages", () => {
    it("占位符还原成图片行（幂等：真图片行原样过）", () => {
        expect(restoreAiImages("〔插图:assets/a.jpg〕")).toBe("![](assets/a.jpg)");
        expect(restoreAiImages("![](assets/a.jpg)")).toBe("![](assets/a.jpg)");
    });
    it("容忍模型改写括号/冒号/空白", () => {
        expect(restoreAiImages("【插图:assets/a.jpg】")).toBe("![](assets/a.jpg)");
        expect(restoreAiImages("〔插图：assets/a.jpg〕")).toBe("![](assets/a.jpg)");
        expect(restoreAiImages("〔插图: assets/a.jpg 〕")).toBe("![](assets/a.jpg)");
    });
    it("sanitize → restore 往返逐字同构", () => {
        const src = "题干\n\n![](assets/abc-2026.jpg)\n\n解析";
        expect(restoreAiImages(sanitizeAiImages(src))).toBe(src);
    });
});

describe("与生成链路的接缝", () => {
    it("buildPrompt 规则示例不被自消毒命中、真实图片行被换", () => {
        const prompt = sanitizeAiImages(buildPrompt("题干\n![](assets/real-fig.jpg)\n解析"));
        // 规则里的示意形式 ![](插图原路径) 非 assets 前缀，必须原样存活
        expect(prompt).toContain("![](插图原路径)");
        // 源文里的真实图片行换成占位符，prompt 不再含可被内核抠走的图片语法
        expect(prompt).toContain("〔插图:assets/real-fig.jpg〕");
        expect(prompt).not.toMatch(/!\[[^\]]*\]\(assets\//);
    });
    it("parseDrafts 把模型漏还原的占位行兜底成图片行", () => {
        const reply = `CAN_CONVERT: yes
REASON: 图题
@@Q type=single
@@P stem
如图，求阴影面积。
〔插图:assets/fig-2026.jpg〕
@@P ans
A
@@END`;
        const d = parseDrafts(reply)[0];
        expect(d.parts[0].text).toContain("![](assets/fig-2026.jpg)");
        expect(d.parts[0].text).not.toContain("〔插图:");
    });
});
