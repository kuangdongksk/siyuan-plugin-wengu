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
 * 降级口径：X 非法（超出本题选项数 / 不是 A–H）→ 标记整体降级为**裸
 * 字母 X**（丢标记不丢信息，宁可读起来突兀也不静默删字）；数学环境
 * （`$…$`/`$$…$$`、行内/围栏代码）内的标记**照常替换**——标记即显式
 * 意图，与 gloss 域「`^{}` 必须避开数学区间」的取舍相反（那里花括号是
 * LaTeX 语法，这里只是我们自己的占位）。
 */

/** 选项引用标记：全角〔opt:X〕，X 单字母（大小写都认）。 */
const MARK_RE = /〔opt:([A-Za-z])〕/g;

/** 参与选项组的部件名（顶层 option 与 step-k option；cloze/match 的
 *  slot-opt 不参与——它们的答案在 slot-ans 里，AI 不会引用字母）。 */
const OPTION_PART = /^option|^step-\d+-option/;

/** 解析类部件（顶层 solution、逐步/逐空 solution）。 */
const SOLUTION_PART = /^(?:solution|.*-solution)$/;

/** 本题的**顶层**选项文本（按渲染序＝字母序）。 */
function topOptionTexts(d: DraftUnit): string[] {
    return d.parts.filter((p) => OPTION_PART.test(p.name)).map((p) => p.text.trim());
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
 *  说明，指代关系与解析同源）。
 *
 *  **返回新对象**（纯函数口径）：调用方是唯一落库出口 SetWriter，它拿到的
 *  draft 上游可能还有别的消费者（渐进呈现视图、AI 会话面板），原地改会让
 *  「替换前/后」两个视图打架。无标记时返回**原对象**（引用相等，零开销）。
 */
export function replaceDraftOptionRefs(d: DraftUnit): DraftUnit {
    if (d.material) return d; // 材料块无选项组
    const opts = topOptionTexts(d);
    if (opts.length === 0) return d;
    let hit = false;
    const parts = d.parts.map((p) => {
        if (!SOLUTION_PART.test(p.name) && p.name !== "stem") return p;
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
