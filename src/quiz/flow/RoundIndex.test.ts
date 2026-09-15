import { describe, expect, it } from "vitest";
import { roundIndexFor } from "./SideMount";

/**
 * 头部「第 N 轮 · 进行中」胶囊的序号（Issue #135 §3.5）。
 *
 * 锁的是**两处 off-by-one**（本单修的真机缺陷）：`rounds` 是装载时的历史
 * 快照，`startRound` 只 upsert 落盘、不追加进这个数组——
 *   - 新开一轮时要 +1（否则显示「第 0 轮」）；
 *   - 「继续上次」时 session 已在该数组里，不能再 +1（否则多报一轮）。
 */

describe("roundIndexFor · 进行中轮序号", () => {
    it("无进行中轮（session 空）→ 0（调用侧据此不出胶囊）", () => {
        expect(roundIndexFor([])).toBe(0);
        expect(roundIndexFor([{ id: "a" }, { id: "b" }])).toBe(0);
    });

    it("新开一轮（session 不在快照里）→ 历史轮数 + 1", () => {
        expect(roundIndexFor([], { id: "new" })).toBe(1);
        expect(roundIndexFor([{ id: "a" }, { id: "b" }], { id: "new" })).toBe(3);
    });

    it("「继续上次」（session 就是快照里的未收卷轮）→ 取它在表内的位次，不多算一轮", () => {
        const rounds = [{ id: "a" }, { id: "b" }, { id: "c" }];
        expect(roundIndexFor(rounds, { id: "c" })).toBe(3);
        expect(roundIndexFor(rounds, { id: "a" })).toBe(1);
    });
});
