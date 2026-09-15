/**
 * 阅读组材料/题目可拖分隔条的**纯逻辑层**（Issue #138，交互语义按
 * antd Splitter；设计依据 `design/sidebar-gap-list.md` §6.1 + §7.c）。
 *
 * 背景：材料区限高原是固定 `--wengu-mat-cap:52vh`（Issue #87 落地）。
 * 一篇长材料的阅读量与题量并无固定比例——用户要求**可上下拖动调比例**，
 * 把「材料区多高」这件事交回作答者。本模块只出**不计 DOM 的四件事**：
 *
 * - `MAT_MIN_PX` / `matMaxPx`：约束（min 160px；max `min(75vh, host 高)`）；
 * - `clampMatCap`：任意来源的高度意图 → 合法 px（超界 clamp，不抛）；
 * - `ratioOf` / `pxOfRatio`：px ↔ 比例（**存比例不存像素**，§7.c 持久化
 *   口径：换设备/换窗口高度稳）。**基准一律取视口高**：0.16–0.75 这对界
 *   与上限 75vh 同源，取「材料区所在列高」做分母时拖到上限会得 ≈0.9、
 *   越出上界被判脏（列高恒小于视口高，两者数学上不自洽——#138 复核实测）；
 * - `nextMatCap`：键盘（Arrow/Home/End）→ 新 px（映射不进组件，可测）；
 * - `normalizeMatRatio`：prefs 读侧夹取（越界/非法值回落默认 = 不写内联）。
 *
 * ⚠️ 边界口径**不在这里另立**：材料区是否真要限高仍只认
 * `MaterialScroll.materialScrollCap`（溢出才限），本模块只负责「用户拖到
 * 多高」这一件事，两者相乘的结果才是 `--wengu-mat-cap` 的 px 值。
 */

/** 材料区下限：至少可见数行（§7.c）。 */
export const MAT_MIN_PX = 160;

/** 上限口径里的视口系数：材料区最多占 75vh（§7.c）。 */
const MAX_VH = 0.75;

/** 键盘步进（ArrowUp/Down）与阈值（§7.c）。 */
export const MAT_STEP_PX = 24;

/** 拖后高度的上限：`min(75vh, host 可用高)`——题干区至少留一卡+作答行。
 *  ⚠️ `hostPx` 是**材料区所在列的可用高**（主区 `.wengu-main` 的
 *  clientHeight，量不到时退视口高），**不是材料区自己的高**：拿被调对象
 *  自身当上限，每一次放大都会被 clamp 压回当前值（棘轮：只能缩不能放），
 *  且比值恒 ≈1 被判脏、持久化静默失效（Issue #138 复核实测，勿改回去）。 */

export function matMaxPx(hostPx: number, viewportPx: number): number {
    return Math.min(viewportPx * MAX_VH, hostPx);
}

/** 高度意图 → 合法 px（约束内原样、超界 clamp）。下限优先于上限：
 *  窗口极矮（`hostPx < MAT_MIN_PX`）时仍回 160px —— 拖到比一行还矮
 *  等于把材料区「拖没了」，宁可让上限让步。 */
/** 键盘映射（§7.c）：`ArrowUp/Down` ±`MAT_STEP_PX`、`Home/End` 到 min/max；
 *  其它键回 `undefined`（调用方就此返回：不写值、不 `preventDefault`）。
 *
 *  `from` 是**当前材料区高（量算实值）**，不是「持久化比值折算」——未拖过
 *  时比值不存在，折算起步会算成 0，第一次按键把材料区直接拍到下限（复核
 *  实测）。步进结果同样过 `clampMatCap`，顶格/触底都不越界。 */
export function nextMatCap(key: string, from: number, hostPx: number, viewportPx: number): number | undefined {
    if (key === "ArrowUp") return clampMatCap(from - MAT_STEP_PX, hostPx, viewportPx);
    if (key === "ArrowDown") return clampMatCap(from + MAT_STEP_PX, hostPx, viewportPx);
    if (key === "Home") return clampMatCap(0, hostPx, viewportPx); // clamp 抬到 min
    if (key === "End") return clampMatCap(matMaxPx(hostPx, viewportPx), hostPx, viewportPx);
    return undefined;
}

export function clampMatCap(px: number, hostPx: number, viewportPx: number): number {
    if (Number.isNaN(px)) return MAT_MIN_PX; // 量算未就绪/脏输入：回下限，不抛
    const max = matMaxPx(hostPx, viewportPx);
    // ±Infinity 天然被 Math.min/max 收进边界，无需另判
    return Math.max(MAT_MIN_PX, Math.min(Math.max(max, MAT_MIN_PX), Math.round(px)));
}

/** 持久化比例的下界/上界（§7.c：0.16–0.75 小数）。
 *  下界 0.16 是「160px / 1000px 级视口」的保守取整，上界与上限口径同源。 */
export const MAT_RATIO_MIN = 0.16;
export const MAT_RATIO_MAX = 0.75;

/** px → 比例（**分母＝视口高**，见模块头注；视口高为 0 时回 `undefined`：
 *  量算未就绪，不落库不折算，免得把 `0/0=NaN` 写进 prefs）。 */
export function ratioOf(px: number, viewportPx: number): number | undefined {
    if (!(viewportPx > 0) || !Number.isFinite(px)) return undefined;
    return px / viewportPx;
}

/** 比例 → px（**乘数＝视口高**，与 `ratioOf` 同基准；视口高为 0 时回
 *  `undefined`：量算未就绪，调用方回退 CSS 默认 52vh 而不是写 0px 内联）。 */
export function pxOfRatio(ratio: number, viewportPx: number): number | undefined {
    if (!(viewportPx > 0) || !Number.isFinite(ratio)) return undefined;
    return ratio * viewportPx;
}

/** prefs **写侧**归一：非数 ⇒ `undefined`（拒绝），数值 ⇒ 夹到
 *  `[MAT_RATIO_MIN, MAT_RATIO_MAX]`。为什么写侧要夹而读侧要拒：
 *  写是**用户意图的合法化**——拖到下限 160px 在高视口下比值 0.148，夹到
 *  0.16 落库（恢复回来差十几像素，肉眼无感）；读是**存量数据的可信度检查**
 *  ——越界的存量值不可解释，当脏值（=未拖过）处置（见 `normalizeMatRatio`）。 */
export function clampMatRatio(raw: number): number | undefined {
    if (!Number.isFinite(raw)) return undefined;
    return Math.min(MAT_RATIO_MAX, Math.max(MAT_RATIO_MIN, raw));
}

/** prefs 读侧夹取：越界/非法（字符串、NaN、负值）一律回落 `undefined`
 *  = **不写内联**（回 CSS 的 52vh 默认），不是夹到边界——夹边界会让一个
 *  脏值悄悄变成「用户拖到极限」的观感，而它其实从没被拖过。 */
export function normalizeMatRatio(raw: unknown): number | undefined {
    const n = typeof raw === "number" ? raw : Number.NaN;
    if (!Number.isFinite(n)) return undefined;
    if (n < MAT_RATIO_MIN || n > MAT_RATIO_MAX) return undefined;
    return n;
}

/**
 * 分隔条比例的**宿主侧持有物**（Issue #138 §7.c 持久化口径的实现体）。
 *
 * 为什么要独立一个类而不是把三个字段挂 QuizView 上（20260915 实测）：
 * `quiz/index.ts` 有 574 行豁免额度（**额度＝上限，只许减不许增**，
 * `scripts/check-line-limit.mjs` 的 EXEMPTS 就是闸），本单直接往视图里塞
 * 字段 + 读写 + 落库守卫会一口气顶破它。故照 `ConvertAccess`（转换弹窗
 * 的 prefs 切片）先例，把「谁在拖、拖到多少、怎么存」收进本模块：
 * 视图侧只剩 `matSplit.read / write / snapshot` 三个薄访问器。
 *
 * 三条口径（与 §7.c 同源，别在别处另写一份）：
 *   - 读：`normalizeMatRatio` 夹取 ⇒ 越界/非法/缺失一律 `undefined`
 *     = **未拖过**，组件不写内联、回 CSS 的 52vh 默认（零迁移）；
 *   - 写：同一夹取守卫后再落库（脏值不许进 prefs），值没变则**不落盘**
 *     （拖动每帧都会走写口，相同值重复写会被 persistPrefs 放大成 IO 抖动）；
 *   - 快照：`undefined` 时**整个键缺席**（不是写 `null`/`0`）——「从未拖过」
 *     与「拖过又复位」在存储上同为「无该键」，两者行为本就一致（都回 52vh）。
 */
export class MatSplitPrefs {
    private ratio: number | undefined;

    /** 当前比例（`undefined` = 未拖过）。 */
    get current(): number | undefined {
        return this.ratio;
    }

    /** load 恢复：读侧夹取（脏值=未拖过）。返回是否有变化，供调用方决定
     *  是否重渲染（本单调用方在 load 链尾，恒重渲染，故此返回值只作语义）。 */
    restore(raw: unknown): boolean {
        const next = normalizeMatRatio(raw);
        const changed = next !== this.ratio;
        this.ratio = next;
        return changed;
    }

    /** 写入（拖动/键盘落库口）：夹取失败或值未变 ⇒ 零动作，回 `false`。
     *  `undefined` = **复位**（双击回默认），与「脏值」是两回事：脏值被拒
     *  且**不动已有值**，`undefined` 是显式清库（键整条缺席）。二者都要有
     *  ——只清内联不落库的话，下次装载按旧比例折算回来，「复位」是假的。 */
    write(raw: number | undefined): boolean {
        if (raw === undefined) {
            if (this.ratio === undefined) return false;
            this.ratio = undefined;
            return true;
        }
        const next = clampMatRatio(raw); // 写侧夹取（见 clampMatRatio 注）
        if (next === undefined || next === this.ratio) return false;
        this.ratio = next;
        return true;
    }

    /** `savePrefs` 的增量片（`undefined` 时键缺席，见类注）。 */
    snapshot(): { matCapRatio?: number } {
        return this.ratio === undefined ? {} : { matCapRatio: this.ratio };
    }
}
