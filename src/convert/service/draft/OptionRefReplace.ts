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

/** 长选项截断阈值（Issue #148 追加评论）：超过此长度的选项文本不再整句
 *  塞进解析——英语阅读题的选项是完整英文长句，全文替换会让解析行连占三
 *  行（真机截图）。
 *  ⚠️ 用 `Array.from` 数**码点**、不用 `str.length`：阈值是「观感字符数」
 *  口径，`"…".length === 1` 但 emoji/代理对与部分汉字扩展区算两码元，
 *  按 code unit 判会把 39 个字符的长句误判成超长（或反之）。 */
const LONG_OPT = 40;

/** 截断后保留的可见字符数（与阈值无关：**先判长、再截断**，截到 30 字
 *  + 省略号）。 */
const HEAD_KEEP = 30;

/** 选项文本的解析展示形态（Issue #148）：
 *  - 短选项（≤ {@link LONG_OPT} 码点）→ **全文**（政治题「维护封建统治」
 *    等原样，逐字节与改造前一致）；
 *  - 长选项（英语阅读整句）→ **截断 + 省略号**，形如
 *    「A proposal to establish…」——解析行可读优先。
 *  ⚠️ **不带字母提示**（不写「…（D）」）：字母是位置引用，会被展示层洗牌
 *  洗成**错误指代**（该模块不重写解析文本），也与「库内解析不含选项字母」
 *  的冻结口径冲突——详见模块头注释。 */
function displayText(text: string): string {
    const chars = Array.from(text);
    if (chars.length <= LONG_OPT) return text;
    return `${chars.slice(0, HEAD_KEEP).join("")}…`;
}

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

/** 把一处标记换成选项文本（长选项截断）；X 非法时降级为裸字母。 */
function replacement(ch: string, opts: string[]): string {
    const i = LETTERS.indexOf(ch.toUpperCase());
    const text = i >= 0 ? opts[i] : undefined;
    return text ? `「${displayText(text)}」` : ch.toUpperCase();
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
