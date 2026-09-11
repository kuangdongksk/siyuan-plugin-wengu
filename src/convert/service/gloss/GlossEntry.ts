/**
 * 词条行保真（Issue #30）：英语原卷（考研真相形态）在正文里对「特殊词」
 * 做下划线+标号标记，并在段后给一行词条（词 + 音标 + 释义），如：
 *
 *     funding ^{补} ['fʌndɪŋ] n. 资金；基金；提供基金
 *
 * 现状是转换时 AI 把词条全剥掉，正文的 `^{补}`（kramdown 上标残渣）也被
 * 一并丢弃——阅读时看不到原卷的划线词与注释指向。本模块是这条链路的
 * **纯逻辑层**（无 DOM、无内核 IO，单测覆盖）：
 *
 *   1. 解析词条行（`@@G` 行协议，见 parseGlossLines）；
 *   2. 采集原文的 `^{...}` 记号（collectGlossMarks）；
 *   3. 按词形**精确匹配**算出正文词形的标号插入点（planGlossLinks）。
 *
 * 词表区的落库格式是**行协议式标记**（与 @@Q/@@P/@@END 生成协议同为
 * `@@` 前缀、互不冲突）：纯文本行、无 LaTeX 转义/冒号/井号雷区、
 * MdRender 可识别为普通段落、增量哈希（BankParse.questionHash）零影响
 * ——它只哈希题目记录的 kramdown，材料正文（bank.materials.bodyMd）不
 * 进指纹（docs/question-block-contract.md §七 材料格式段）。
 */

/** 词条行标记前缀（词表区每行一条）。 */
export const GLOSS_MARK = "@@G";

/** 词条行的落库语法：`@@G 词 | 音标 | 释义`（竖线分隔，三段可在后段缺省）。
 *  用竖线而非冒号，因释义里冒号/井号极常见（如 "n. 资金；基金"），
 *  竖线在词条内容里几乎不出现且无需转义。 */
export const GLOSS_SEP = "|";

/** 一个词条（词/音标/释义三段，缺段为空串）。 */
export interface GlossEntry {
    /** 词条词形（**逐字保真**，含 possessive `'s` 等）。 */
    word: string;
    /** 音标（含方括号/斜杠原样）。 */
    phonetic: string;
    /** 释义（内容不增不减不改写）。 */
    meaning: string;
}

/** 渲染词表区（材料正文尾部）：每行一条 `@@G 词 | 音标 | 释义`。
 *  空词条（无词形）跳过；词条内部换行折叠成空格（行协议一行一条）。 */
export function renderGlossBlock(entries: GlossEntry[]): string {
    const lines = entries
        .map((e) => ({ ...e, word: oneLine(e.word) }))
        .filter((e) => e.word)
        .map((e) => `${GLOSS_MARK} ${[e.word, oneLine(e.phonetic), oneLine(e.meaning)].join(` ${GLOSS_SEP} `)}`);
    return lines.join("\n");
}

/** 折叠换行/制表（行协议一行一条），并把裸竖线换成全角竖线（防段错位）。 */
function oneLine(s: string): string {
    return (s ?? "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\|/g, "｜")
        .trim();
}

/** 从材料正文尾部解析词表区：连续以 `@@G` 开头的行（允许被空行间隔）。
 *  词形必填（空则丢弃该行）；音标/释义缺省为空串。 */
export function parseGlossLines(bodyMd: string | undefined): GlossEntry[] {
    const out: GlossEntry[] = [];
    for (const raw of (bodyMd ?? "").split("\n")) {
        const line = raw.trim();
        if (!line.startsWith(GLOSS_MARK)) continue;
        const rest = line.slice(GLOSS_MARK.length).trim();
        if (!rest) continue;
        const seg = rest.split(GLOSS_SEP).map((s) => s.trim());
        const word = seg[0] ?? "";
        if (!word) continue;
        out.push({ word, phonetic: seg[1] ?? "", meaning: seg.slice(2).join(GLOSS_SEP).trim() });
    }
    return out;
}

/** 材料正文与其尾部词表区的拆分结果（正文=词表区之前的全部内容）。 */
export interface GlossSplit {
    /** 正文（不含词表行；词表行原位置留下的空行一并收拢）。 */
    body: string;
    /** 词表区词条（无词表时为空数组）。 */
    entries: GlossEntry[];
}

/**
 * 拆分「正文 + 尾部词表区」：词表行**从正文里摘掉**（它们不该以
 * `@@G` 形式出现在正文渲染里），正文行序与内容逐字保持。
 */
export function splitGlossBlock(bodyMd: string | undefined): GlossSplit {
    const src = bodyMd ?? "";
    if (!src.includes(GLOSS_MARK)) return { body: src, entries: [] };
    const kept: string[] = [];
    for (const raw of src.split("\n")) {
        if (raw.trim().startsWith(GLOSS_MARK)) continue;
        kept.push(raw);
    }
    return { body: collapseBlank(kept.join("\n")), entries: parseGlossLines(src) };
}

/** 连续空行折叠为单空行 + 去首尾空行（摘掉词表行后留下的空档）。 */
function collapseBlank(s: string): string {
    return s
        .replace(/\n{3,}/g, "\n\n")
        .replace(/^\n+/, "")
        .replace(/\n+$/, "");
}

/* ── 原文的 ^{...} 记号采集 ── */

/** kramdown/思源上标记法 `^{...}`（花括号形态；`^文字` 裸形态原卷未用，
 *  且易与数学指数混淆，只认花括号）——**含前导空白**，因为 mark 记号的
 *  归属判定要看它紧跟在哪个词后面。 */
const MARK_RE = /[ \t]*\^\{([^{}\n]*)\}/g;

/** `^{...}` 记号**之前**的那个词（含 possessive 撇号），取不到返回空串。 */
const PREV_WORD_RE = /([\p{L}\p{N}]+(?:['\u2019][\p{L}]+)*)[ \t]*$/u;

/** 行内代码围栏开关（``` / ~~~）。 */
const FENCE_RE = /^[ \t]*(```|~~~)/;

/** 一行的**数学/代码区间**：`^{...}` 落在这些位置的语义是 LaTeX 上标或
 *  代码字面量，**不是**词条记号——记号处理必须整体跳过（数学卷的
 *  `$x^{2}$` 被当记号剥掉就是公式静默丢指数）。区间允许相互重叠，
 *  调用侧只做「命中是否落在任一区间内」的判定。 */
function protectedSpans(line: string): [number, number][] {
    const spans: [number, number][] = [];
    for (const m of line.matchAll(/`[^`\n]*`/g)) spans.push([m.index, m.index + m[0].length]);
    let i = 0;
    while (i < line.length) {
        if (line[i] !== "$") {
            i++;
            continue;
        }
        const dbl = line[i + 1] === "$";
        const open = i + (dbl ? 2 : 1);
        let j = open;
        let close = -1;
        while (j < line.length) {
            if (line[j] === "\\") {
                j += 2;
                continue;
            }
            if (line[j] === "$" && (!dbl || line[j + 1] === "$")) {
                close = j;
                break;
            }
            j++;
        }
        if (close < 0) break; // 未闭合：本行余下按普通文本走（与 MdRender 同口径）
        const end = close + (dbl ? 2 : 1);
        spans.push([i, end]);
        i = end;
    }
    return spans;
}

/** 逐行扫 `^{...}` 命中：跳过代码围栏（多行态）与本行数学/代码区间。
 *  回调收到**全文字符串**里的区间（`[start, end)` 含前导空白、记号文本
 *  与所在行起点）。 */
function eachMark(text: string, cb: (start: number, end: number, mark: string, lineStart: number) => void): void {
    const src = text ?? "";
    let offset = 0;
    let fence = "";
    for (const line of src.split("\n")) {
        const fenceMark = FENCE_RE.exec(line)?.[1];
        if (fenceMark) {
            fence = fence ? "" : fenceMark; // 闭合围栏（只在同种围栏间配对）
            offset += line.length + 1;
            continue;
        }
        if (!fence) {
            const spans = protectedSpans(line);
            for (const m of line.matchAll(MARK_RE)) {
                const at = m.index;
                if (spans.some(([s, e]) => at >= s && at < e)) continue;
                cb(offset + at, offset + at + m[0].length, (m[1] ?? "").trim(), offset);
            }
        }
        offset += line.length + 1;
    }
}

/**
 * 采集原文里的 `^{...}` 记号：`word ^{mark}` 形态在英语卷里是**词后
 * 附注**——mark 修饰的是它前面那个词。返回「规范化词形 → 记号文本」
 * （同词多记号取首个）。数学/代码区间内的 `^{...}` 不采集（见
 * protectedSpans）。
 *
 * 正文渲染时记号并入该词的上标（`word²`），这样即使原文没给词条行，
 * 也不会以字面 `^{补}` 出现（验收第 3 条）。
 */
export function collectGlossMarks(text: string): Map<string, string> {
    const src = text ?? "";
    const out = new Map<string, string>();
    eachMark(src, (start, _end, mark, lineStart) => {
        // 只回看**同一行内、命中之前**的片段（跨行不误挂）
        const before = src.slice(lineStart, start).match(PREV_WORD_RE)?.[1] ?? "";
        const key = normWord(before);
        if (key && mark && !out.has(key)) out.set(key, mark);
    });
    return out;
}

/**
 * 剥掉正文里的 `^{...}`（正文进材料前先剥，渲染不再看到残渣）。
 * 连带它前面的空白一起吃掉，避免剥完留双空格；**数学/代码区间内的
 * `^{...}` 一律保留**（那是 LaTeX/代码语法，不是记号）。
 */
export function stripGlossMarks(text: string): string {
    const src = text ?? "";
    const ranges: [number, number][] = [];
    eachMark(src, (start, end) => ranges.push([start, end]));
    if (ranges.length === 0) return src;
    let out = "";
    let at = 0;
    for (const [s, e] of ranges) {
        out += src.slice(at, s);
        at = e;
    }
    return out + src.slice(at);
}

/**
 * 配对用的词形归一化：小写 + 去首尾标点（保留词内连字符/撇号）。
 * **汉字/假名等非 ASCII 实义字符一并保留**（记号里出现的中文「补」「同」
 * 是作者标注，也是合法键；只有纯标点/符号才算空）。
 */
export function normWord(raw: string): string {
    return (raw ?? "")
        .trim()
        .toLowerCase()
        .replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
}

/* ── 正文词形精确匹配 ── */

/** 一个词的词形候选（词条词形本身恒列首位）。 */
export function wordForms(entry: GlossEntry): string[] {
    const w = (entry.word ?? "").trim();
    return w ? [w] : [];
}

/** 正文里一处词形命中：字符区间 + 词表序号（1 起）。 */
export interface GlossHit {
    /** 正文里的起始偏移（含）。 */
    start: number;
    /** 结束偏移（不含）。 */
    end: number;
    /** 词表序号（1 起，上标展示用）。 */
    order: number;
    /** 命中文本（原样，用于复核）。 */
    text: string;
    /** 原文 `^{...}` 记号（有则并入上标，无则只出序号）。 */
    mark?: string;
}

/**
 * 正文词形**精确匹配**（宁缺勿错）：大小写不敏感、词边界对齐（前后不得
 * 再是字母/数字/撇号——`prefunding`/`fundinglike`/`funding's` 都不命中）、
 * possessive `'s` 含在词形内（词条词形带 `'s` 就整体命中）。**不做词干
 * 还原**——`fund` 不会被 `funding` 命中，屈折变形一律不高亮。
 *
 * 连字符**算词边界**（`funding-based` 里 `funding` 是独立词形，照命中；
 * 对比 `prefunding` 是另一个词，不命中）——英语复合词高频，把连字符也
 * 当阻断会造成大量漏标。
 *
 * 每词只取**首次**出现（`firstOnly`，逐词各自算首次，不是全段只标一处），
 * 词与词之间互不避让（重叠的命中由 DOM 包装顺序自然嵌套，强行切分反而
 * 易错）。返回按 start 升序排列。
 */
export function planGlossLinks(
    bodyMd: string,
    entries: GlossEntry[],
    firstOnly = true,
    marks?: Map<string, string>
): GlossHit[] {
    const text = bodyMd ?? "";
    if (!text || entries.length === 0) return [];
    const hits: GlossHit[] = [];
    for (let i = 0; i < entries.length; i++) {
        const forms = wordForms(entries[i]);
        if (forms.length === 0) continue;
        const hit = firstHitOf(text, forms, i + 1, firstOnly);
        if (hit) {
            const mark = marks?.get(normWord(forms[0]));
            hits.push(mark ? { ...hit, mark } : hit);
        }
    }
    hits.sort((a, b) => a.start - b.start);
    // 区间冲突（重叠命中）：保留先出现者，丢后者（防嵌套手术打乱 DOM）
    const out: GlossHit[] = [];
    for (const h of hits) {
        const prev = out[out.length - 1];
        if (prev && h.start < prev.end) continue;
        out.push(h);
    }
    return out;
}

/** 词边界收尾判据：前后字符不得是字母/数字/撇号——只堵「词内命中」的
 *  误伤（`prefunding` 里命中 `funding`、`fundinglike` 的前缀），连字符不算
 *  阻断（复合词 `funding-based` 照命中）。 */
function boundaryOk(before: string | undefined, after: string | undefined): boolean {
    if (before !== undefined && /[a-z0-9']/i.test(before)) return false;
    if (after !== undefined && /[a-z0-9']/i.test(after)) return false;
    return true;
}

/** 在正文里找某词形（大小写不敏感、词边界对齐）；返回首个命中区间。 */
function firstHitOf(text: string, forms: string[], order: number, firstOnly: boolean): GlossHit | undefined {
    const lower = text.toLowerCase();
    for (const form of forms) {
        const needle = form.toLowerCase();
        if (!needle) continue;
        let from = 0;
        for (;;) {
            const at = lower.indexOf(needle, from);
            if (at < 0) break;
            const end = at + needle.length;
            if (boundaryOk(at > 0 ? lower[at - 1] : undefined, end < lower.length ? lower[end] : undefined)) {
                return { start: at, end, order, text: text.slice(at, end) };
            }
            if (!firstOnly) break;
            from = at + 1;
        }
    }
    return undefined;
}

/**
 * 把「原始正文」预处理成材料正文：剥掉 `^{...}` 残渣 + 摘掉词表行
 * （词表另行 `renderGlossBlock` 追加）。**不删任何其它内容**。
 */
export function prepareGlossBody(rawMd: string): { body: string; entries: GlossEntry[]; marks: Map<string, string> } {
    const marks = collectGlossMarks(rawMd);
    const split = splitGlossBlock(rawMd);
    return { body: collapseBlank(stripGlossMarks(split.body)), entries: split.entries, marks };
}

/* ── 原卷形态解析（转换侧确定性预采集，不依赖 AI 抄写） ── */

/**
 * 原卷词条行的形态：`词 ^{记号} [音标] 释义`（考研真相/多数真题解析书）。
 * 音标段可选（方括号或斜杠），释义段可选。行首允许缩进/引用前缀，
 * 但**必须整行匹配**（否则会误吃正文句子）。
 */
const RAW_ENTRY_RE =
    /^[ \t>]*([A-Za-z][A-Za-z'-]*(?:[ \t]+[A-Za-z][A-Za-z'-]*)?)[ \t]*\^\{([^{}\n]+)\}[ \t]*(?:([\[/][^\]/\n]*[\]/]))?[ \t]*(.*)$/;

/** 原卷词条行的「释义段」判据：以词性缩写开头（n./v./adj./adv./prep.…
 *  或中文词性），或整段是中文——用来把「词 + 音标」与正文句子分开。 */
const MEANING_RE = /^(?:[a-z]{1,5}\.\s*|(?:名词|动词|形容词|副词|介词|连词|代词)\s*)/i;

/**
 * 解析原卷正文里的词条行（**确定性**，不经 AI）：命中返回词条，
 * 否则 undefined。判据三重收紧，防把正文句子当词条：
 *   1. 行首是 1~2 个英文词（词条词形，容许 `in particular` 这类短语）；
 *   2. 紧跟 `^{...}` 记号（原卷的划线标注）；
 *   3. 余下部分为空、或是音标/释义（词性标签开头或含中文）。
 */
export function parseRawEntryLine(line: string): GlossEntry | undefined {
    const m = RAW_ENTRY_RE.exec((line ?? "").replace(/[ \t]+$/, ""));
    if (!m) return undefined;
    const word = m[1].trim();
    const phonetic = (m[3] ?? "").trim();
    const rest = (m[4] ?? "").trim();
    if (!word) return undefined;
    // 释义段判据：空（只有词+音标）或词性/中文开头；否则视为正文句子
    if (rest && !MEANING_RE.test(rest) && !/[\u4e00-\u9fff]/.test(rest)) return undefined;
    return { word, phonetic, meaning: rest };
}

/** 词条的「置信」判据：带音标段、或释义段有词性标签（`n.`/`adj.`/`v.`…
 *  或中文词性词）。原卷词条行（考研真相形态）**恒有其中之一**；两条都没有
 *  的多半是正文/数学行被形态误判（如数学笔记里的 `a^{n} 表示 n 次幂`——
 *  词形+记号+纯中文释义，形态上与词条行无从区分）。
 *
 *  兜底采集只认置信词条（宁缺勿错）：错挂在数学/正文材料上的伪词条行是
 *  可见缺陷，漏一条无音标无词性的词条只是少一行。 */
const POS_IN_MEANING_RE = /(?:^|[;；,，、\s])(?:n|vt|vi|v|adj|adv|prep|conj|pron|num|art|int|aux|abbr|phr)\./i;
const POS_CN_RE = /^(?:名词|动词|形容词|副词|介词|连词|代词|数词|冠词|感叹词|短语|词组|缩写)/;

export function isConfidentEntry(e: GlossEntry): boolean {
    if ((e.phonetic ?? "").trim()) return true;
    const meaning = (e.meaning ?? "").trim();
    return POS_IN_MEANING_RE.test(meaning) || POS_CN_RE.test(meaning);
}

/** 从原文里抽出全部词条行（逐行扫，保持出现序；同一词形去重取首条）。 */
export function extractRawEntries(md: string): GlossEntry[] {
    const out: GlossEntry[] = [];
    const seen = new Set<string>();
    for (const line of (md ?? "").split("\n")) {
        const e = parseRawEntryLine(line);
        if (!e) continue;
        const key = normWord(e.word);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(e);
    }
    return out;
}

/** 原文里是否含**置信**词条行：判据与 GlossFold 的兜底采集同口径
 *  （数学习题里 `a^{n} 表示 n 次幂` 这类伪词条不算数），供调用方在拼
 *  prompt / 走词条链之前先判「这份源文值不值得做词条处理」。*/
export function hasRawEntries(md: string): boolean {
    return extractRawEntries(md).some(isConfidentEntry);
}
