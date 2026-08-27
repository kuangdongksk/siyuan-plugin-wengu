import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card } from "ts-fsrs";
import {
    keyOf,
    markMistake,
    rollToday,
    todayKey,
    type WenguWordFsrs,
    type WenguWordProgress,
    type WordGrade,
} from "./WordStore";

/**
 * FSRS 调度封装（redesign §三，20260828 定稿）：ts-fsrs 默认参数起步，
 * 目标记忆率 0.9；enable_short_term=false——跳过分钟级 (re)learning 步，
 * 纯天级排期（本插件是日粒度会话，毕业即 1~3 天后首复）。
 *
 * 职责边界：新学滚动梯的步进**不进**这里（短期循环与长期排期解耦），
 * 只有「毕业初始化」「复习批改」「导入种子」三个入口会写 words 记录；
 * 逐词流水 reviews 同步记，为将来参数优化留料（优化器挂账）。
 */

/** 流水每词保留上限（优化器够用即可，防爆文件）。 */
const REVIEWS_CAP = 200;

const SCHED = fsrs(generatorParameters({ request_retention: 0.9, enable_short_term: false }));

/** 三档 → FSRS 评分（Easy 不用）。 */
export function ratingOf(grade: WordGrade): 1 | 2 | 3 {
    return grade === "know" ? Rating.Good : grade === "fuzzy" ? Rating.Hard : Rating.Again;
}

/** 存储态 → ts-fsrs 卡片（复习态重建；elapsed 由 lr-now 算）。 */
function cardOf(st: WenguWordFsrs, now: number): Card {
    return {
        due: new Date(st.due),
        stability: st.s,
        difficulty: st.d,
        elapsed_days: st.lr ? Math.floor((now - st.lr) / 86_400_000) : 0,
        scheduled_days: Math.max(1, Math.round(st.s)),
        learning_steps: 0,
        reps: st.r ?? 1,
        lapses: st.l ?? 0,
        state: State.Review,
        last_review: st.lr ? new Date(st.lr) : undefined,
    };
}

/** ts-fsrs 卡片 → 存储态（两位小数紧凑）。 */
function stateOf(c: Card): WenguWordFsrs {
    const r2 = (n: number): number => Math.round(n * 100) / 100;
    return {
        d: r2(c.difficulty),
        s: r2(c.stability),
        due: c.due.getTime(),
        lr: c.last_review?.getTime(),
        r: c.reps,
        l: c.lapses,
    };
}

function logReview(p: WenguWordProgress, key: string, rt: 1 | 2 | 3, dl: number, now: number): void {
    const arr = p.reviews[key] ?? [];
    arr.push({ ts: now, rt, dl });
    p.reviews[key] = arr.slice(-REVIEWS_CAP);
}

/** 计今日数 + 打卡（毕业/复习共用；先跨天翻转再计数，防隔夜首卡被清）。 */
function countInto(p: WenguWordProgress, isNew: boolean, now: number): void {
    rollToday(p, now);
    if (isNew) p.today.newCount++;
    else p.today.revCount++;
    p.log[todayKey(now)] = [p.today.newCount, p.today.revCount];
}

/** 复习批改（复习/星标/重过会话的每卡收口）：评分步进 FSRS 并记流水。 */
export function reviewWord(p: WenguWordProgress, index: number, grade: WordGrade, now = Date.now()): void {
    const key = keyOf(index);
    const rt = ratingOf(grade);
    const prev = p.words[key];
    const card = prev ? cardOf(prev, now) : createEmptyCard(now);
    const next = SCHED.repeat(card, now)[rt].card;
    p.words[key] = stateOf(next);
    logReview(p, key, rt, prev?.lr ? Math.round(((now - prev.lr) / 86_400_000) * 100) / 100 : 0, now);
    if (grade === "no") markMistake(p, index, now);
    countInto(p, false, now);
}

/** 滚动梯毕业（redesign §二.3→§三）：0 错→Good、错过→Hard、重来≥2→Again
 * 起步；同日计数按毕业算一次，ladder 项清除。 */
export function graduateWord(p: WenguWordProgress, index: number, errs: number, now = Date.now()): void {
    const key = keyOf(index);
    const rt: 1 | 2 | 3 = errs <= 0 ? Rating.Good : errs === 1 ? Rating.Hard : Rating.Again;
    p.words[key] = stateOf(SCHED.repeat(createEmptyCard(now), now)[rt].card);
    logReview(p, key, rt, 0, now);
    delete p.ladder[key];
    countInto(p, true, now);
}

/** 开词入窗（滚动梯「引入新词」）：ladder 记 [step,errs]（进度按词头
 * 共享，下一新词由书序扫描决定，v2 cursor 字段已废除）。 */
export function openWord(p: WenguWordProgress, index: number): void {
    const key = keyOf(index);
    if (!key) return;
    if (!p.ladder[key]) p.ladder[key] = [0, 0];
}

/** 进度导入种子（WordImport：中难度、给定稳定度与到期天数）。 */
export function seedWord(p: WenguWordProgress, index: number, s: number, dueDays: number, now = Date.now()): void {
    const key = keyOf(index);
    if (key) p.words[key] = { d: 5, s, due: now + dueDays * 86_400_000, r: 1, l: 0 };
}
