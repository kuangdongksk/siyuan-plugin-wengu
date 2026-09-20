import type { DraftUnit, DraftPart } from "./QuestionDraft";
import { protectionMask } from "./LetterRefs";

/**
 * 选项组只读视图（Issue #176 接出）：**展示层**（`quiz/render/CardDisplayShuffle`
 * 洗选项时同步重写解析里的字母引用）与**落库层**（`OptionRefReplace` 把
 * 解析里的裸字母/「字母+全文」引用规范化成「『文本』」）需要同一套口径：
 *
 *   - **分组口径**：顶层 `stem`/`solution` + 顶层 `option*` = 一组（键 `""`）；
 *     `step-k-*` 部件配 `step-k-option*`（键 `step-k`）——各组字母**都从
 *     A 重新编**。拍平进同一张字母表会让 step-2 的引用命中 step-1 的选项
 *     （静默错内容），故口径必须唯一且共享，不能各处另起一套正则。
 *   - **字母表口径**：字母 = **渲染序**里的位次（`optionDisplayMd` 剥掉
 *     列表标记与字母标签后的空串不算位次，见 `optionTexts`）。
 *
 * 本模块只做「读」：不洗牌、不改文本、不落库（洗牌在
 * `OptionShuffle`/`CardDisplayShuffle`，改写由调用方定）。
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

/**
 * **长引用的字母前缀改写**（Issue #176）：截断形态 `「A proposal to
 * establish…」` 的前 30 字里含选项字母（英文选项的首词就是大写单词）。
 * 引用洗牌时若只按「独立字母词符」改，会把**句首字母**（A/C/D 恰好是
 * 选项字母时）当成引用改掉——`「A proposal…」` 变成 `「C proposal…」`，
 * 静默改内容（展示层自验踩到）。
 *
 * 改法：按标记协议 #131 的原口径——引用与字母是**同一个字母**指同一项，
 * 故只把紧跟在 `「` 之后的那个字母重映射（且该字母确为组内选项），
 * 引用文本逐字不动。
 *
 * ⚠️ **与词符改写的次序无关**（20260919 复核实测更正）：本条此前声称
 * 「顺序反了就会二次映射 A→C→B」，实测不成立。两个函数的命中集**由同一条
 * 判据（前导字符是 `「`）切开、互为补集**——`rewriteLetters` 每个命中都过
 * `isRefLetter`，而其中的 `QUOTE_BEFORE` 已把引用前缀位排除；`remapQuotedHead`
 * 只认被排除的那一位。故先改哪个都只各改一次，反序只可能「少改」、
 * 结构上到不了「重改」。
 *   - 锁：`ShuffleRemapInvariants.test.ts` 的 3 元全排列穷举（3000 组随机
 *     文本，两序零差异）+ 正序结果的显式断言；
 *   - 调用方（`CardDisplayShuffle.remapRefs`）仍按「先前缀、后词符」写，
 *     那是**可读性**（先处理更特殊的形态），不是正确性前提。
 *
 * ⚠️ **改的是「引用前缀」这一个字母**，引用正文逐字不动：按标记协议
 * 「前缀是位置引用、正文是内容」。真机形态「「A proposal to establish…」」
 * 里前缀与英文句首字母同形，只认 `「` 后紧贴的那一个。
 */
export function remapQuotedHead(text: string, toIdx: Map<number, number>, letters: string): string {
    // **全局**替换（不是只认文本开头）：一道题里可以有多个引用
    // （`「B. 甲」正确，「A. 乙」错误` 两条都要跟着映射——#176 自验踩到
    // 「只改了第一条、第二条仍指旧位」）。
    // 引用前缀 = `「` 后紧跟的**单个** A–H 字母（后随 `.` `、` 或空白——
    // `「A proposal…」` 这种英文句首是「字母 + 空格」、`「A. 文本」` 是
    // 「字母 + 标签」、`「A」` 是「字母 + 收尾」）。用「字母后不是字母」
    // 的判据避免把 `「ABC」` 里的 A 当引用。
    const QUOTED_HEAD = /「([A-H])(?![A-Za-z])/g;
    // ⚠️ **受保护区（行内/围栏代码、数学）内的引头原样**（#176 复核实录
    // 「R4」）：代码/数学区整体不是引用语境，`「A. 甲」` 落在这里是**内容**。
    // `rewriteLetters` 早已过 mask，本函数原先没接 ⇒ 同一段文本两层口径
    // 不一致（词符层不动、引头层照改）。
    const mask = protectionMask(text);
    return text.replace(QUOTED_HEAD, (all, ch: string, offset: number) => {
        if (mask[offset + 1]) return all; // offset +1：跳过 `「` 本身
        const i = letters.indexOf(ch);
        const j = i >= 0 ? toIdx.get(i) : undefined;
        return j === undefined ? all : `「${letters[j] ?? ch}`;
    });
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
