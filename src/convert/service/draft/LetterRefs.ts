/**
 * 解析里**选项字母引用**的判定与改写（Issue #176，源出 #123 的成套件）。
 *
 * 这里是「哪些字母算选项引用」的**唯一口径**，两处调用方共用：
 *   - 落库层：`OptionRefReplace`（裸字母/「字母+全文」规范化）；
 *   - 展示层：`quiz/render/CardDisplayShuffle`（洗选项时同步重写引用）。
 * 各写一套正则必然漂移（#176 自验实录：一套认了 `Plan A`、另一套不认）。
 *
 * ## 判据（两个方向都是不变量，只放松任一侧就是回归）
 *
 * **一侧「不许漏」**——真机解析里的引用必须全部检出（`选项 A 正确`、
 * `A 正确`、`A. 全文`、`（B）加强思想教育`）；
 * **另一侧「不许误伤」**——正文里的同形字母一个都不能改。
 *
 * 1. **独立字母词符**：`(?<![A-Za-z])[A-H](?![A-Za-z])`——英文单词内的
 *    字母（`Plan` 的 `a`、`CAT`）天然不命中；
 * 2. **排除受保护区**：行内/围栏代码与数学（`$…$`/`$$…$$`/`\(…\)`/`\[…\]`）
 *    ——公式/代码里的 A 不是选项字母，改了就是静默毁内容；
 * 3. **排除所有格**（两侧）：前缀 `students' A` 与后缀 `A's plan`；
 * 4. **排除引用前缀**：`「` 后紧跟的字母，由 `remapQuotedHead` 单独处理；
 * 5. **排除英文正文里的「词 + 空格 + 大写字母」**（`Plan A`、`option B`）：
 *    前面的词是**纯 ASCII 单词**时该字母是正文的一部分，不是引用。
 *    真机解析是中文夹写（`选项 A 正确`、`A 正确`、`A. 全文`）——前缀为
 *    CJK/标点/行首，故这条只收英文语境，中文引用零误伤；
 * 6. **排除 CJK 融合词与字母数字型号**（`维生素A`、`A 型血`、`A4纸`、
 *    `B2B` 的 `B2`）：字母**前后紧贴**表意文字或数字时它是词的一部分。
 *    与第 5 条同理只收融合语境——`A 正确`（字母 + 空格）不受影响。
 */

/** 解析里**待检**的字母词符：A–H 单字母候选，两侧不是 ASCII 字母。
 *  ⚠️ 这是**粗筛**——`维生素A`、`A4纸` 也会命中，由 {@link isRefLetter}
 *  这个唯一判据否掉。`rewriteLetters` / `normalizeBareRefs` 都必须过它，
 *  别把粗筛当结论（各写一条近似正则正是 #176 的漂移来源）。 */
export const LETTER_TOKEN = /(?<![A-Za-z])[A-H](?![A-Za-z])/g;

/** 半角/全角开括号（`（B）` 形态：字母被括号包着，是同一层标签的另一种
 *  写法）。 */
export const OPEN_BEFORE = /[(（][ \t]*$/;

/** 所有格**前缀**（`students' A`）——词符整体跳过。 */
const POSSESSIVE_BEFORE = /[\u2019'][ \t]?$/;
/** 所有格**后缀**（`A's plan`）：字母紧跟撇号 + 可选 s，即英文所有格、
 *  不是选项引用。**不可省**——`LETTER_TOKEN` 的两侧只看 ASCII 字母，
 *  撇号不在排除面，原实现只挡前缀，`A's` 的 A 被当引用改写（#176 复核实录
 *  「R1」，展示层把 `A's plan works.` 改成 `D's plan works.`）。
 *  撇号收半角与 `’` 两种（AI 产物两种都见）。 */
const POSSESSIVE_AFTER = /^['\u2019](?:s\b)?/;
/** CJK 融合词前缀（`维生素A` / `A 型血` 的**前**字）：字母紧贴表意文字时
 *  它是词的一部分（「维生素A」「B 站」）。⚠️ 只挡**紧贴**——`A 正确`
 *  （字母 + 空格 + 汉字）照旧是引用，这正是 #176 的另一条不变量。 */
const WORD_BEFORE_CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]$/;
/** CJK 融合词后缀（`维生素A` 的**后**字）。 */
const WORD_AFTER_CJK = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
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

/** 字母数字型号**后缀**（`A4纸` 的 `4` / `C2 系统` 的 `2`）——后随数字时
 *  该字母是型号/编号的一部分，不是选项引用。原 `LETTER_TOKEN` 只挡 ASCII
 *  字母两侧，数字不在排除面（#176 复核实录「R3」）。
 *  ⚠️ **两侧都要挡**：`B2B` 的**第二个** B 是被数字**前导**的那个，只挡
 *  后缀会留下半个畸形（真机样本「B2B 业务」，20260919 自验实录）——
 *  「字母紧贴数字 ⇒ 在型号里」是关于**邻接**的判据，没有方向之分。 */
const DIGIT_BEFORE = /[0-9]$/;
const DIGIT_AFTER = /^[0-9]/;

/** 该位置的字母是否算**选项引用**（false ⇒ 一律不动）。
 *
 *  **两个方向都是不变量**：漏检（真机引用没改 → 洗牌后错误指代）与误伤
 *  （正文词被改 → 静默毁内容）各有红项锁着。改本函数必须两向都跑。 */
export function isRefLetter(text: string, at: number, mask: boolean[]): boolean {
    if (mask[at]) return false;
    const before = text.slice(0, at);
    const after = text.slice(at + 1);
    // `(A)` / `（A）` 形态是**标签**（`optionDisplayMd` 也认它），不是英文
    // 正文里的括号用法——照常当引用（#176 验收的「（B）加强思想教育」）；
    // 故 OPEN_BEFORE 不参与「是否引用」的判定，只影响「吃完形态」的裁剪。
    if (OPEN_BEFORE.test(before)) return true;
    // ⚠️ 顺序与覆盖都是判据的一部分，别按「看起来更严谨」重排：
    //   - 所有格（两侧）、引用前缀、英文正文词、CJK 融合词、数字型号
    //     任一条命中即不是引用；
    //   - **只挡紧贴相邻**的语境（`维生素A`），带分隔符的照旧算引用
    //     （`维生素 A 缺乏` / `A 正确`）——真机引用就是「字母 + 空格」形态。
    if (POSSESSIVE_AFTER.test(after)) return false;
    if (POSSESSIVE_BEFORE.test(before) || QUOTE_BEFORE.test(before) || WORD_BEFORE.test(before)) return false;
    if (DIGIT_AFTER.test(after) || DIGIT_BEFORE.test(before)) return false;
    return !WORD_BEFORE_CJK.test(before) && !WORD_AFTER_CJK.test(after);
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
