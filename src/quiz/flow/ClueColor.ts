/**
 * 线索 mark 的主题多色（Issue #57）：纯逻辑层，无 DOM、无内核 IO——
 * 色板定义、`clueColors` 平行数组的对齐维护、颜色 → 内联样式换算、
 * 重叠合并后的归属判定全在这（带单测），DOM 施工与 UI 在别处。
 *
 * 口径（数据演进守则全项）：
 * - `clueColors[qid]?: number[]` 是 `clues[qid]` 的**平行字段**，下标严格
 *   对齐；某位缺失/越界 = 默认黄（存量线索零迁移、渲染不回写）；
 * - 值域：`-1`=默认黄，`0..3`=四主题色序（`CLUE_COLORS` 下标）；
 * - 色值一律走**思源主题 CSS 变量**（`--b3-card-*` 卡片色 +
 *   `-color` 前景色），零配置读取 ⇒ 明暗主题与第三方主题实时适配；
 * - 异常/未来值域（越界、非整数）一律**落回默认黄**（宁缺勿错）。
 */

/** 一格色板：`key` 落库值、`cssVar` 主题变量名、`labelKey` i18n 词条。 */
export interface ClueColorDef {
    key: number;
    /** 主题卡片色变量名（背景）。前景色 = `${cssVar}-color`。 */
    cssVar: string;
    /** 色名的 i18n 键。 */
    labelKey: string;
}

/**
 * 四主题卡片色（顺序即落库值 `0..3`）。变量名取自思源主题令牌：
 * `--b3-card-info` / `-success` / `-warning` / `-error`，各自另有
 * `-color` 前景色（见 `clueColorStyle`）。
 */
export const CLUE_COLORS: readonly ClueColorDef[] = [
    { key: 0, cssVar: "--b3-card-info", labelKey: "clueColorInfo" },
    { key: 1, cssVar: "--b3-card-success", labelKey: "clueColorSuccess" },
    { key: 2, cssVar: "--b3-card-warning", labelKey: "clueColorWarning" },
    { key: 3, cssVar: "--b3-card-error", labelKey: "clueColorError" },
];

/** 默认色（主路径「标为线索」一步标它，不开菜单即此）——`-1`=默认黄。 */
export const DEFAULT_CLUE_COLOR = -1;

/**
 * 色号 → 内联样式串（背景 + 前景，一律走主题变量）。
 *
 * 只认 `CLUE_COLORS` 的四个 key；`DEFAULT_CLUE_COLOR` 与任何越界/
 * 非整数一律回**默认黄**（宁缺勿错：值域异常取默认色，比写错色好；
 * 默认黄取 `--b3-card-warning`，与同题未选色的 mark 观感一致）。
 *
 * **主题变量取不到时返回空串**（不写 style，落回 scss 的
 * `mark.wengu-clue-mark` 默认观感）——写一个解不出的 `var()` 会让
 * `background-color` 在计算值阶段整条失效（比「色不对」更糟：高亮直接
 * 透明）。判定走一次真实的变量解析探测（带缓存），见 `themeVarsUsable`。
 */
export function clueColorStyle(key: number | undefined): string {
    const def = clueColorDef(key);
    const cssVar = def ? def.cssVar : "--b3-card-warning";
    if (!themeVarsUsable()) return "";
    return `background-color:var(${cssVar});color:var(${cssVar}-color)`;
}

/** 主题变量可用性缓存的探测结果（进程内一次，主题变量名固定不变）。 */
let varsUsable: boolean | undefined;

/**
 * 当前环境能否解析 `--b3-card-warning`（探测一次并缓存）。
 *
 * 极简/魔改主题可能不定义 `--b3-card-*`——值域内四色的**变量本身**恒在
 * 我们的样式串里，探测取其一即代表整组。
 *
 * 判定口径是「**自定义属性本身有没有值**」（`getPropertyValue` 读的是
 * 声明值，未定义即空串），不是「元素算出的背景色有没有值」——后者在
 * 变量解不出时是 `rgba(0, 0, 0, 0)`（**真值**），拿它当判据恒为可用，
 * 等于没判。无 DOM（单测/内核侧）时按**不可用**收口，调用侧落回 scss
 * 默认（宁缺勿错）。
 */
export function themeVarsUsable(): boolean {
    if (varsUsable !== undefined) return varsUsable;
    if (typeof document === "undefined" || !document.body) return (varsUsable = false);
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).getPropertyValue("--b3-card-warning").trim();
    probe.remove();
    return (varsUsable = resolved !== "");
}

/** 仅供单测复位探测缓存（生产路径不需要）。 */
export function resetThemeVarsProbe(): void {
    varsUsable = undefined;
}

/** 色号 → 色板格（默认/越界回 `undefined`，调用侧据此决定 fallback 观感）。 */
export function clueColorDef(key: number | undefined): ClueColorDef | undefined {
    if (typeof key !== "number" || !Number.isInteger(key)) return undefined;
    return CLUE_COLORS.find((c) => c.key === key);
}

/** 该位是否「显式选过色」（默认色号与越界都算没选）。 */
export function isPickedColor(key: number | undefined): boolean {
    return clueColorDef(key) !== undefined;
}

/* ── `clueColors` 对齐维护（下标与 `clues` 严格对齐） ── */

/** 一题的线索色号数组（缺省=该题从未选过色，全默认黄）。 */
export type ClueColorList = number[];

/**
 * 取第 i 条线索的色号（缺位/越界 = 默认黄）。
 *
 * **读侧一律走本函数**，别直接下标访问：数组短于 `clues` 是合法状态
 * （历史上只给前几条选过色），直接读会拿到 `undefined` 再散到样式里。
 */
export function clueColorAt(colors: readonly number[] | undefined, i: number): number {
    const v = colors?.[i];
    return typeof v === "number" && Number.isInteger(v) ? v : DEFAULT_CLUE_COLOR;
}

/**
 * 追加一条线索时推进色号数组（与 `pushClueRange` 同款口径）：
 * `colors === undefined`（该题从未选过色）⇒ 调用方不落库，保持零迁移；
 * 已建表 ⇒ 先把存量位补默认色占位、再 push 新色，**下标继续严格对齐**。
 */
export function pushClueColor(colors: ClueColorList | undefined, len: number, key: number): void {
    if (!colors) return;
    alignClueColors(colors, len);
    colors.push(key);
}

/**
 * 确保色号数组与文本数组**等长**（补默认色占位）。`undefined` ⇒ 不建表
 * （零迁移：该题此前没选过色，继续保持「无表=全默认黄」）。
 */
export function alignClueColors(colors: ClueColorList | undefined, len: number): void {
    if (!colors) return;
    while (colors.length < len) colors.push(DEFAULT_CLUE_COLOR);
    if (colors.length > len) colors.length = len;
}

/** 删除第 i 条：色号数组同下标同步删（缺位也不影响文本侧删除）。 */
export function removeClueColor(colors: ClueColorList | undefined, i: number): void {
    if (!colors) return;
    if (i < 0 || i >= colors.length) return;
    colors.splice(i, 1);
}

/**
 * 给第 i 条线索选色（该题首次选色时由调用侧建空表再进本函数）：存量位
 * 补默认黄占位，目标位写新色。
 */
export function setClueColorAt(colors: ClueColorList, i: number, key: number): void {
    if (i < 0) return;
    while (colors.length <= i) colors.push(DEFAULT_CLUE_COLOR);
    colors[i] = key;
}

/* ── 合并归属（依赖 #56）：重叠区间取「最长那条线索」的色 ── */

/** 一条参与归属判定的线索引（长度 + 色号）；仅表达合并所需的两个量。 */
export interface ColorCand {
    /** 该条线索在 `clues` / `clueColors` 里的下标（-1 = 未知，取默认黄）。 */
    index: number;
    /** 本节点内的区间长度（合并归属按它取最长）。 */
    len: number;
}

/** 合并归属判定的**纯函数**（与 `mergeMarkSlots` 的长覆盖短同源口径）。 */
export function longestColorKey(cands: readonly ColorCand[], colors: readonly number[] | undefined): number {
    let best: ColorCand | undefined;
    for (const c of cands) {
        if (!best || c.len > best.len) best = c;
    }
    return best ? clueColorAt(colors, best.index) : DEFAULT_CLUE_COLOR;
}
