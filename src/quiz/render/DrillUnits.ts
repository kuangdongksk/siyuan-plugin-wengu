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

/** 组装渲染单元：有可解析 group 的题归入其材料组（材料缺失按独立题降级）。
 *  组按**连续段**归并——同一材料在卷中隔题再现=新开一个组单元，而不是
 *  并回早先那个（合并会把后段题挪进前段单元，破坏「顺序绝不重排」；
 *  也让组单元范围与题集段天然对齐，题集标题行不再漏插，20260903 审查P2）。 */
export function buildDrillUnits(list: WenguQuestion[], materials: WenguMaterial[]): DrillUnit[] {
    const byId = new Map(materials.map((m) => [m.id, m] as const));
    const units: DrillUnit[] = [];
    for (let i = 0; i < list.length; i++) {
        const q = list[i];
        const mat = q.group ? byId.get(q.group) : undefined;
        const last = units[units.length - 1];
        if (!mat || last?.kind !== "group" || last.mid !== mat.id) {
            units.push(
                mat ? { kind: "group", mid: mat.id, material: mat, qs: [{ q, idx: i }] } : { kind: "single", q, idx: i }
            );
            continue;
        }
        last.qs!.push({ q, idx: i });
    }
    return units;
}

/* ── 题集分组（聚合/多集专题的题号栏横线与正文标题行共用） ── */

/** 一个连续题集段：整卷里相邻同题集的题归一段（只切分视图，**绝不
 *  重排**——多集合刷的顺序=题集先后 × 集内原序）。 */
export interface SetGroup {
    setId: string;
    title: string;
    /** 整卷题号下标起点（0 基，与题号导航对齐）。 */
    start: number;
    count: number;
}

/** 按 q.rootId 的连续段分组（rootId=来源题集，setQuestions/questionsOf
 *  落解析时已归位；缺省归 "" 段兜底）。titleOf 由调用方给（docs 视图
 *  的 id→标题，缺省短 id 兜底）。 */
export function buildSetGroups(list: WenguQuestion[], titleOf: (setId: string) => string): SetGroup[] {
    const out: SetGroup[] = [];
    for (let i = 0; i < list.length; i++) {
        const setId = list[i].rootId ?? "";
        const last = out[out.length - 1];
        if (last && last.setId === setId) {
            last.count++;
            continue;
        }
        out.push({ setId, title: titleOf(setId), start: i, count: 1 });
    }
    return out;
}
