import type { WenguMaterial, WenguQuestion } from "../../types";

/**
 * 单元化渲染（E1，english-question-review.md M3）：刷题列表按「单元」
 * 渲染——独立题=普通题卡；材料组=分栏组单元（材料上栏独立滚动 + 组内
 * 题一次一题在下栏，导航由 MaterialFlow 接管）。组单元内所有题卡都
 * 渲染（非当前的 hidden），恢复/揭示/收卷等既有流程按 .wengu-card
 * 遍历的语义全部保持。
 *
 * 渲染层在 components/QuizCardApp + components/GroupUnitApp（6-4a
 * 组件化，本文件只剩单元组装纯函数）；挂载编排在 render/CardMount。
 */

/** 组内一题（idx 为整卷题号下标，与题号导航对齐）。 */
export interface GroupUnitQ {
    q: WenguQuestion;
    idx: number;
}

/** 一个渲染单元。 */
export interface DrillUnit {
    kind: "single" | "group";
    /** single：题目与下标。 */
    q?: WenguQuestion;
    idx?: number;
    /** group：材料块 id 与材料。 */
    mid?: string;
    material?: WenguMaterial;
    qs?: GroupUnitQ[];
}

/** 组装渲染单元：有可解析 group 的题归入其材料组（材料缺失按独立题降级）。 */
export function buildDrillUnits(list: WenguQuestion[], materials: WenguMaterial[]): DrillUnit[] {
    const byId = new Map(materials.map((m) => [m.id, m] as const));
    const units: DrillUnit[] = [];
    const groupByMid = new Map<string, DrillUnit>();
    for (let i = 0; i < list.length; i++) {
        const q = list[i];
        const mat = q.group ? byId.get(q.group) : undefined;
        if (!mat) {
            units.push({ kind: "single", q, idx: i });
            continue;
        }
        let u = groupByMid.get(mat.id);
        if (!u) {
            u = { kind: "group", mid: mat.id, material: mat, qs: [] };
            groupByMid.set(mat.id, u);
            units.push(u);
        }
        u.qs!.push({ q, idx: i });
    }
    return units;
}
