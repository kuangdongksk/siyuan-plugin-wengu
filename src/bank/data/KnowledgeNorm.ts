/**
 * 知识点标签归一化（2026-08-31）：AI 出题裸写的 knowledge 文本措辞
 * 漂移——「洛必达」与「洛必达法则」本是同一考点，按精确字符串当聚合
 * 键就裂成两行。本模块把 knowledge 文本归一成**词干键**：四个聚合点
 * （QuestionBank.knowledgeIndex/collectQids/recordsByKeys +
 * WeaknessStore.weakKeys）统一走它，同一物理知识点无论被标成哪个
 * 措辞，聚合时都落到同一行。
 *
 * 设计原则：**只动聚合键、不动存储数据**。题库记录里的 knowledge
 * 原文照存（题卡角标/轮次报告仍显示 AI 原话「洛必达法则」），归一
 * 只发生在键生成这一瞬——weakKeys 是收卷计数的同步纯函数，词表
 * 方案（查知识文档小节标题）在这里不可用，词干归一无需外部输入。
 */

/** 去掉对聚合无意义的装饰：所有空白（含全角）、首尾书名号/引号/括号、
 *  尾部助词「的」。 */
function stripDecor(s: string): string {
    return s
        .trim()
        .replace(/[\s　]+/g, "")
        .replace(/^[《「『"'【\[（(]+|[》」』"'】\]）)]+$/g, "")
        .replace(/的$/, "");
}

/** 同义尾缀（**命名性**后缀）：X法则/X定理/X定律… 与裸 X 同族——
 *  「洛必达」与「洛必达法则」差的正是这层后缀，剥了还是同一考点。
 *  取舍：**宁可漏并、不可错并**——只收命名性后缀（前面接专名）；
 *  「计算/求法/方法/性质/概念」这类**动作/范畴**后缀不收（前面接的
 *  是考查对象，剥了会把「极限的计算」并成「极限」、把不同考点误并）。 */
const SUFFIXES = ["法则", "定理", "定律", "公式", "原理", "效应", "现象", "规则", "准则", "律"];

/** 剥掉一层可归并尾缀返回主体；无可剥尾缀（或剥了会掏空）返回原文。 */
function stemOf(s: string): string {
    for (const suf of SUFFIXES) {
        if (s.length > suf.length && s.endsWith(suf)) return s.slice(0, -suf.length);
    }
    return s;
}

/** knowledge 文本 → 聚合用词干键。空文本（纯装饰）返回空串（调用方
 *  按「无 knowledge」处理，不落 kn: 键）。 */
export function normalizeKnowledge(raw: string): string {
    const stripped = stripDecor(raw);
    if (!stripped) return "";
    const stem = stemOf(stripped);
    return stem || stripped;
}

/** kn: 聚合键（四处统一从这出；空词干返回空串=不落键）。 */
export function knKey(rawKnowledge: string): string {
    const stem = normalizeKnowledge(rawKnowledge);
    return stem ? `kn:${stem}` : "";
}

/** 同义簇里的**标准显示名**（20260831 用户定：用正式名不用短名）：
 *  归并把「洛必达」「洛必达法则」并进同键后，显示名取**信息最全的
 *  写法**（剥装饰后最长者——通常就是带后缀的正式名「洛必达法则」），
 *  并列取字典序小者（确定性）。candidates 是同簇的全部原文写法。 */
export function pickStandardName(candidates: string[]): string {
    let best = "";
    for (const raw of candidates) {
        const c = stripDecor(raw);
        if (!c) continue;
        if (!best || c.length > best.length || (c.length === best.length && c < best)) best = c;
    }
    return best;
}

/** 传入聚合键归一：kn: 键的词干化（新旧键都能与 knKey 产出对齐）；
 *  kp:/ch: 键原样透传。（BankRegen 的 recordsByKeys 同口径共用；
 *  20260903 从 QuestionBank 迁入压行数红线，语义不变） */
export function normKn(key: string): string {
    return key.startsWith("kn:") ? knKey(key.slice(3)) || key : key;
}
