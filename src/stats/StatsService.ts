import type { WenguSession } from "../quiz/service/HistoryStore";
import type { WenguQuestion, WenguTimingMode } from "../types";

/**
 * 统计面板聚合层（纯函数，无 IO）：全局总览与单文档详情的数据模型。
 * 数据全部现成——会话历史（HistoryStore）+ 块属性（fullList/docs），
 * 零新增埋点；AI 学习建议的 prompt 也在这里组装。
 */

/** 近 N 轮趋势（总览与详情共用）。 */
export interface RoundTrendItem {
    /** 全局/文档内轮次序号（1 起）。 */
    n: number;
    answered: number;
    correct: number;
    /** 正确率 0~1。 */
    rate: number;
    /** 该轮开始时间。 */
    startedAt: number;
}

/** 全局总览统计。 */
export interface WenguQuizStats {
    rounds: number;
    answered: number;
    correct: number;
    rate: number;
    /** 累计刷题用时（秒）。 */
    totalSec: number;
    /** 连续刷题天数（今天没刷从昨天起算，不因未到晚上而断）。 */
    streak: number;
    /** 最近 20 轮（升序，趋势图用）。 */
    recent: RoundTrendItem[];
}

/** 错题条目（wrongCount>0 的题）。 */
export interface WenguWrongItem {
    qid: string;
    /** 题号（fullList 序号，1 起）。 */
    index: number;
    /** 题干摘要（剥 md 记号的纯文本）。 */
    stemSummary: string;
    knowledge?: string;
    wrongCount: number;
    lastAnswer?: string;
    /** 最近一次正误（0/1/未作答）。 */
    right?: "0" | "1";
}

/** 单文档详情统计。 */
export interface WenguDocStats {
    docTitle: string;
    /** 题目总数。 */
    total: number;
    /** 全部轮次（升序，评分记录与趋势图共用）。 */
    rounds: WenguSession[];
    /** 错题清单（按错次降序，上限 50）。 */
    wrongs: WenguWrongItem[];
    /** 错题总数（不截断——清单只展示前 50，总数原用 wrongs.length 把
     *  截断长度当总数展示，20260829 三轮审查）。 */
    wrongTotal: number;
}

const RECENT_ROUNDS = 20;
const WRONG_LIMIT = 50;

/** 本地日期 key（YYYY-MM-DD），streak 按日聚合用。 */
function dayKey(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function trendOf(sessions: WenguSession[], take: number): RoundTrendItem[] {
    return sessions.slice(-take).map((s, i) => ({
        n: sessions.length - Math.min(sessions.length, take) + i + 1,
        answered: s.answered,
        correct: s.correct,
        rate: s.answered > 0 ? s.correct / s.answered : 0,
        startedAt: s.startedAt,
    }));
}

/** 全局总览：全部会话一次遍历算齐。 */
export function buildQuizStats(sessions: WenguSession[], now = Date.now()): WenguQuizStats {
    const ordered = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
    let answered = 0;
    let correct = 0;
    let totalSec = 0;
    const days = new Set<string>();
    for (const s of ordered) {
        answered += s.answered;
        correct += s.correct;
        totalSec += s.elapsedSec;
        days.add(dayKey(s.startedAt));
    }
    // 连续刷题天数：从今天往回数；今天没刷则从昨天起算
    const keyOf = (offset: number) => dayKey(now - offset * 86400_000);
    let streak = 0;
    const start = days.has(keyOf(0)) ? 0 : 1;
    for (let i = start; i < 3660; i++) {
        if (days.has(keyOf(i))) streak++;
        else break;
    }
    return {
        rounds: ordered.length,
        answered,
        correct,
        rate: answered > 0 ? correct / answered : 0,
        totalSec,
        streak,
        recent: trendOf(ordered, RECENT_ROUNDS),
    };
}

/** 剥 md 记号的纯文本摘要（题干/作答展示用）。 */
function plainText(md: string, max: number): string {
    const s = md
        .replace(/\s+/g, " ")
        .replace(/[$*#`>|_~=]/g, "")
        .trim();
    return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** 单文档详情：轮次全量 + 错题清单（来自已 hydrate 的题目列表）。 */
export function buildDocStats(docTitle: string, sessions: WenguSession[], fullList: WenguQuestion[]): WenguDocStats {
    const rounds = [...sessions].sort((a, b) => a.startedAt - b.startedAt);
    const wrongAll = fullList
        .map((q, i) => ({ q, index: i + 1 }))
        .filter(({ q }) => q.wrongCount > 0)
        .sort((a, b) => b.q.wrongCount - a.q.wrongCount);
    const wrongs = wrongAll.slice(0, WRONG_LIMIT).map(({ q, index }) => ({
        qid: q.id,
        index,
        stemSummary: plainText(q.stemMd ?? "", 80),
        knowledge: q.knowledge,
        wrongCount: q.wrongCount,
        lastAnswer: q.lastAnswer ? plainText(q.lastAnswer, 40) : undefined,
        right: q.right,
    }));
    return { docTitle, total: fullList.length, rounds, wrongs, wrongTotal: wrongAll.length };
}

/** 计时方式的中文短名（prompt 与列表展示共用）。 */
function modeLabel(mode: WenguTimingMode): string {
    return mode === "countUp" ? "正计时" : mode === "countdown" ? "倒计时" : mode === "perQuestion" ? "逐题" : "不计时";
}

export { modeLabel };

/** AI 学习建议 prompt：文档轮次成绩 + 错题清单 → 趋势/薄弱点/建议。 */
export function buildStatsPrompt(s: WenguDocStats): string {
    const rounds = s.rounds
        .map(
            (r, i) =>
                `第${i + 1}轮 ${new Date(r.startedAt).toLocaleString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                })} ${r.correct}/${r.answered}(${r.answered > 0 ? Math.round((r.correct / r.answered) * 100) : 0}%) 用时${Math.round(
                    r.elapsedSec / 60
                )}分钟`
        )
        .join("；\n");
    const wrongs = s.wrongs
        .map(
            (w) =>
                `题${w.index}「${w.stemSummary}」${
                    w.knowledge ? `知识点:${w.knowledge} ` : ""
                }错${w.wrongCount}次 最近${w.right === "1" ? "已对" : "仍错"}`
        )
        .join("；\n");
    return `你是刷题统计助手。根据一份习题文档的历史刷题统计给出学习建议，不超过 300 字，分三段：总体趋势（正确率走势与用时变化）；薄弱点（从错题的知识点与错次归纳，没有错题就点评掌握度）；下一步建议（重刷策略、优先攻克的知识点）。
文档：《${s.docTitle}》共 ${s.total} 题，已刷 ${s.rounds.length} 轮
逐轮成绩：${rounds || "（暂无轮次）"}
错题清单：${wrongs || "（无错题）"}
只输出建议正文，不要客套。`;
}
