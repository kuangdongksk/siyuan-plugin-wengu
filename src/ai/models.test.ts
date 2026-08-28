import { afterEach, describe, expect, it } from "vitest";
import { resolveModelId } from "./models";

/** window.siyuan.config.ai 桩（node 无 window，动态挂全局；models.ts
 *  每次调用现读，改桩即生效）。回落口径见 resolveModelId 注释。 */
function stubAi(ai: Record<string, unknown>): void {
    (globalThis as { window?: unknown }).window = { siyuan: { config: { ai } } };
}

const TWO_MODELS = {
    agent: { modelId: "m2" },
    providers: [
        { id: "p1", displayName: "甲", enabled: true, models: [{ id: "m1", name: "A", enabled: true }] },
        { id: "p2", displayName: "乙", enabled: true, models: [{ id: "m2", name: "B", enabled: true }] },
    ],
};

afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
});

describe("resolveModelId", () => {
    it("有效的偏好 id 原样通过", () => {
        stubAi(TWO_MODELS);
        expect(resolveModelId("m1")).toBe("m1");
        expect(resolveModelId("m2")).toBe("m2");
    });

    it("失效偏好（已删模型的存量 id）回落默认模型", () => {
        stubAi(TWO_MODELS);
        expect(resolveModelId("20260827144713-dead")).toBe("m2");
    });

    it("空偏好走默认模型", () => {
        stubAi(TWO_MODELS);
        expect(resolveModelId("")).toBe("m2");
    });

    it("默认也无效/未配置 → 空串（省略 model 让内核自决）", () => {
        stubAi({ providers: TWO_MODELS.providers });
        expect(resolveModelId("dead")).toBe("");
        expect(resolveModelId("m1")).toBe("m1");
    });

    it("停用层不算可用：偏好与默认都在但被停用 → 空串", () => {
        stubAi({
            agent: { modelId: "off" },
            providers: [{ id: "p1", enabled: true, models: [{ id: "off", name: "X", enabled: false }] }],
        });
        expect(resolveModelId("off")).toBe("");
    });
});
