import { describe, expect, it } from "vitest";
import {
    MAT_MIN_PX,
    MatSplitPrefs,
    MAT_RATIO_MAX,
    MAT_RATIO_MIN,
    clampMatCap,
    clampMatRatio,
    matMaxPx,
    nextMatCap,
    normalizeMatRatio,
    pxOfRatio,
    ratioOf,
} from "./MaterialSplitter";

/**
 * 阅读组可拖分隔条的**约束与持久化口径**（Issue #138 验收 3/4）。
 *
 * 拖拽的 DOM 一侧在 CI 里没有环境（本仓单测跑 node、不启 jsdom），故
 * 验收 3「min 160px、max min(75vh, host 可用高)，超界 clamp（纯函数带
 * 单测）」与验收 4「prefs 存比例、按 ratio × host 高 折算」全部落在
 * 本文件的纯函数上——组件侧只做「读事件 → 调这里 → 写内联变量」。
 */

/** 1080p 级别的宿主（主区可用高约 900px）。 */
const HOST = 900;
const VIEWPORT = 1080;

describe("matMaxPx：上限 = min(75vh, host 可用高)", () => {
    it("视口比例是主约束（正常窗口下 75vh 小于 host 高）", () => {
        expect(matMaxPx(HOST, VIEWPORT)).toBe(810);
    });

    it("host 更矮时按 host 封顶（窄窗/嵌面板，不溢出宿主）", () => {
        expect(matMaxPx(500, VIEWPORT)).toBe(500);
    });
});

describe("clampMatCap：超界 clamp、界内原样（验收 3）", () => {
    it("界内原样返回（取整）", () => {
        expect(clampMatCap(420.4, HOST, VIEWPORT)).toBe(420);
        expect(clampMatCap(160, HOST, VIEWPORT)).toBe(160);
        expect(clampMatCap(810, HOST, VIEWPORT)).toBe(810);
    });

    it("低于下限 ⇒ 抬到 160px（材料至少可见数行）", () => {
        expect(clampMatCap(0, HOST, VIEWPORT)).toBe(MAT_MIN_PX);
        expect(clampMatCap(-120, HOST, VIEWPORT)).toBe(MAT_MIN_PX);
        expect(clampMatCap(159, HOST, VIEWPORT)).toBe(MAT_MIN_PX);
    });

    it("高于上限 ⇒ 压到 max（拖动顶格不再移动，无视觉惩罚态）", () => {
        expect(clampMatCap(5000, HOST, VIEWPORT)).toBe(810);
        expect(clampMatCap(811, HOST, VIEWPORT)).toBe(810);
        expect(clampMatCap(5000, 500, VIEWPORT)).toBe(500);
    });

    it("窗口极矮（host < 160）⇒ 下限优先，不出现零高/负高材料区", () => {
        expect(clampMatCap(60, 100, 300)).toBe(MAT_MIN_PX);
    });

    it("非法输入（NaN/Infinity）⇒ 回落下限，不写出脏 px", () => {
        expect(clampMatCap(Number.NaN, HOST, VIEWPORT)).toBe(MAT_MIN_PX);
        expect(clampMatCap(Number.POSITIVE_INFINITY, HOST, VIEWPORT)).toBe(810);
    });
});

describe("ratioOf / pxOfRatio：存比例不存像素（验收 4）", () => {
    it("往返一致：px → ratio → px（四舍五入的整数 px 误差 ≤1）", () => {
        for (const px of [173, 300, 518, 810]) {
            const r = ratioOf(px, VIEWPORT)!;
            expect(Math.abs(pxOfRatio(r, VIEWPORT)! - px)).toBeLessThanOrEqual(1);
        }
    });

    it("换窗口高度：同一比例换算出不同 px（这正是「存比例」的意义）", () => {
        const r = ratioOf(0.48 * VIEWPORT, VIEWPORT)!; // 0.48
        expect(r).toBeCloseTo(0.48, 5);
        expect(pxOfRatio(r, 600)).toBeCloseTo(288, 5);
        expect(r).toBeLessThanOrEqual(MAT_RATIO_MAX);
    });

    it("视口未量算（0）⇒ 回 undefined，调用方回退 52vh 而非写 0px 内联", () => {
        expect(ratioOf(300, 0)).toBeUndefined();
        expect(pxOfRatio(0.48, 0)).toBeUndefined();
    });

    it("非法数值 ⇒ undefined", () => {
        expect(ratioOf(Number.NaN, HOST)).toBeUndefined();
        expect(pxOfRatio(Number.NaN, HOST)).toBeUndefined();
    });
});

describe("clampMatRatio：prefs 写侧归一（数值夹进区间，非数拒）", () => {
    it("区间内原样、越界夹到边界", () => {
        expect(clampMatRatio(0.5)).toBe(0.5);
        expect(clampMatRatio(0.148)).toBe(MAT_RATIO_MIN);
        expect(clampMatRatio(0.9)).toBe(MAT_RATIO_MAX);
    });

    it("非数 ⇒ undefined（调用方据此不落库）", () => {
        expect(clampMatRatio(Number.NaN)).toBeUndefined();
        expect(clampMatRatio(Number.POSITIVE_INFINITY)).toBeUndefined();
    });
});

describe("normalizeMatRatio：prefs 读侧夹取（脏值回默认，不回边界）", () => {
    it("合法区间内原样透出", () => {
        expect(normalizeMatRatio(MAT_RATIO_MIN)).toBe(MAT_RATIO_MIN);
        expect(normalizeMatRatio(0.48)).toBe(0.48);
        expect(normalizeMatRatio(MAT_RATIO_MAX)).toBe(MAT_RATIO_MAX);
    });

    it("越界 ⇒ undefined（脏值不许变成「用户拖到极限」的观感）", () => {
        expect(normalizeMatRatio(0.1)).toBeUndefined();
        expect(normalizeMatRatio(0.9)).toBeUndefined();
        expect(normalizeMatRatio(-1)).toBeUndefined();
    });

    it("非法类型/缺失 ⇒ undefined（旧 prefs 无此键即回 52vh 默认，零迁移）", () => {
        expect(normalizeMatRatio(undefined)).toBeUndefined();
        expect(normalizeMatRatio(null)).toBeUndefined();
        expect(normalizeMatRatio("0.5")).toBeUndefined();
        expect(normalizeMatRatio(Number.NaN)).toBeUndefined();
        expect(normalizeMatRatio({})).toBeUndefined();
    });
});

describe("nextMatCap：键盘映射（验收 2 的键盘腿）", () => {
    it("ArrowUp/Down 各 ±24px（步进后仍然过 clamp）", () => {
        expect(nextMatCap("ArrowUp", 400, HOST, VIEWPORT)).toBe(376);
        expect(nextMatCap("ArrowDown", 400, HOST, VIEWPORT)).toBe(424);
        // 步进到边界即被 clamp 收住（顶格不再越界）
        expect(nextMatCap("ArrowUp", 170, HOST, VIEWPORT)).toBe(MAT_MIN_PX);
        expect(nextMatCap("ArrowDown", 805, HOST, VIEWPORT)).toBe(810);
    });

    it("Home/End 到约束两端（min/max）", () => {
        expect(nextMatCap("Home", 400, HOST, VIEWPORT)).toBe(MAT_MIN_PX);
        expect(nextMatCap("End", 200, HOST, VIEWPORT)).toBe(matMaxPx(HOST, VIEWPORT));
    });

    it("其它键不响应（回 undefined ⇒ 调用方不写值也不 preventDefault）", () => {
        expect(nextMatCap("ArrowLeft", 400, HOST, VIEWPORT)).toBeUndefined();
        expect(nextMatCap("a", 400, HOST, VIEWPORT)).toBeUndefined();
        expect(nextMatCap(" ", 400, HOST, VIEWPORT)).toBeUndefined();
    });
});

describe("MatSplitPrefs：宿主侧持有物（验收 4 的落库口径）", () => {
    it("未拖过 ⇒ current 与快照都无值（键整条缺席，不写 null/0）", () => {
        const p = new MatSplitPrefs();
        expect(p.current).toBeUndefined();
        expect(p.snapshot()).toEqual({});
        expect("matCapRatio" in p.snapshot()).toBe(false);
    });

    it("write 成功落值并回 true；同值重写回 false（拖动每帧不放大 IO）", () => {
        const p = new MatSplitPrefs();
        expect(p.write(0.48)).toBe(true);
        expect(p.current).toBe(0.48);
        expect(p.write(0.48)).toBe(false);
        expect(p.write(0.5)).toBe(true);
    });

    it("write 写侧夹取：越界数值夹进规格区间，非数才拒（别让拖动白拖）", () => {
        const p = new MatSplitPrefs();
        expect(p.write(0.02)).toBe(true); // 高视口拖到下限：160/1440≈0.11 ⇒ 夹到 0.16
        expect(p.current).toBe(MAT_RATIO_MIN);
        expect(p.write(1.2)).toBe(true);
        expect(p.current).toBe(MAT_RATIO_MAX);
        expect(p.write(Number.NaN)).toBe(false);
        expect(p.write(Number.POSITIVE_INFINITY)).toBe(false);
        expect(p.current).toBe(MAT_RATIO_MAX); // 非数被拒时不动已有值
    });

    it("restore 读侧夹取：合法值进、脏值（越界/缺失/字符串）归 undefined", () => {
        const p = new MatSplitPrefs();
        expect(p.restore(0.3)).toBe(true);
        expect(p.current).toBe(0.3);
        expect(p.restore(undefined)).toBe(true); // 脏值归来 ⇒ 视为「未拖过」
        expect(p.current).toBeUndefined();
        expect(p.restore("0.5")).toBe(false); // 已 undefined，无变化
        expect(p.current).toBeUndefined();
    });

    it("restore 同值不报变化（调用方据此可省一次重渲染）", () => {
        const p = new MatSplitPrefs();
        p.restore(0.4);
        expect(p.restore(0.4)).toBe(false);
    });

    it("snapshot 与 restore 往返一致（prefs 只加键、不 bump version）", () => {
        const a = new MatSplitPrefs();
        a.write(0.62);
        const b = new MatSplitPrefs();
        b.restore(a.snapshot().matCapRatio);
        expect(b.current).toBe(0.62);
    });

    it("write(undefined) = 复位清库（双击回默认：键整条缺席，装载不再折算回来）", () => {
        const p = new MatSplitPrefs();
        p.write(0.5);
        expect(p.write(undefined)).toBe(true);
        expect(p.current).toBeUndefined();
        expect(p.snapshot()).toEqual({});
        // 已清库再清 = 无变化（不白写一次 prefs）
        expect(p.write(undefined)).toBe(false);
    });

    it("非数不动已有值（与复位是两回事：被拒 ≠ 静默清库）", () => {
        const p = new MatSplitPrefs();
        p.write(0.5);
        expect(p.write(Number.NaN)).toBe(false);
        expect(p.current).toBe(0.5);
    });
});

/**
 * 口径回归（#138 复核实测的两处**静默失效**，锁死防复发）：
 * 上限与比值的基准都必须是「材料区所在列的可用高」，**不是材料区自己的高**。
 * 取自身高 ⇒ ①放大被 clamp 压回当前值（棘轮：只能缩不能放）；
 * ②比值恒 ≈1 越出 0.16–0.75 ⇒ 判脏 ⇒ 写盘永远被拒（拖动等于没存过）。
 */
describe("基准口径：上限/比值都用列高（不是材料区自身高）", () => {
    /** 1080 视口、列可用高 900、默认 52vh 材料区（≈561）——真实量算形态。 */
    const COL = 900;
    const MATERIAL_DEFAULT = Math.round(VIEWPORT * 0.52);

    it("默认高度下放大有效（取自身高会得零效果）", () => {
        expect(clampMatCap(700, COL, VIEWPORT)).toBe(700);
        expect(clampMatCap(700, MATERIAL_DEFAULT, VIEWPORT)).toBe(MATERIAL_DEFAULT); // 反例：自指基准
    });

    it("缩到 400 后仍能放回去（棘轮效应的回归）", () => {
        expect(clampMatCap(400, COL, VIEWPORT)).toBe(400);
        expect(clampMatCap(600, COL, VIEWPORT)).toBe(600);
    });

    it("落库比值分母＝视口高（拖到上限=0.75 正落在界内，列高做分母会得 0.9 被拒）", () => {
        const MAXCAP = matMaxPx(COL, VIEWPORT); // 810
        expect(ratioOf(MAXCAP, VIEWPORT)).toBeCloseTo(0.75, 5);
        expect(normalizeMatRatio(ratioOf(MAXCAP, VIEWPORT))).toBeCloseTo(0.75, 5);
        // 反例①：列高做分母 ⇒ 拖到上限越出 0.75，写盘静默丢失
        expect(normalizeMatRatio(ratioOf(MAXCAP, COL))).toBeUndefined();
        // 反例②：材料区自身高做分母 ⇒ 恒 ≈1，同样被判脏
        expect(normalizeMatRatio(ratioOf(468, 468))).toBeUndefined();
    });
});
