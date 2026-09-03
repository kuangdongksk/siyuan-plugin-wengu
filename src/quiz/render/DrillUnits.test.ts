import { describe, expect, it } from "vitest";
import type { WenguQuestion } from "../../types";
import { buildDrillUnits, buildSetGroups } from "./DrillUnits";

/** 最小题（buildSetGroups 只读 rootId；buildDrillUnits 只读 group）。 */
const q = (id: string, extra: Partial<WenguQuestion> = {}): WenguQuestion => ({
    id,
    attempts: 0,
    wrongCount: 0,
    ...extra,
});

describe("buildSetGroups（多集合刷分组）", () => {
    it("按 rootId 连续段分组；同名段不跨段合并（顺序权威，绝不重排）", () => {
        const list = [
            q("a1", { rootId: "s1" }),
            q("a2", { rootId: "s1" }),
            q("b1", { rootId: "s2" }),
            q("a3", { rootId: "s1" }), // 同集再现=新段（手动专题混收的真实形态）
        ];
        const groups = buildSetGroups(list, (id) => (id === "s1" ? "高数" : "线代"));
        expect(groups).toEqual([
            { setId: "s1", title: "高数", start: 0, count: 2 },
            { setId: "s2", title: "线代", start: 2, count: 1 },
            { setId: "s1", title: "高数", start: 3, count: 1 },
        ]);
    });

    it("缺 rootId 归空串段兜底；空列表无分组", () => {
        expect(buildSetGroups([q("x")], () => "t")).toEqual([{ setId: "", title: "t", start: 0, count: 1 }]);
        expect(buildSetGroups([], () => "t")).toEqual([]);
    });

    it("单集合刷（全部同段）=一段（题号栏/正文零装饰的判据）", () => {
        const groups = buildSetGroups(
            [q("a"), q("b"), q("c")].map((x) => ({ ...x, rootId: "s0" })),
            () => "卷一"
        );
        expect(groups).toEqual([{ setId: "s0", title: "卷一", start: 0, count: 3 }]);
    });
});

describe("buildDrillUnits（组单元段首=组内首题下标）", () => {
    it("材料组按首题 idx 归位（正文标题行插点用）", () => {
        const list = [q("a"), q("b", { group: "m1" }), q("c", { group: "m1" }), q("d")];
        const units = buildDrillUnits(list, [{ id: "m1", rootId: "s", bodyMd: "材料" }]);
        expect(units.map((u) => u.kind)).toEqual(["single", "group", "single"]);
        expect(units[1].qs?.map((x) => x.idx)).toEqual([1, 2]);
    });
});
