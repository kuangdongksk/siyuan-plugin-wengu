import { Menu } from "siyuan";
import { agentChatOnce } from "../../ai/client";
import { AI_TIMEOUT } from "../../ai/timeouts";
import type { WenguSession } from "../../quiz/service/HistoryStore";
import { buildQuizStats } from "../../stats/StatsService";
import type { WenguWordProgress } from "../../word/core/WordStore";
import { buildStats as buildWordStats } from "../../word/core/WordStore";
import { WenguExpr } from "../rules/Expressions";
import { enrichGapMs, PACE_WINDOW } from "../rules/Enrich";
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
import { CHAT_MAX_TURNS, ChatStore, DEFAULT_CHAT_KEY } from "./ChatStore";

/**
 * 看板娘控制器：规则层（即时表情+兜底台词）+ AI 增强层（答题事件
 * 按节奏自适应节流、批次完成必触发；失败静默保规则层）+ 聊天/错题讲解。
 *
 * AI 统一走 agentChatOnce（智能体一次性会话：独立 sessionID 天然
 * 并发，反应与聊天互不阻塞；每次仍可按学伴配置指定模型）。与文档
 * 转换（直答端点）无会话冲突；聊天层把内核错误气泡出来，反应层静默
 * 兜底规则台词。聊天历史按学伴分份持久（ChatStore → saveData
 * "companion-chat")，切换学伴即换历史，插件重载不丢上下文。
 */

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
    /** 形象图片目录（工作区相对路径；空=内置形象 SVG）。 */
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
        /** 当前生效配置 id（空=默认学伴）。 */
        companionActiveId?: string;
        /** 悬浮位置（px；undefined=默认右下角，拖动后落盘）。 */
        companionX?: number;
        companionY?: number;
        /** 设置落盘回调（插件 onload 注入在共享 settings 上，这里补类型）。 */
        save?: () => void;
    };
    history?: { allSessions(): Promise<WenguSession[]> };
    word?: { get(): Promise<WenguWordProgress> };
    /** 聊天历史持久化通道（缺省=内存态，不落盘）。 */
    chat?: {
        loadRaw(): Promise<unknown>;
        saveRaw(v: Record<string, ChatTurn[]>): Promise<unknown>;
    };
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
    /** 最近答题时间戳（节奏窗口：均值 → 做题事件的 AI 触发间隔）。 */
    private answerTs: number[] = [];
    private chatLog: ChatTurn[] = [];
    private readonly chats: ChatStore;
    /** 当前 chatLog 所属学伴 id（null=首次加载在途）。 */
    private chatLoadedId: string | null = null;
    private chatSeq = 0;
    private userCache?: { at: number; p: UserProfile };
    private dozeTimer?: ReturnType<typeof setTimeout>;
    /** 已探测过形象图片的目录（变化时重探；清空目录=回内置 SVG）。 */
    private imgDir = "";

    constructor(private readonly d: CompanionDeps) {
        this.t = (key) => this.d.i18n[key] || key;
        this.chats = new ChatStore(
            this.d.chat?.loadRaw ?? (async (): Promise<undefined> => undefined),
            this.d.chat?.saveRaw ?? (async (): Promise<undefined> => undefined)
        );
        this.loadChatOf(this.chatId());
    }

    /** 聊天历史归属 key（当前学伴 id；默认学伴=固定 default）。 */
    private chatId(): string {
        return this.activeProfile()?.id ?? DEFAULT_CHAT_KEY;
    }

    /** 总开关镜像同步（settings 非响应，两处开关与右键关闭后调）。 */
    syncEnabled(): void {
        if (this.ui) this.ui.enabled = this.enabled();
    }

    /** 右键菜单「关闭」：关总开关（面板/设置弹窗的开关可重新打开）。 */
    hide(): void {
        this.d.settings.companionEnabled = false;
        this.d.settings.save?.();
        this.syncEnabled();
    }

    /** 悬浮位置（未拖过=undefined，组件用默认右下角）。 */
    figurePos(): { x: number; y: number } | undefined {
        const { companionX: x, companionY: y } = this.d.settings;
        return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
    }

    /** 拖动结束落盘团子左上角位置。拖拽中组件已按容器实际尺寸动态钳
     *  位，这里只做最小钳（团子 64 + 8px 边距不出界）——若再按固定余
     *  量钳，会与拖拽中看到的位置跳变。 */
    setFigurePos(x: number, y: number): void {
        const s = this.d.settings;
        s.companionX = Math.max(8, Math.min(x, window.innerWidth - 72));
        s.companionY = Math.max(8, Math.min(y, window.innerHeight - 72));
        s.save?.();
    }

    /** 挂件右键菜单（关闭学伴；重开走面板/设置开关）。 */
    openFigureMenu(x: number, y: number): void {
        const menu = new Menu("wengu-companion");
        menu.addItem({ icon: "iconClose", label: this.t("companionMenuHide"), click: () => this.hide() });
        menu.open({ x, y });
    }

    /** 换学伴历史（启动/切换）：清空待载；加载窗口内的新消息由回调合并。 */
    private loadChatOf(id: string): void {
        const seq = ++this.chatSeq;
        this.chatLoadedId = id;
        this.chatLog = [];
        void this.chats.turnsOf(id).then((turns) => {
            if (seq !== this.chatSeq || this.chatLoadedId !== id) return;
            this.chatLog = [...turns, ...this.chatLog].slice(-CHAT_MAX_TURNS);
            if (this.ui) this.ui.messages = this.chatLog.map((t) => ({ role: t.role, text: t.text }));
        });
    }

    /** 生效学伴变了（面板切换/新建/删除后经挂载编排调）：换历史重灌。 */
    reloadActive(): void {
        const id = this.chatId();
        if (id !== this.chatLoadedId) this.loadChatOf(id);
    }

    /** 学伴被删除：清其聊天残留。 */
    dropChat(id: string): void {
        this.chats.drop(id);
    }

    /** Svelte 侧创建 $state 深代理后挂上来（全局悬浮层唯一实例）。 */
    acquireUi(make: () => CompanionUi): CompanionUi {
        if (!this.ui) {
            this.ui = make();
            // 历史先于 UI 加载完成时补灌（加载在途则由 loadChatOf 回调覆盖）
            if (this.chatLog.length > 0) this.ui.messages = this.chatLog.map((t) => ({ role: t.role, text: t.text }));
            this.syncEnabled();
        }
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

    /** 当前生效的学伴配置（未选=默认学伴，走人设预设/内置 SVG/默认模型）。 */
    activeProfile(): CompanionProfile | undefined {
        return (this.d.settings.companionProfiles ?? []).find((p) => p.id === this.d.settings.companionActiveId);
    }

    /** 学伴名（聊天头部显示；默认学伴）。 */
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
            this.answerTs.push(Date.now());
            if (this.answerTs.length > PACE_WINDOW) this.answerTs.shift();
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
            this.dozeTimer = undefined;
            this.showLine(pickLine(this.persona(), "doze"), WenguExpr.Doze);
        }, DOZE_AFTER_MS);
    }

    /** 卸载收尾（插件 onunload）：清打盹定时器——卸载 5 分钟后仍向已
     * 卸组件的 ui 写台词虽无害，但属残留（20260829 三轮审查）。 */
    dispose(): void {
        clearTimeout(this.dozeTimer);
        this.dozeTimer = undefined;
    }

    /** AI 增强层：单题事件按节奏自适应节流、批次完成必触发，生成
     * 「表情+台词」，失败静默（丢策略：间隔内不排队，批次外不补发）。 */
    private maybeEnrich(e: CompanionEvent): void {
        const batchDone = e.kind === "quiz-round-done" || e.kind === "word-done";
        if (!(e.kind === "quiz-answer" || batchDone) || this.enrichBusy) return;
        if (!batchDone && Date.now() - this.lastEnrichAt < enrichGapMs(this.quizPaceMs())) return;
        this.enrichBusy = true;
        this.lastEnrichAt = Date.now();
        const desc = this.eventDesc(e);
        void (async () => {
            try {
                const u = await this.userProfile();
                const reply = await agentChatOnce(
                    buildReactPrompt(this.profileName(), this.personaDesc(), desc, this.session, u),
                    this.modelId(),
                    AI_TIMEOUT.react
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

    /** 平均答题间隔（节奏窗口相邻差均值；样本不足返回 undefined 按快节奏）。 */
    private quizPaceMs(): number | undefined {
        const ts = this.answerTs;
        if (ts.length < 2) return undefined;
        let sum = 0;
        for (let i = 1; i < ts.length; i++) sum += ts[i] - ts[i - 1];
        return sum / (ts.length - 1);
    }

    private eventDesc(e: CompanionEvent): string {
        if (e.kind === "quiz-answer") {
            if (!e.ok) {
                const st = this.session.wrongStreak;
                return st >= 2 ? `刚答错一道题，已连错 ${st} 题` : "刚答错一道题";
            }
            const sec = e.sec !== undefined && e.sec > 0 ? `，用时 ${Math.round(e.sec)} 秒` : "";
            const st = this.session.rightStreak;
            return `刚答对一道题${sec}${st >= 2 ? `，已连对 ${st} 题` : ""}`;
        }
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
        void this.runChat((u) =>
            buildChatPrompt(this.profileName(), this.personaDesc(), this.session, u, this.chatLog, this.lastWrong, q)
        );
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
        void this.runChat((u) => buildExplainPrompt(this.profileName(), this.personaDesc(), u, ctx));
    }

    private async runChat(build: (u: UserProfile) => string): Promise<void> {
        const ui = this.ui!;
        // 发起时捕获归属：AI 往返（秒级）期间切学伴，回复只落**原**学伴的
        // 历史与 UI——完成时才采样 chatId/chatLog 会把回复写进新学伴
        // （串扰+落错历史文件，20260828 审查）。loadChatOf 切换时换新
        // 数组，捕获的 log 引用即冻结为原学伴的写入面。
        const owner = { id: this.chatId(), log: this.chatLog };
        ui.chatBusy = true;
        try {
            const u = await this.userProfile();
            const reply = await agentChatOnce(build(u), this.modelId(), AI_TIMEOUT.chat);
            this.pushMsg("ai", clampText(reply, 400), owner);
        } catch (err) {
            const why = err instanceof Error && err.message ? `：${err.message.slice(0, 80)}` : "";
            this.pushMsg("ai", `${this.t("companionAiFail").replace("{name}", this.profileName())}${why}`, owner);
        } finally {
            ui.chatBusy = false;
        }
    }

    private pushMsg(role: "user" | "ai", text: string, owner?: { id: string; log: ChatTurn[] }): void {
        const ui = this.ui;
        if (!ui) return;
        const id = owner?.id ?? this.chatId();
        const log = owner?.log ?? this.chatLog;
        if (id === this.chatId()) {
            ui.messages.push({ role, text });
            if (ui.messages.length > CHAT_MAX_TURNS) ui.messages.splice(0, ui.messages.length - CHAT_MAX_TURNS);
        }
        log.push({ role, text });
        if (log.length > CHAT_MAX_TURNS) log.splice(0, log.length - CHAT_MAX_TURNS);
        this.chats.put(id, log);
    }
}
