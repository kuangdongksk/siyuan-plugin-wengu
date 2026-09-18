/**
 * 解析里**选项字母引用**的判定与改写（Issue #176，源出 #123 的成套件）。
 *
 * 这里是「哪些字母算选项引用」的**唯一口径**，两处调用方共用：
 *   - 落库层：`OptionRefReplace`（裸字母/「字母+全文」规范化）；
 *   - 展示层：`quiz/render/CardDisplayShuffle`（洗选项时同步重写引用）。
 * 各写一套正则必然漂移（#176 自验实录：一套认了 `Plan A`、另一套不认）。
 *
 * ## 判据
 * 1. **独立字母词符**：`(?<![A-Za-z])[A-H](?![A-Za-z])`——英文单词内的
 *    字母（`Plan` 的 `a`、`CAT`）天然不命中；
 * 2. **排除受保护区**：行内/围栏代码与数学（`$…$`/`$$…$$`/`\(…\)`/`\[…\]`）
 *    ——公式/代码里的 A 不是选项字母，改了就是静默毁内容；
 * 3. **排除所有格前缀**（`students' A`）与**引用前缀**（`「` 后紧跟的字母，
 *    由 `remapQuotedHead` 单独处理，避免二次映射）；
 * 4. **排除英文正文里的「词 + 空格 + 大写字母」**（`Plan A`、`option B`）：
 *    前面的词是**纯 ASCII 单词**时该字母是正文的一部分，不是引用。
 *    真机解析是中文夹写（`选项 A 正确`、`A 正确`、`A. 全文`）——前缀为
 *    CJK/标点/行首，故这条只收英文语境，中文引用零误伤。
 */

/** 解析里可安全改写的字母词符：独立 A–H 单字母。 */
export const LETTER_TOKEN = /(?<![A-Za-z])[A-H](?![A-Za-z])/g;

/** 半角/全角开括号（`（B）` 形态：字母被括号包着，是同一层标签的另一种
 *  写法）。 */
export const OPEN_BEFORE = /[(（][ \t]*$/;

/** 所有格前缀（`students' A`）——词符整体跳过。 */
const POSSESSIVE_BEFORE = /[\u2019'][ \t]?$/;
/** 引用前缀（`「` 后紧跟的字母）——由 `remapQuotedHead` 单独处理。 */
const QUOTE_BEFORE = /「$/;
/** 英文正文语境（`Plan A` / `option B` / `vitamin A`）——前导**纯 ASCII
 *  单词**时该字母不是引用。**中文前缀（CJK/标点/行首）不在此列**：真机
 *  解析就是「选项 A 正确」「A 正确」「A. 全文」这类形态。
 *  ⚠️ 尾随空白用 `[ \t]+`（不是单个）：原 `[ \t]$` 只认**一格**空格，
 *  `Plan  A works` 这类双空格排版就漏判、把正文里的字母当引用改掉
 *  （20260918 复核实录）。CJK 前缀仍不匹配 `[A-Za-z]` 开头，零误伤面变化。
 *  ⚠️ 「选项 A」不该被误伤：`选项` 是 CJK，不匹配；`option A` 是英文词，
 *  匹配 ⇒ 不动（正是所需）。 */
const WORD_BEFORE = /[A-Za-z][A-Za-z'\u2019-]*[ \t]+$/;

/** 需要排除改写的区间：行内代码、围栏代码、数学（$…$ / $$…$$ /
 *  \(…\) / \[…\]）——公式里的字母不是选项字母。 */
export function protectionMask(text: string): boolean[] {
    const n = text.length;
    const inMath = new Array<boolean>(n).fill(false);
    const spans: [number, number][] = [];
    const push = (re: RegExp, flags = "g"): void => {
        for (const m of text.matchAll(new RegExp(re.source, flags))) spans.push([m.index, m.index + m[0].length]);
    };
    push(/`[^`\n]*`/);
    push(/```[\s\S]*?```/);
    push(/\$\$[\s\S]*?\$\$/);
    push(/\$[^$\n]*\$/);
    push(/\\\([\s\S]*?\\\)/);
    push(/\\\[[\s\S]*?\\\]/);
    for (const [a, b] of spans) for (let i = a; i < b && i < n; i++) inMath[i] = true;
    return inMath;
}

/** 该位置的字母是否算**选项引用**（false ⇒ 一律不动）。 */
export function isRefLetter(text: string, at: number, mask: boolean[]): boolean {
    if (mask[at]) return false;
    const before = text.slice(0, at);
    // `(A)` / `（A）` 形态是**标签**（`optionDisplayMd` 也认它），不是英文
    // 正文里的括号用法——照常当引用（#176 验收的「（B）加强思想教育」）；
    // 故 OPEN_BEFORE 不参与「是否引用」的判定，只影响「吃完形态」的裁剪。
    if (OPEN_BEFORE.test(before)) return true;
    return !POSSESSIVE_BEFORE.test(before) && !QUOTE_BEFORE.test(before) && !WORD_BEFORE.test(before);
}

/** 按字母映射改写一段文本里的**引用字母**（其余原样；零改动返回原引用）。 */
export function rewriteLetters(text: string, map: (ch: string) => string): string {
    if (!text) return text;
    const mask = protectionMask(text);
    let out = "";
    let last = 0;
    let changed = false;
    for (const m of text.matchAll(LETTER_TOKEN)) {
        const at = m.index;
        // 跳过的命中必须**原样补回**（不参与映射），否则字符被吞
        const to = isRefLetter(text, at, mask) ? map(m[0]) : m[0];
        out += text.slice(last, at) + to;
        last = at + m[0].length;
        if (to !== m[0]) changed = true;
    }
    if (!changed) return text;
    return out + text.slice(last);
}

/** 旧序号 → 新序号的字母映射器（`toIdx`：原第 i 位的内容落到新第 j 位）。
 *  「字母确为该组真实选项」由调用方按组内长度先校验（超范围不映射）。 */
export function letterMapper(toIdx: Map<number, number>): (ch: string) => string {
    return (ch: string) => {
        const i = LETTERS_AB.indexOf(ch);
        const j = i >= 0 ? toIdx.get(i) : undefined;
        return j === undefined ? ch : (LETTERS_AB[j] ?? ch);
    };
}

/** 与 `types.LETTERS` 同表（本模块不反向依赖 types：那是 UI/判分层工具，
 *  convert 与 quiz 两侧都引它会出现循环）。 */
const LETTERS_AB = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
