import { EXPR_KEYS, normalizeExpr, WenguExpr } from "./Expressions";

/**
 * 看板娘的 prompt 组装与回复解析（纯函数，无 IO，单测覆盖）。
 *
 * 通道走智能体 agentChat（可按次指定模型）；回复协议沿用仓库约定
 * 「输出严格 N 行，格式之外不要输出任何文字」——反应类两条：
 * EXPRESSION: <枚举> / LINE: <台词>，解析失败由调用方落回规则层。
 */

/** 会话内实时画像（CompanionCtl 维护）。 */
export interface SessionProfile {
    /** 本次插件会话累计答题数/答对数（做题域）。 */
    answered: number;
    correct: number;
    wrongStreak: number;
    rightStreak: number;
    /** 本次过词数与当前难词数（单词域）。 */
    wordDone: number;
    hardN: number;
}

/** 用户级画像（stats 域聚合 + 今日过滤；5 分钟快照缓存）。 */
export interface UserProfile {
    rounds: number;
    totalAnswered: number;
    /** 0~1。 */
    rate: number;
    /** 累计刷题用时（分钟）。 */
    totalMin: number;
    /** 连续刷题天数。 */
    streakDays: number;
    todayAnswered: number;
    todayCorrect: number;
    todayMin: number;
    wordStreak: number;
    wordLearned: number;
    wordTodayNew: number;
    wordTodayRev: number;
}

/** 聊天历史轮（prompt 拼装用，内存保留最近若干轮）。 */
export interface ChatTurn {
    role: "user" | "ai";
    text: string;
}

/** 错题讲解上下文（答错时由事件帮手装配，「讲讲这题」消费）。 */
export interface ExplainCtx {
    kind: "quiz" | "word";
    /** 题干纯文本摘要（quiz）。 */
    stem?: string;
    submitted?: string;
    answer?: string;
    /** 词头 + 释义首行 + 误认词（word）。 */
    word?: string;
    meaning?: string;
    confused?: string;
}

/** 剥 md 记号的纯文本摘要（StatsService.plainText 同款规则的本地副本）。 */
export function plainOf(md: string, max: number): string {
    const s = md
        .replace(/\s+/g, " ")
        .replace(/[$*#`>|_~=]/g, "")
        .trim();
    return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 台词/回复限长（防爆字）。 */
export function clampText(s: string, max: number): string {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
}

function sessionBlock(s: SessionProfile): string {
    return `本轮动态：已答 ${s.answered} 对 ${s.correct}，连对 ${s.rightStreak}，连错 ${s.wrongStreak}；本次过词 ${s.wordDone} 个，难词 ${s.hardN} 个`;
}

function userBlock(u: UserProfile): string {
    const pct = Math.round(u.rate * 100);
    return `用户画像：累计刷题 ${u.rounds} 轮 ${u.totalAnswered} 题，正确率 ${pct}%，累计用时 ${Math.round(
        u.totalMin
    )} 分钟，连续刷题 ${u.streakDays} 天；今日答题 ${u.todayAnswered} 对 ${u.todayCorrect}、用时 ${Math.round(
        u.todayMin
    )} 分钟；累计背词 ${u.wordLearned} 个（连续 ${u.wordStreak} 天），今日新词 ${u.wordTodayNew} + 复习 ${u.wordTodayRev}`;
}

function roleLine(name: string, personaDesc: string): string {
    return `你是思源笔记插件「温故」里的桌面学伴「${name}」。人设：${personaDesc}。`;
}

/** 反应类 prompt：事件一句话 + 两层画像 → 表情枚举 + 一句台词。 */
export function buildReactPrompt(
    name: string,
    personaDesc: string,
    eventDesc: string,
    s: SessionProfile,
    u: UserProfile
): string {
    return `${roleLine(name, personaDesc)}
根据学习动态选一个表情并说一句话。表情只能从这些里选：${EXPR_KEYS.join("|")}。
${userBlock(u)}
${sessionBlock(s)}
事件：${eventDesc}
输出严格两行，格式之外不要输出任何文字：
EXPRESSION: <上面枚举之一>
LINE: <不超过30字，符合人设口吻>`;
}

/** 解析两行协议；EXPRESSION 认不出或缺行返回 undefined（调用方保底）。 */
export function parseExprReply(reply: string): { expr: WenguExpr; line: string } | undefined {
    const exprRaw = /^EXPRESSION:\s*(\S+)\s*$/m.exec(reply);
    const lineRaw = /^LINE:\s*(.+)$/m.exec(reply);
    if (!exprRaw || !lineRaw) return undefined;
    const expr = normalizeExpr(exprRaw[1]);
    if (!expr) return undefined;
    return { expr, line: clampText(lineRaw[1], 40) };
}

function explainBlock(e: ExplainCtx): string {
    if (e.kind === "word") {
        return `用户刚背错的词：${e.word ?? ""}${e.meaning ? `（释义：${e.meaning}）` : ""}${
            e.confused ? `；用户把它误认成了「${e.confused}」` : ""
        }`;
    }
    return `用户刚做错的题——题面：${e.stem ?? "（无题面）"}；用户的答案：${e.submitted ?? "（未作答）"}；正确答案：${e.answer ?? "（无）"}`;
}

/** 聊天 prompt：人设 + 两层画像 + 近期对话 + 可选错题上下文。 */
export function buildChatPrompt(
    name: string,
    personaDesc: string,
    s: SessionProfile,
    u: UserProfile,
    history: ChatTurn[],
    explain: ExplainCtx | undefined,
    userText: string
): string {
    const turns = history
        .slice(-12)
        .map((h) => (h.role === "user" ? `用户：${h.text}` : `${name}：${h.text}`))
        .join("\n");
    return `${roleLine(name, personaDesc)}
${userBlock(u)}
${sessionBlock(s)}
${explain ? explainBlock(explain) + "\n" : ""}最近对话：
${turns || "（无）"}
用户说：${userText}
要求：口语化中文回复，不超过120字，符合人设，不要列表、标题和 markdown，直接回答。`;
}

/** 讲解 prompt（「讲讲这题/这个词」按钮）：错在哪 + 正确思路 + 记忆点。 */
export function buildExplainPrompt(name: string, personaDesc: string, u: UserProfile, ctx: ExplainCtx): string {
    return `${roleLine(name, personaDesc)}
${userBlock(u)}
${explainBlock(ctx)}
请给用户讲解：这题（这个词）错在哪、正确的思路或辨析是什么、给一个好记的记忆点。口语化中文，不超过160字，不要列表和 markdown。`;
}
