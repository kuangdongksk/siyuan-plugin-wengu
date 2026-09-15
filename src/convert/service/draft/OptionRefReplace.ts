import { LETTERS } from "../../../types";
import type { DraftUnit } from "./QuestionDraft";

/**
 * 解析里的**选项引用标记**替换（Issue #131，20260915）：协议要求 AI 在
 * 解析中指代选项一律写 `〔opt:X〕`（X=该选项字母，全角方括号——与
 * 「〔插图:…〕」占位先例同款、与 kramdown IAL 的 `{: ` 无碰撞），不得用
 * 裸字母指代选项；非指代选项的大写字母（Plan A、维生素 A）照常书写。
 *
 * 落库前（**reseat 校正之后、renderUnit 之前**）把每个标记换成该选项的
 * **文本**（全角引号「」包裹、多个标记自然连排）。这样解析里不再含任何
 * 选项字母，两件事同时成立：
 *   1. 展示层洗牌只剩「答案字母重映射」一件事，不需要再改解析
 *      （存量数据的解析字母改写仍由 OptionShuffle ③ 承担）；
 *   2. 英语域不会被裸 A 误伤——AI 想指选项就得显式加标记，没加的一律
 *      当作普通大写字母原样不动。
 *
 * **字母表按部件上下文解析**（P1，20260915 审查）：题目里可以有**多个**
 * 选项组（顶层 `option*` + 多步题每步 `step-k-option*`），各组字母都从
 * A 重新编。若把全部选项拍平进同一个字母表，两步各 3 选项时 step-2 解析
 * 里的 `〔opt:A〕` 会被换成 **step-1** 的选项文本——静默错内容，恰是本单
 * 要杀的类。故解析类部件按**所属选项组**取字母表：
 *   - 顶层 `solution` / `stem` → 顶层 `option*` 组；
 *   - `step-k-*` 部件 → `step-k-option*` 组。
 *   分组口径与 `quiz/render/CardDisplayShuffle` 的逐步独立洗牌**同源**
 *   （那边是「各步独立洗 + 各步答案各自重写」，这边是「各步标记各自
 *   解析」），两处必须一起看。
 *
 *  ⚠️ **契约现实**（20260915 实测）：`resolvePart` 只认
 *  `step-N-(stem|option|answer)`，`@@P step-1-solution` 会解析成空名被丢
 *  ——**逐步解析部件当前不存在**（整题解析统一写 `@@P sol`，是顶层组）。
 *  下面的 `step-k-*` 分支因此是**前瞻实现**（协议将来加逐步解析即可直接
 *  生效，不会退回拍平错位），同时它对存量/非常规数据里的 `step-k-*`
 *  解析也是正确行为。
 *
 * 降级口径：X 非法（超出**该组**选项数 / 不是 A–H）→ 标记整体降级为
 * **裸字母 X**（丢标记不丢信息，宁可读起来突兀也不静默删字）；数学环境
 * （`$…$`/`$$…$$`、行内/围栏代码）内的标记**照常替换**——标记即显式
 * 意图，与 gloss 域「`^{}` 必须避开数学区间」的取舍相反（那里花括号是
 * LaTeX 语法，这里只是我们自己的占位）。
 */

/** 选项引用标记：全角〔opt:X〕，X 单字母（大小写都认）。 */
const MARK_RE = /〔opt:([A-Za-z])〕/g;

/** 选项组键（与 CardDisplayShuffle 的分组口径一致）：`""`=顶层，
 *  `step-k`=多步题第 k 步。
 *
 *  slot-opt（逐空候选池）**不参与分组**：它的字母只在同一空内有意义、
 *  AI 不引用其字母，故返回 null（这些部件按非选项处理）。 */
function groupOf(name: string): string | null {
    if (/^option/.test(name)) return "";
    return /^(step-\d+)-option/.exec(name)?.[1] ?? null;
}

/** 部件 → 它属于哪个选项组（null=不参与替换）。
 *  - 顶层 `solution` / `stem` → `""`（顶层 `option*` 组）；
 *  - `step-k-solution` / `step-k-stem` → `step-k`（该步 `step-k-option*`
 *    组）——⚠️ 当前 `resolvePart` 不产出该名（[[逐步解析尚未入协议]]），
 *    属前瞻分支，见模块头注释；
 *  - cloze/match 的 `slot-k-*` 与材料正文不参与（槽位字母不跨空引用）。 */
function ctxGroupOf(name: string): string | null {
    if (name === "stem" || name === "solution") return "";
    return /^(step-\d+)-(?:stem|solution)$/.exec(name)?.[1] ?? null;
}

/** 某选项组的选项文本（按渲染序＝字母序）。 */
function groupTexts(d: DraftUnit, key: string): string[] {
    return d.parts.filter((p) => groupOf(p.name) === key).map((p) => p.text.trim());
}

/** 把一处标记换成选项文本；X 非法时降级为裸字母。 */
function replacement(ch: string, opts: string[]): string {
    const i = LETTERS.indexOf(ch.toUpperCase());
    const text = i >= 0 ? opts[i] : undefined;
    return text ? `「${text}」` : ch.toUpperCase();
}

/** 替换一段文本里的全部选项引用标记（无标记原样返回，逐字节不变）。 */
export function replaceOptionRefs(text: string, opts: string[]): string {
    if (!text || !text.includes("〔opt:")) return text;
    return text.replace(MARK_RE, (_all, ch: string) => replacement(ch, opts));
}

/** 对一个草稿单元做标记替换（只动解析与题干——题干的选项引用同属考点
 *  说明，指代关系与解析同源；都按**所在组的字母表**解析）。
 *
 *  **返回新对象**（纯函数口径）：调用方拿到的 draft 上游可能还有别的
 *  消费者（渐进呈现视图、AI 会话面板），原地改会让「替换前/后」两个视图
 *  打架。无标记时返回**原对象**（引用相等，零开销）。
 *
 *  ⚠️ **两个调用点，别以为 SetWriter 是唯一出口**（20260915 审查 P1）：
 *  `SetWriter.append`（转换/增量链）与 `bank/ui/RegenDialog.runRegen`
 *  （**直写 replaceRecordKramdown，不经 SetWriter**）。将来再加任何
 *  「AI 产物直接落库」的链，一律照 regen 自己接线。
 */
export function replaceDraftOptionRefs(d: DraftUnit): DraftUnit {
    if (d.material) return d; // 材料块无选项组
    if (!d.parts.some((p) => p.text.includes("〔opt:"))) return d; // 无标记：原对象零开销
    // 组键 → 选项文本（懒建：只有真的出现标记的组才算，无标记组零开销）
    const cache = new Map<string, string[]>();
    const textsOf = (key: string): string[] => {
        const hit = cache.get(key);
        if (hit) return hit;
        const t = groupTexts(d, key);
        cache.set(key, t);
        return t;
    };
    let hit = false;
    const parts = d.parts.map((p) => {
        const key = ctxGroupOf(p.name);
        if (key === null || !p.text.includes("〔opt:")) return p;
        const opts = textsOf(key);
        if (opts.length === 0) return p; // 无对应选项组：保留原样（可见即知协议没被遵守）
        const text = replaceOptionRefs(p.text, opts);
        if (text === p.text) return p;
        hit = true;
        return { ...p, text };
    });
    return hit ? { ...d, parts } : d;
}

/** 整批替换（落库前调用一次；转换/增量/重生成三链共用）。 */
export function replaceOptionRefsMap(drafts: DraftUnit[]): DraftUnit[] {
    return drafts.map(replaceDraftOptionRefs);
}
