import { LETTERS } from "../../../types";
import { collectOptionGroups, ctxGroupOf, displayText } from "./OptGroups";
import { isRefLetter, LETTER_TOKEN, protectionMask, OPEN_BEFORE } from "./LetterRefs";
import { optionDisplayMd } from "../../../types";
import type { DraftUnit } from "./QuestionDraft";

/**
 * 解析里的**选项引用标记**替换（Issue #131，20260915）：协议要求 AI 在
 * 解析中指代选项一律写 `〔opt:X〕`（X=该选项字母，全角方括号——与
 * 「〔插图:…〕」占位先例同款、与 kramdown IAL 的 `{: ` 无碰撞），不得用
 * 裸字母指代选项；非指代选项的大写字母（Plan A、维生素 A）照常书写。
 *
 * 落库前（**reseat 校正之后、renderUnit 之前**）把每个标记换成该选项的
 * **文本**（全角引号「」包裹、多个标记自然连排）。这样解析里不再含任何
 * 选项字母（长选项只**截断**、不补字母，见下），两件事同时成立：
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
 * **长选项截断形态**（Issue #148 追加评论）：英语阅读题的选项是完整英文
 * 长句，整句塞进解析会让「正确答案：〈60+ 字符英文整句〉」连占三行（真机
 * 截图）。故超过 {@link LONG_OPT} 码点的选项只保留前 {@link HEAD_KEEP} 字
 * 加省略号（`「A proposal to establish…」`）——解析行可读优先；短选项
 * （政治题「维护封建统治」之类）维持全文替换，逐字节与改造前一致。
 *  ⚠️ **截断后不补字母提示**（追加评论的备选形态之一，此处不采纳）。理由
 *  两条，都是硬约束：
 *    1. 字母是**位置引用**，与本模块的冻结口径「库内解析不含任何选项字母」
 *       正面对撞（见上：库/源文档是**死形态**，选项按原文顺序）。字母提示
 *       一旦烘进解析文本，就随库里那份文本固化在**转换时的位置**上；
 *    2. 而展示层 `CardDisplayShuffle` 进卡前按会话现洗选项、只重映射
 *       `answer` 字母、**不重写解析文本**（设计如此，见该模块文件头）。
 *       于是一旦洗牌换序，提示字母就指向**另一个选项**——卡上「正确答案」
 *       高亮的是一项、解析里的「（D）」指着另一项，属**用户可见的错误指代**，
 *       且每换一轮会话都可能错到别处。
 *  故这里只截断、不带字母：**截断后的前 30 字本身即指代**（选项互异），
 *  且卡内「正确答案是哪个选项」另由 `answer` 字母 + 描色呈现（`solutionMd`
 *  与 `answer` 是两个部件），不需要解析文本再带一份字母。
 *
 * 降级口径：X 非法（超出**该组**选项数 / 不是 A–H）→ 标记整体降级为
 * **裸字母 X**（丢标记不丢信息，宁可读起来突兀也不静默删字）；数学环境
 * （`$…$`/`$$…$$`、行内/围栏代码）内的标记**照常替换**——标记即显式
 * 意图，与 gloss 域「`^{}` 必须避开数学区间」的取舍相反（那里花括号是
 * LaTeX 语法，这里只是我们自己的占位）。
 */

/** 选项引用标记：全角〔opt:X〕，X 单字母（大小写都认）。 */
const MARK_RE = /〔opt:([A-Za-z])〕/g;

/** 选项文本的解析展示形态（Issue #148）：短选项全文、长选项**截断 +
 *  省略号**（实现接出到 `OptGroups.displayText`，#176 起与落库规范化
 *  共用同一阈值/截断口径）。
 *  ⚠️ **不带字母提示**（不写「…（D）」）：字母是位置引用，会随展示层洗牌
 *  变成错误指代，也与「库内解析不含选项字母」的冻结口径冲突。 */
const display = (text: string): string => displayText(text);

/** 把一处标记换成选项文本（长选项截断）；X 非法时降级为裸字母。 */
function replacement(ch: string, opts: string[]): string {
    const i = LETTERS.indexOf(ch.toUpperCase());
    const text = i >= 0 ? opts[i] : undefined;
    return text ? `「${display(text)}」` : ch.toUpperCase();
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
 *  ⚠️ **三个调用点，别以为 SetWriter 是唯一出口**（20260915 审查 P1）：
 *    1. `SetWriter.append`（转换/增量链）；
 *    2. `bank/ui/RegenDialog.runRegen`（**直写 replaceRecordKramdown，
 *       不经 SetWriter**）；
 *    3. `bank/gen/GenQuestion.genWithVerify`（加练/变式链产物经
 *       `addGenerated` **直写题库**，同样不经 SetWriter）。
 *  后两处都是「AI 产物直接落库」的链，标记替换必须各自接线——`SetWriter`
 *  兜不到它们。将来再加同类链，一律照这两处自己接。
 */
export function replaceDraftOptionRefs(d: DraftUnit): DraftUnit {
    if (d.material) return d; // 材料块无选项组
    if (!d.parts.some((p) => p.text.includes("〔opt:"))) return d; // 无标记：原对象零开销
    const groups = collectOptionGroups(d, optionDisplayMd);
    // 组键 → 选项文本（懒建：只有真的出现标记的组才算，无标记组零开销）
    const cache = new Map<string, string[]>();
    const textsOf = (key: string): string[] => {
        const hit = cache.get(key);
        if (hit) return hit;
        const t = groups.get(key) ?? [];
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

/**
 * 第二道：**裸字母 / 「字母+全文」引用规范化**（Issue #176，20260918）。
 *
 * 起因：#131 的冻结口径是「库内解析不含任何选项字母」，但**实际没守住**
 * ——工作区 bank 实查 841 道 single/multiple 里 835 道（99.3%）解析带字母
 * 引用。AI 常常无视 `〔opt:X〕` 标记约定，直接写「B. 时空与物质运动不可
 * 分割」或裸字母「A 正确，B 错误」；原实现遇到无标记文本**整段短路返回**，
 * 于是这些字母原样落库。而展示层洗牌只重写 `answer`，解析里的字母仍指
 * **原库位置** ⇒ 换序后解析指到别的选项上（真机截图）。
 *
 * 处理（落库最后一跳，与标记替换同链、同一次调用）：
 *   - 有选项文本可证（字母在该组字母表内）→ 换成 `「选项文本」`
 *     （长文本截断复用 `displayText`，与标记替换同形态）；
 *   - **无凭据的字母原样保留**（超范围 E/F/G/H、无选项组的题、受保护区、
 *     所有格前缀、英文正文词——见 `protectionMask`/`LetterRefs`）。
 *
 * ⚠️ **与标记替换的关键差别**：标记是**显式意图**，数学/代码区内照常替换；
 * 裸字母是**猜测**，绝不能碰受保护区（`$x_A$`、`` `A` `` 里的 A 不是引用）。
 * 故这里先按保护区做掩码，命中在保护区内一律跳过。
 *
 * ⚠️ **现状兜底与存量无关**：存量解析里的字母由展示层洗牌时改写
 * （`CardDisplayShuffle` 同步 remap，见该模块），**不做迁移**；本道只堵
 * 新流量（三条落库链共用本函数）。
 */

/** 列表标记（`- ` / `1. `）+ 前导字母标签（`A. ` / `(A)` / `A、` …）——
 *  剥离器用 `types.optionDisplayMd`（组件注入，见 `OptGroups.OptStrip`）。 */
function stripForGroups(md: string): string {
    return optionDisplayMd(md);
}

/** 字母标签前缀：`B.` / `B、` / `B：` / `B)` / `(B)` / `（B）` + 空白
 *  （判据是「标签**之后**就是选项文本」——`Plan A. Smith` 这类英文正文里
 *  `A.` 后面不是选项文本，故不命中）。 */
const LABEL_AFTER = /^\s*(?:(?:[.、．:：)）][ \t]*)|(?:\([A-Ha-h]\)[ \t]*)|(?:（[A-Ha-h]）[ \t]*))/;

/** 字母词符命中「字母 + 紧随的选项全文」形态时，返回要**吃掉**的字符数
 *  （标签 + 选项文本；长选项按截断形态比——比原文长度会吞掉后面真实内容）；
 *  不是引用则返回 0。 */
function quotedLen(at: number, text: string, opts: string[]): number {
    const after = text.slice(at + 1); // 字母之后
    const label = LABEL_AFTER.exec(after);
    if (!label) return 0;
    const body = after.slice(label[0].length);
    let best = 0;
    for (const o of opts) {
        for (const head of [o, displayText(o)]) {
            if (head && body.startsWith(head) && head.length > best) best = head.length;
        }
    }
    if (best === 0) return 0;
    // 吃 **标签 + 全文 + 全文后的整段空白**（`A. 维护封建统治 错误` 里的
    // 「标签 + 全文 + 一个空格」一起走，输出才不会多出一格）
    const tail = body.slice(best);
    const space = /^[ \t]+/.exec(tail)?.[0].length ?? 0;
    return label[0].length + best + space;
}

/** 一个独立字母词符 → `「选项文本」`；「字母 + 全文」形态把标签与全文
 *  一并吃掉（避免「『文本』. 文本」叠影）。**无凭据一律原样**（宁可读起来
 *  突兀，也不静默改写/删字）。 */
export function normalizeBareRefs(text: string, opts: string[]): string {
    if (!text || opts.length === 0) return text;
    const mask = protectionMask(text);
    let out = "";
    let last = 0;
    let changed = false;
    for (const m of text.matchAll(LETTER_TOKEN)) {
        const at = m.index;
        if (!isRefLetter(text, at, mask)) continue;
        const i = LETTERS.indexOf(m[0]);
        const opt = i >= 0 ? opts[i] : undefined;
        if (!opt) continue; // 无凭据：原样
        const eaten = quotedLen(at, text, opts);
        const before = text.slice(0, at);
        // 「字母 + 全文」形态把**包着字母的开括号 / 标签前空白**一并吃掉
        // （`（B）加强思想教育` 与 `- B. 加强思想教育` 都收成 `「文本」`）；
        // 裸字母形态保留前导空白（原文如此）。
        const wrapper = eaten > 0 ? (OPEN_BEFORE.exec(before) ?? /[ \t]+$/.exec(before)) : null;
        out += text.slice(last, wrapper ? at - wrapper[0].length : at) + `「${display(opt)}」`;
        last = at + 1 + eaten;
        // 吃净全文后，正文与引用之间的空白也带走（`A. 甲 错误` → `「甲」错误`）
        if (eaten > 0) {
            const sp = /^[ \t]+/.exec(text.slice(last));
            if (sp) last += sp[0].length;
        }
        changed = true;
    }
    if (!changed) return text;
    return out + text.slice(last);
}

/** 一个草稿单元的解析/题干引用规范化（纯函数、返回新对象，无命中零开销）。 */
export function normalizeDraftOptionRefs(d: DraftUnit): DraftUnit {
    if (d.material) return d;
    const groups = collectOptionGroups(d, stripForGroups);
    if (groups.size === 0) return d;
    let hit = false;
    const parts = d.parts.map((p) => {
        const key = ctxGroupOf(p.name);
        if (key === null) return p;
        const opts = groups.get(key) ?? [];
        if (opts.length === 0) return p;
        const text = normalizeBareRefs(p.text, opts);
        if (text === p.text) return p;
        hit = true;
        return { ...p, text };
    });
    return hit ? { ...d, parts } : d;
}
