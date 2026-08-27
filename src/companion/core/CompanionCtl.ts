import { agentChatOnce } from "../../convert/service/AgentClient";
import type { WenguSession } from "../../quiz/service/HistoryStore";
import { buildQuizStats } from "../../stats/StatsService";
import type { WenguWordProgress } from "../../word/core/WordStore";
import { buildStats as buildWordStats } from "../../word/core/WordStore";
import { WenguExpr } from "../rules/Expressions";
import { probeExprImages } from "../rules/Images";
import { normalizePersona, pickLine, PERSONA_PROMPTS, type PersonaKey } from "../rules/Lines";
import {
    buildChatPrompt,
    buildExplainPrompt,
    buildReactPrompt,
    clampText,
    parseExprReply,
    type ChatTurn,
    type ExplainCtx,
    type SessionProfile,
    type UserProfile,
} from "../rules/Prompt";
import type { CompanionUi } from "./CompanionUi";

/**
 * 看板娘控制器：规则层（即时表情+兜底台词）+ AI 增强层（里程碑节点
 * 节流生成台词，失败静默保规则层）+ 聊天/错题讲解。
 *
 * AI 统一走 agentChatOnce（智能体一次性会话：独立 sessionID 天然
 * 并发，反应与聊天互不阻塞；每次仍可按学伴配置指定模型）。与文档
 * 转换（直答端点）无会话冲突；聊天层把内核错误气泡出来，反应层静默
 * 兜底规则台词。
 */

const REACT_TIMEOUT_MS = 30_000;
const CHAT_TIMEOUT_MS = 90_000;
/** AI 增强的最小间隔（丢策略：不排队）。 */
const ENRICH_MIN_GAP_MS = 45_000;
/** 用户级画像快照缓存时长。 */
const USER_TTL_MS = 5 * 60_000;
/** 久无事件的打盹提示。 */
const DOZE_AFTER_MS = 5 * 60_000;

/** 学习事件（index.ts 的构造帮手装配，控制器消费）。 */
export type CompanionEvent =
    | { kind: "quiz-answer"; ok: boolean; sec?: number; explain?: ExplainCtx }
    | { kind: "quiz-round-done"; answered: number; correct: number }
    | { kind: "word-grade"; grade: "no" | "fuzzy" | "know"; correct?: boolean; hardN: number; explain?: ExplainCtx }
    | { kind: "word-done"; hardN: number; total: number };

/** 一套学伴配置（设置里可建多套：语文老师/数学老师…，切换即时生效）。 */
export interface CompanionProfile {
    id: string;
    name: string;
    /** 自定义人设 prompt（空=按人设预设；仅影响 AI 口吻，表情协议锁定）。 */
    prompt: string;
    /** 形象图片目录（工作区相对路径；空=内置团子 SVG）。 */
    imageDir: string;
    /** AI 模型（空=智能体默认）。 */
    modelId: string;
}

/** 控制器依赖（插件 onload 注入；settings 是共享引用，开关即时生效）。 */
export interface CompanionDeps {
    i18n: Record<string, string>;
    settings: {
        companionEnabled?: boolean;
        companionPersona?: string;
        companionAi?: boolean;
        companionProfiles?: CompanionProfile[];
        /** 当前生效配置 id（空=内置团子）。 */
        companionActiveId?: string;
    };
    history?: { allSessions(): Promise<WenguSession[]> };
    word?: { get(): Promise<WenguWordProgress> };
}

/** 本地日期 key（今日会话过滤，与 stats 域同规则）。 */
function dayKeyOf(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export class CompanionCtl {
    /** i18n 取值（ChatPanel 经 ctl.t 使用）。 */
    readonly t: (key: string) => string;
    private ui?: CompanionUi;
    private greeted = false;
    private readonly session: SessionProfile = {
        answered: 0,
        correct: 0,
        wrongStreak: 0,
        rightStreak: 0,
        wordDone: 0,
        hardN: 0,
    };
    private lastWrong?: ExplainCtx;
    private lastEnrichAt = 0;
    private enrichBusy = false;
    private chatLog: ChatTurn[] = [];
    private userCache?: { at: number; p: UserProfile };
    private dozeTimer?: ReturnType<typeof setTimeout>;
    /** 已探测过形象图片的目录（变化时重探；清空目录=回内置 SVG）。 */
    private imgDir = "";

    constructor(private readonly d: CompanionDeps) {
        this.t = (key) => this.d.i18n[key] || key;
    }

    /** Svelte 侧创建 $state 深代理后挂上来（双宿主共享同一份）。 */
    acquireUi(make: () => CompanionUi): CompanionUi {
        this.ui ??= make();
        if (!this.greeted) {
            this.greeted = true;
            this.showLine(pickLine(this.persona(), "greet"), WenguExpr.Idle);
        }
        this.armDoze();
        this.loadImages();
        return this.ui;
    }

    enabled(): boolean {
        return this.d.settings.companionEnabled !== false;
    }

    private aiOn(): boolean {
        return this.enabled() && this.d.settings.companionAi !== false;
    }

    private persona(): PersonaKey {
        return normalizePersona(this.d.settings.companionPersona);
    }

    /** 当前生效的学伴配置（未选=内置团子，走人设预设/内置 SVG/默认模型）。 */
    activeProfile(): CompanionProfile | undefined {
        return (this.d.settings.companionProfiles ?? []).find((p) => p.id === this.d.settings.companionActiveId);
    }

    /** 学伴名（聊天头部显示；默认团子）。 */
    profileName(): string {
        return this.activeProfile()?.name.trim() || this.t("companionDefaultName");
    }

    /** AI 人设描述：当前配置的 prompt 优先，其次全局人设预设（表情枚举
     *  与输出协议由 Prompt 锁定，自定义 prompt 覆盖不了，保证解析不崩）。 */
    private personaDesc(): string {
        return this.activeProfile()?.prompt.trim() || PERSONA_PROMPTS[this.persona()];
    }

    /** 模型 id（当前配置优先；空=跟随智能体设置的默认模型）。 */
    private modelId(): string {
        return this.activeProfile()?.modelId || "";
    }

    /** 自定义形象图片探测（当前配置的目录；变化时重跑）。 */
    loadImages(): void {
        const dir = (this.activeProfile()?.imageDir ?? "").trim();
        if (dir === this.imgDir) return;
        this.imgDir = dir;
        const ui = this.ui;
        if (!ui) return;
        if (!dir) {
            ui.imgExpr = {};
            return;
        }
        void probeExprImages(dir).then((m) => {
            if (this.ui) this.ui.imgExpr = m;
        });
    }

    onEvent(e: CompanionEvent): void {
        if (!this.enabled()) return;
        this.armDoze();
        this.bumpSession(e);
        const r = this.rulesFor(e);
        this.showLine(r.line, r.expr);
        if (this.ui) this.ui.explainKind = this.lastWrong?.kind;
        if (e.kind === "quiz-round-done" || e.kind === "word-done") this.userCache = undefined;
        if (this.aiOn()) this.maybeEnrich(e);
    }

    private bumpSession(e: CompanionEvent): void {
        const s = this.session;
        if (e.kind === "quiz-answer") {
            s.answered++;
            if (e.ok) s.correct++;
            s.rightStreak = e.ok ? s.rightStreak + 1 : 0;
            s.wrongStreak = e.ok ? 0 : s.wrongStreak + 1;
            if (!e.ok && e.explain) this.lastWrong = e.explain;
        } else if (e.kind === "word-grade") {
            s.wordDone++;
            s.hardN = e.hardN;
            if (e.grade === "no" && e.explain) this.lastWrong = e.explain;
        }
    }

    /** 规则层：事件 → 表情 + 兜底台词（人设变体随机）。 */
    private rulesFor(e: CompanionEvent): { expr: WenguExpr; line: string } {
        const p = this.persona();
        const s = this.session;
        if (e.kind === "quiz-answer") {
            if (e.ok) {
                if (e.sec !== undefined && e.sec > 0 && e.sec <= 10)
                    return { expr: WenguExpr.Surprise, line: pickLine(p, "quiz-fast", undefined, undefined, e.sec) };
                if (s.rightStreak >= 3)
                    return { expr: WenguExpr.Proud, line: pickLine(p, "right-streak", s.rightStreak) };
                return { expr: WenguExpr.Happy, line: pickLine(p, "quiz-right") };
            }
            if (s.wrongStreak >= 3) return { expr: WenguExpr.Push, line: pickLine(p, "wrong-streak", s.wrongStreak) };
            return { expr: WenguExpr.Sad, line: pickLine(p, "quiz-wrong") };
        }
        if (e.kind === "word-grade") {
            if (e.grade === "know") return { expr: WenguExpr.Happy, line: pickLine(p, "word-know") };
            if (e.grade === "fuzzy") return { expr: WenguExpr.Think, line: pickLine(p, "word-fuzzy") };
            return { expr: WenguExpr.Sad, line: pickLine(p, "word-no") };
        }
        if (e.kind === "quiz-round-done")
            return { expr: WenguExpr.Cheer, line: pickLine(p, "round-done", e.answered, e.correct) };
        return { expr: WenguExpr.Proud, line: pickLine(p, "word-done", e.total) };
    }

    private showLine(line: string, expr: WenguExpr): void {
        const ui = this.ui;
        if (!ui || !line) return;
        ui.expr = expr;
        ui.line = line;
        ui.lineTs = Date.now();
    }

    private armDoze(): void {
        clearTimeout(this.dozeTimer);
        this.dozeTimer = setTimeout(() => {
            this.showLine(pickLine(this.persona(), "doze"), WenguExpr.Doze);
        }, DOZE_AFTER_MS);
    }

    /** AI 增强层：里程碑节点节流生成「表情+台词」，失败静默。 */
    private maybeEnrich(e: CompanionEvent): void {
        const notable =
            (e.kind === "quiz-answer" && (this.session.wrongStreak === 3 || this.session.rightStreak === 5)) ||
            e.kind === "quiz-round-done" ||
            e.kind === "word-done";
        if (!notable || this.enrichBusy) return;
        const now = Date.now();
        if (now - this.lastEnrichAt < ENRICH_MIN_GAP_MS) return;
        this.enrichBusy = true;
        this.lastEnrichAt = now;
        const desc = this.eventDesc(e);
        void (async () => {
            try {
                const u = await this.userProfile();
                const reply = await agentChatOnce(
                    buildReactPrompt(this.personaDesc(), desc, this.session, u),
                    this.modelId(),
                    REACT_TIMEOUT_MS
                );
                const r = parseExprReply(reply);
                if (r) this.showLine(r.line, r.expr);
            } catch (_) {
                // 静默：保留规则层台词（失败模式保守）
            } finally {
                this.enrichBusy = false;
            }
        })();
    }

    private eventDesc(e: CompanionEvent): string {
        if (e.kind === "quiz-answer")
            return this.session.wrongStreak === 3
                ? `连错 ${this.session.wrongStreak} 题（刚又错了一道）`
                : `连对 ${this.session.rightStreak} 题（刚又秒对一道）`;
        if (e.kind === "quiz-round-done") return `完成一轮刷题：本轮答 ${e.answered} 题对 ${e.correct}`;
        if (e.kind === "word-grade") return `刚过完一个词（档位 ${e.grade}）`;
        return `背完一组单词：本次过 ${e.total} 个词，其中难词 ${e.hardN} 个`;
    }

    /** 用户级画像（5 分钟快照；轮完成/单词收工时失效）。 */
    async userProfile(): Promise<UserProfile> {
        const now = Date.now();
        if (this.userCache && now - this.userCache.at < USER_TTL_MS) return this.userCache.p;
        const sessions = (await this.d.history?.allSessions().catch((): WenguSession[] => [])) ?? [];
        const q = buildQuizStats(sessions, now);
        let todayAnswered = 0;
        let todayCorrect = 0;
        let todayMin = 0;
        const today = dayKeyOf(now);
        for (const s of sessions) {
            if (dayKeyOf(s.startedAt) !== today) continue;
            todayAnswered += s.answered;
            todayCorrect += s.correct;
            todayMin += s.elapsedSec / 60;
        }
        let wordStreak = 0;
        let wordLearned = 0;
        let wordTodayNew = 0;
        let wordTodayRev = 0;
        try {
            const w = this.d.word ? buildWordStats(await this.d.word.get(), now) : undefined;
            if (w) {
                wordStreak = w.streak;
                wordLearned = w.learned;
                wordTodayNew = w.todayNew;
                wordTodayRev = w.todayRev;
            }
        } catch (_) {
            // 单词存储读不到按 0 呈现
        }
        const p: UserProfile = {
            rounds: q.rounds,
            totalAnswered: q.answered,
            rate: q.rate,
            totalMin: q.totalSec / 60,
            streakDays: q.streak,
            todayAnswered,
            todayCorrect,
            todayMin,
            wordStreak,
            wordLearned,
            wordTodayNew,
            wordTodayRev,
        };
        this.userCache = { at: now, p };
        return p;
    }

    /** 聊天输入（ChatPanel 发送）。 */
    ask(text: string): void {
        const q = clampText(text, 300);
        const ui = this.ui;
        if (!q || !ui || ui.chatBusy) return;
        if (!this.aiOn()) {
            this.showLine(this.t("companionAiOff"), WenguExpr.Think);
            return;
        }
        this.pushMsg("user", q);
        ui.draft = "";
        void this.runChat((u) => buildChatPrompt(this.personaDesc(), this.session, u, this.chatLog, this.lastWrong, q));
    }

    /** 「讲讲这题/这个词」（ChatPanel chip；无错题上下文时不可达）。 */
    explain(): void {
        const ui = this.ui;
        const ctx = this.lastWrong;
        if (!ui || ui.chatBusy || !ctx) return;
        if (!this.aiOn()) {
            this.showLine(this.t("companionAiOff"), WenguExpr.Think);
            return;
        }
        this.pushMsg("user", this.t(ctx.kind === "word" ? "companionExplainWord" : "companionExplainQuiz"));
        void this.runChat((u) => buildExplainPrompt(this.personaDesc(), u, ctx));
    }

    private async runChat(build: (u: UserProfile) => string): Promise<void> {
        const ui = this.ui!;
        ui.chatBusy = true;
        try {
            const u = await this.userProfile();
            const reply = await agentChatOnce(build(u), this.modelId(), CHAT_TIMEOUT_MS);
            this.pushMsg("ai", clampText(reply, 400));
        } catch (err) {
            const why = err instanceof Error && err.message ? `：${err.message.slice(0, 80)}` : "";
            this.pushMsg("ai", `${this.t("companionAiFail")}${why}`);
        } finally {
            ui.chatBusy = false;
        }
    }

    private pushMsg(role: "user" | "ai", text: string): void {
        const ui = this.ui;
        if (!ui) return;
        ui.messages.push({ role, text });
        this.chatLog.push({ role, text });
        if (this.chatLog.length > 24) this.chatLog.splice(0, this.chatLog.length - 24);
    }
}
