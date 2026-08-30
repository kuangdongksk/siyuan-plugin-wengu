import { describe, expect, it } from "vitest";
import { groupAttrsByBlock, planReimportRead, reimportCfg, reimportResume } from "./DocOps";

/** 「删除此题集」/「重新导入」的纯逻辑面（内核 IO 不进单测，见
 *  vitest.config.ts；行为契约见 docs/question-block-contract.md）。 */

describe("groupAttrsByBlock", () => {
    it("按块分组并去重同名属性", () => {
        const m = groupAttrsByBlock([
            { id: "b1", name: "custom-plugin-wengu-q" },
            { id: "b1", name: "custom-plugin-wengu-type" },
            { id: "b1", name: "custom-plugin-wengu-q" }, // 重复行（同块多查询面）
            { id: "b2", name: "custom-plugin-wengu-q" },
            { id: "doc", name: "custom-plugin-wengu-total-time" },
        ]);
        expect(m.get("b1")).toEqual(["custom-plugin-wengu-q", "custom-plugin-wengu-type"]);
        expect(m.get("b2")).toEqual(["custom-plugin-wengu-q"]);
        expect(m.get("doc")).toEqual(["custom-plugin-wengu-total-time"]);
        expect(m.size).toBe(3);
    });

    it("跳过缺 id/缺 name 的脏行", () => {
        const m = groupAttrsByBlock([
            { id: "", name: "custom-plugin-wengu-q" },
            { id: "b1" },
            {},
            { id: "b2", name: "custom-plugin-wengu-q" },
        ]);
        expect(m.size).toBe(1);
        expect(m.get("b2")).toEqual(["custom-plugin-wengu-q"]);
    });
});

describe("reimportCfg", () => {
    const src = "20260829090000-abcdefgh";

    it("prefs 上次选择优先，缺项回落设置默认", () => {
        const c = reimportCfg(
            src,
            { modelId: "m-last", fill: true, steps: false, know: "" },
            { convertModelId: "m-set", fillToChoice: false, bigToSteps: true, convertParallel: 2 }
        );
        expect(c.modelId).toBe("m-last");
        expect(c.fillToChoice).toBe(true); // prefs true 赢
        expect(c.bigToSteps).toBe(true); // prefs 缺省（false）回落设置 true
        expect(c.parallel).toBe(2);
    });

    it("prefs 全空时回落设置/默认值", () => {
        const c = reimportCfg(
            src,
            { modelId: "", fill: false, steps: false, know: "" },
            {
                convertModelId: "m-set",
            }
        );
        expect(c.modelId).toBe("m-set");
        expect(c.fillToChoice).toBe(false);
        expect(c.bigToSteps).toBe(false);
        expect(c.parallel).toBe(1);
    });

    it("另存模式、生成在源旁、默认无续跑（从头重转）", () => {
        const c = reimportCfg(src, { modelId: "", fill: false, steps: false, know: "" });
        expect(c.writeMode).toBe("newdoc");
        expect(c.targetRaw).toBe("");
        expect(c.resume).toBeUndefined();
    });

    it("续跑记录原样透传（有断点则接着跑）", () => {
        const c = reimportCfg(src, { modelId: "", fill: false, steps: false, know: "" }, undefined, {
            offset: 5000,
            kramdown: "已生成部分",
        });
        expect(c.resume).toEqual({ offset: 5000, kramdown: "已生成部分" });
    });

    it("并发批数收敛到 1~4；知识点串剥链接取 id、垃圾滤净", () => {
        const c = reimportCfg(
            src,
            {
                modelId: "",
                fill: false,
                steps: false,
                know: "siyuan://blocks/20260829080000-xyz12312 混入文字 20260829080000-abc12345,；junk",
            },
            { convertParallel: 9 }
        );
        expect(c.parallel).toBe(4);
        expect(c.knowRoots).toEqual(["20260829080000-xyz12312", "20260829080000-abc12345"]);
    });
});

describe("planReimportRead", () => {
    it("渐进文档=当前题集（newdoc 终止保留的常态）：读回它、不单独删", () => {
        // 半截 bug 回归：此形态漏读会让题集带着前半截进回收站，续跑只剩后半截
        expect(planReimportRead({ docId: "q1" }, "q1")).toEqual({ readId: "q1", removeId: "" });
    });

    it("渐进文档另有其人：读回并单独删（防孤儿）", () => {
        expect(planReimportRead({ docId: "k1" }, "q1")).toEqual({ readId: "k1", removeId: "k1" });
    });

    it("无记录/脏 id：什么都不读不删", () => {
        expect(planReimportRead(undefined, "q1")).toEqual({ readId: "", removeId: "" });
        expect(planReimportRead({ docId: "x'y;drop" }, "q1")).toEqual({ readId: "", removeId: "" });
    });
});

describe("reimportResume", () => {
    it("读回内容在手才带断点续跑", () => {
        expect(reimportResume({ offset: 5000 }, "已生成前半截")).toEqual({
            offset: 5000,
            kramdown: "已生成前半截",
        });
    });

    it("读回为空回落记录里的 kramdown（原位形态残留）", () => {
        expect(reimportResume({ offset: 5000, kramdown: "记录里的" }, "")).toEqual({
            offset: 5000,
            kramdown: "记录里的",
        });
    });

    it("什么都读不回则不带断点（防「只有后半截」的续跑）", () => {
        expect(reimportResume({ offset: 5000 }, "")).toBeUndefined();
        expect(reimportResume({ offset: 5000 }, "   ")).toBeUndefined();
        expect(reimportResume(undefined, "")).toBeUndefined();
    });
});
