import { describe, expect, it } from "vitest";
import { reimportCfg, reimportResume } from "./DocOps";

/** 「删除此题集」/「重新导入」的纯逻辑面（内核 IO 不进单测，见
 *  vitest.config.ts；20260903 起题集=题库实体，planReimportRead/
 *  groupAttrsByBlock 随文档读写通道退役）。 */

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

    it("默认无续跑（从头重转新题集）", () => {
        const c = reimportCfg(src, { modelId: "", fill: false, steps: false, know: "" });
        expect(c.resume).toBeUndefined();
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

describe("reimportResume", () => {
    it("进度记录带题集 id 才有断点（已生成部分是题库真实记录）", () => {
        expect(reimportResume({ offset: 5000, setId: "set-abc" })).toEqual({ offset: 5000, setId: "set-abc" });
    });

    it("无题集 id 的记录（旧形态）不带断点，按全量重转", () => {
        expect(reimportResume({ offset: 5000 })).toBeUndefined();
        expect(reimportResume(undefined)).toBeUndefined();
    });
});
