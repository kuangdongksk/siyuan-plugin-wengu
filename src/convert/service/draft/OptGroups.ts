import type { DraftUnit, DraftPart } from "./QuestionDraft";

/**
 * 选项组只读视图（Issue #176 接出）：落库层（`OptionRefReplace` 把解析里的
 * 裸字母/「字母+全文」引用规范化成「『文本』」）与标记替换需要同一套口径：
 *
 *   - **分组口径**：顶层 `stem`/`solution` + 顶层 `option*` = 一组（键 `""`）；
 *     `step-k-*` 部件配 `step-k-option*`（键 `step-k`）——各组字母**都从
 *     A 重新编**。拍平进同一张字母表会让 step-2 的引用命中 step-1 的选项
 *     （静默错内容），故口径必须唯一且共享，不能各处另起一套正则。
 *   - **字母表口径**：字母 = **渲染序**里的位次（`optionDisplayMd` 剥掉
 *     列表标记与字母标签后的空串不算位次，见 `slotsOf`）。
 *
 * 本模块只做「读」：不洗牌、不改文本、不落库（洗牌在
 * `OptionShuffle`/`CardDisplayShuffle`，写作由调用方定）。
 *
 * ⚠️ 展示层**不再**消费本模块（Issue #176 收窄，20260919）：`9d998f1`
 * 曾让 `CardDisplayShuffle` 洗牌时按 `collectOptionGroups` 的字母表改写
 * 解析里的字母引用，该特性已撤除——展示层只重映射 `answer` 字母。
 */

/** 选项部件名（顶层 option / step-k option；slot-opt 逐空候选池不在内）。 */
const OPTION_PART = /^option|^step-\d+-option/;

/** 列表标记：`- ` / `1. ` 一类（与 `types.splitOptionMd` 同约定）。 */
const LIST_MARK = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** 码点截断（长选项在解析里只留前 30 字 + 省略号）。
 *  ⚠️ 用 `Array.from` 数**码点**、不用 `str.length`：emoji/代理对与部分
 *  汉字扩展区算两码元，按 code unit 判会把 39 字符的长句误判成超长。 */
export function displayText(text: string, limit = 40, keep = 30): string {
    const chars = Array.from(text);
    return chars.length <= limit ? text : `${chars.slice(0, keep).join("")}…`;
}

/** 部件 → 它属于哪个选项组（null=不参与引用改写）。 */
export function groupOfPart(name: string): string | null {
    if (name === "stem" || name === "solution") return "";
    if (/^option/.test(name)) return "";
    return /^(step-\d+)-option/.exec(name)?.[1] ?? null;
}

/** 选项组键 → 该组的内部排序**值**。禁止用组内下标：顶层与各步的组内
 *  顺序本就各自正确，按（组、组内序）排会让各步按「步 10、步 2、步 1」
 *  这种字典序错位——步序必须按**数码**排（见组序）。 */
function groupSortValue(key: string): number {
    const m = /^step-(\d+)$/.exec(key);
    return m ? Number(m[1]) : 0;
}

/** 组内选项部件（渲染序 = 部件序；渲染层按连续同名部件合并重编字母）。 */
function optPartsOf(d: DraftUnit, key: string): DraftPart[] {
    return key === ""
        ? d.parts.filter((p) => /^option/.test(p.name))
        : d.parts.filter((p) => /^step-\d+-option/.test(p.name) && groupOfPart(p.name) === key);
}

/** 选项文本的**剥离器**（组件注入：`types.optionDisplayMd`）——本模块
 *  不反向依赖 `types`（那里是 UI/判分层的展示工具，convert 层不该拉它）。 */
export type OptStrip = (md: string) => string;

/** 备选分隔符（真机 `- A. 甲 / B. 乙` 挤在同一部件；见 `splitOptionMd`）。 */
const ALT_SPLIT = /\n(?=\s*(?:[-*+]|\d+[.)])\s+\S)/;

/** 一个选项部件 → 它在**字母表**里占几个位次（0 或 1）。
 *  挤行部件（整组选项塞进同一个 `@@P opt`）此前被算作单个位次，于是
 *  单字母/多字母的**字母 → 文本**映射各错一位（Issue #176）。现按
 *  列表标记拆行：拆出的每一行各占一个位次——与渲染层的拆行口径一致。 */
function slotsOf(part: DraftPart, strip: OptStrip): string[] {
    const lines = part.text.split(ALT_SPLIT);
    if (lines.length < 2) return [strip(part.text)];
    // 列表标记只标记「位次边界」，不参与剥离（部分行可能本就没标记）
    return lines.map((l) => strip(l.replace(LIST_MARK, "")));
}

/** 选项组只读视图：一张表 —— 组键 → 该组选项文本（渲染序＝字母序）。 */
export function collectOptionGroups(d: DraftUnit, strip: OptStrip): Map<string, string[]> {
    const groups = new Map<string, string[][]>();
    for (const p of d.parts) {
        const key = groupOfPart(p.name);
        if (key === null || !OPTION_PART.test(p.name)) continue;
        const slots = slotsOf(p, strip);
        const cur = groups.get(key);
        if (cur) cur.push(slots);
        else groups.set(key, [slots]);
    }
    const out = new Map<string, string[]>();
    for (const [key, parts] of groups) out.set(key, parts.flat());
    return out;
}

/** 解析/题干类部件所属的组（与 `collectOptionGroups` 的键同域）。 */
export function ctxGroupOf(name: string): string | null {
    if (name === "stem" || name === "solution") return "";
    return /^(step-\d+)-(?:stem|solution)$/.exec(name)?.[1] ?? null;
}

/** 组序（确定性）：按 `groupSortValue`——顶层 0、步 1/2/…/10（数码序）。 */
export function sortGroups(keys: Iterable<string>): string[] {
    return [...keys].sort((a, b) => groupSortValue(a) - groupSortValue(b) || a.localeCompare(b));
}

/** 逐组读取该组的选项部件（供洗牌重排原文用）。 */
export function optionPartsOfGroup(d: DraftUnit, key: string): DraftPart[] {
    return optPartsOf(d, key);
}
