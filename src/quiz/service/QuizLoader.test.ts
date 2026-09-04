import { describe, expect, it } from "vitest";
import { savePrefs } from "./QuizLoader";

/** savePrefs 的存储契约：链尾吞掉落盘 reject。裸 `void save()` 漏出去
 *  是控制台未捕获拒绝（vitest 判整个文件挂）——重载后旧实例的 410
 *  生命周期闸走这，磁盘满等普通失败也走这（会话状态可丢，维持静默）。 */
describe("savePrefs", () => {
    it("吞落盘 reject：不留未捕获拒绝（410 生命周期闸/普通失败）", async () => {
        savePrefs({ save: () => Promise.reject({ code: 410, msg: "Plugin lifecycle has ended", data: null }) }, {});
        savePrefs({ save: () => Promise.reject(new Error("disk full")) }, {});
        await new Promise((r) => setTimeout(r, 0));
    });

    it("无 storage 直通；正常落盘不炸", async () => {
        let saved = 0;
        savePrefs(undefined, {});
        savePrefs(
            {
                save: async () => {
                    saved++;
                },
            },
            {}
        );
        await new Promise((r) => setTimeout(r, 0));
        expect(saved).toBe(1);
    });
});
