import type { WenguQuestion, WenguMaterial, WenguDoc } from "../../types";
import { QuestionType, baseQid } from "../../types";
import type { QuestionBank } from "../../bank/data/QuestionBank";
import type { HistoryStore, WenguSession, WenguSessionResult } from "../../quiz/service/HistoryStore";
import { newSessionId } from "../../quiz/service/HistoryStore";
import { ensureSets, setDocsView, setMaterials, setQuestions } from "../../bank/data/BankSets";
import { mirrorResult } from "../../quiz/service/AnswerMirror";
import type { WeaknessStore } from "../../bank/data/WeaknessStore";
import { notifyInfo } from "../../ui/Notify";
import { errText } from "../../ui/shared";
import {
    applyVerdict,
    curOf,
    dunno,
    pickLetter,
    qOf,
    revealPlainFallback,
    selfAssess,
    setMine,
    skip,
    submit,
} from "./MobileAnswering";
import { answerKindOf } from "./MobileModel";
import { shuffleListForDisplay } from "../../quiz/render/CardDisplayShuffle";
import type { MobileDeps, MobileScreen, MobileSetup } from "../types";

/**
 * 移动端刷题编排（Issue #59）：dock 面板内的「仅刷题」流——
 * 选卷/开刷 → 作答 → 判分揭示 → 轮次报告。
 *
 * **与桌面 QuizView 的关系**：完全独立的挂载层。桌面 `openTab` 在移动端
 * 是空桩（见 AGENTS.md 移动端约定），刷题挂 dock；但**记账通道逐字复用**
 * ——会话走 `HistoryStore.pushSessionAnswer`（upsert 幂等）、题库走
 * `AnswerMirror`（首答 attempts+1、重复提交只覆写）、判分走
 * `gradeQuestion`/`judgeBrief`。终态语义与桌面同口径：
 * 即时判分（instant）= 判分即锁定；收卷统一（after）= 提交只记「已答」，
 * 交卷才揭示；「未完成轮」判据只看 `endedAt`。
 *
 * 状态只在本类里（组件持引用渲染），DOM 由 `components/MobileApp.svelte`
 * 的响应态产出——不做字符串渲染，也不复用桌面壳的整壳 innerHTML 管线。
 */

/** 作答态（组件渲染源）。 */
export interface MobileAnswerState {
    /** 已选字母（升序拼接，多选/单选）。 */
    letters: string;
    /** 判断题 √ / ×。 */
    judge: string;
    /** 文本作答（简答/填空）。 */
    mine: string;
}

/** 一题在移动端视图里的状态（作答 + 判分揭示）。 */
export interface MobileCardState extends MobileAnswerState {
    graded: boolean;
    locked: boolean;
    revealed: boolean;
    ok: boolean;
    /** 结果行文案（已判分/已答未揭示）。 */
    resultText: string;
    /** AI 评语（brief）。 */
    comment: string;
    /** 作答中（AI 判分在途）。 */
    busy: boolean;
    /** 自评/改判行开关。 */
    selfOn: boolean;
}

/** 装载态。 */
export interface MobileHomeState {
    loading: boolean;
    error: string;
    sets: WenguDoc[];
    activeSetId: string;
    activeSetTitle: string;
}

/**
 * 移动端刷题的**响应态包**（Svelte 5 深代理）。
 *
 * ⚠️ `$state` 只能在 Svelte 编译单元里创建（见 AGENTS.md 的 word 域先例）：
 * 本对象在 `MobileApp.svelte` 里 `$state(initialMobileUi())` 生成一份深代理，
 * 控制器与组件**同持该引用**——控制器就地改字段，组件模板读到哪行哪行
 * 细粒度更新。控制器若把状态摊成自己的普通字段，Svelte 5 不会追踪，
 * 界面全程不刷新（本项目 word 域踩过同款坑）。
 */
export interface MobileUi {
    screen: MobileScreen;
    home: MobileHomeState;
    setup: MobileSetup;
    /** 本轮题目（按本次题数裁剪后）。 */
    list: WenguQuestion[];
    materials: WenguMaterial[];
    /** 每题状态（与 list 同下标）。 */
    cards: MobileCardState[];
    qIdx: number;
    /** 题号抽屉开合。 */
    drawer: boolean;
    /** 交卷确认弹层。 */
    confirmEnd: boolean;
    /** 材料面板展开（组题）。 */
    matOpen: boolean;
    /** 本轮会话（收卷后仍保留快照供报告）。 */
    session?: WenguSession;
    elapsedSec: number;
    /** 未完成轮（判据只看 endedAt）。 */
    resume?: WenguSession;
    /** 题集全量题目（本次题数裁剪前的源）。 */
    fullList: WenguQuestion[];
}

/** 空白响应态（MobileApp.svelte 的 $state 初值）。 */
export function initialMobileUi(): MobileUi {
    return {
        screen: "home",
        home: { loading: true, error: "", sets: [], activeSetId: "", activeSetTitle: "" },
        setup: { reveal: "instant", timing: "countUp", count: 0 },
        list: [],
        materials: [],
        cards: [],
        qIdx: 0,
        drawer: false,
        confirmEnd: false,
        matOpen: false,
        elapsedSec: 0,
        fullList: [],
    };
}

export class MobileDrill {
    readonly t: (key: string) => string;
    /** 宿主依赖（public：作答友元模块 MobileAnswering 要读 bank/history）。 */
    readonly deps: MobileDeps;
    /** 响应态包（$state 深代理，由壳组件创建后注入）。 */
    readonly ui: MobileUi;

    /** 会话计时起点（秒粒度由 startedAt 推）。 */
    private tickTimer?: number;

    /** AI 模型 id（public：作答友元模块读）。 */
    readonly modelId: string;

    constructor(ui: MobileUi, deps: MobileDeps) {
        this.ui = ui;
        this.deps = deps;
        this.t = (key) => deps.i18n[key] || key;
        this.modelId = deps.settings?.convertModelId ?? "";
        this.ui.setup.reveal = deps.settings?.defaultReveal === "after" ? "after" : "instant";
        this.ui.setup.timing = deps.settings?.defaultTiming ?? "countUp";
    }

    /* ── 装载（dock 面板挂载时一次） ── */

    async load(): Promise<void> {
        this.ui.home.loading = true;
        this.ui.home.error = "";
        const bank = this.deps.bank;
        if (!bank) {
            this.ui.home.loading = false;
            this.ui.home.error = this.t("mobileNoBank");
            return;
        }
        try {
            await this.deps.weakness?.preload();
            await bank.preload();
            await ensureSets(bank);
            this.ui.home.sets = await setDocsView(bank);
            this.ui.home.activeSetId = this.pickSetId();
            await this.selectSet(this.ui.home.activeSetId, { silent: true });
        } catch (e) {
            this.ui.home.error = errText(e);
        } finally {
            this.ui.home.loading = false;
        }
    }

    /** 选中题集：题集清单首个（dock 面板每次挂载都重新装载）。 */
    private pickSetId(): string {
        return this.ui.home.sets[0]?.id ?? "";
    }

    /** 切题集：装题/材料 + 卷面标题 + 未完成轮探测。 */
    async selectSet(setId: string, opts: { silent?: boolean } = {}): Promise<void> {
        const bank = this.deps.bank;
        if (!bank) return;
        const doc = this.ui.home.sets.find((d) => d.id === setId);
        this.ui.home.activeSetId = setId;
        this.ui.home.activeSetTitle = doc?.title ?? setId;
        const all = setId ? await setQuestions(bank, setId) : [];
        this.ui.fullList = all;
        this.ui.materials = setId ? await setMaterials(bank, setId) : [];
        if (!opts.silent) this.ui.screen = "home";
        // 开刷面板的本次题数上限跟着题集走
        this.ui.setup.count = 0;
        // 未完成轮探测必须在题目装载**之后**（探测读的是新题集的会话；
        // 原写法在 selectSet 之前起，读到上一卷的记录）
        await this.restoreResumeFor();
    }

    /** 未完成轮的恢复探测（题集切换/回开刷面板后调用）。
     *  「未完成轮」判据**只看 endedAt**（Issue #12 口径）：after 模式答满
     *  但未交卷的轮必须仍能「继续上次」改答案——别再按「答满」判。 */
    private async restoreResumeFor(): Promise<void> {
        const docId = this.ui.home.activeSetId;
        const sessions = docId && this.deps.history ? await this.deps.history.docSessions(docId) : [];
        const last = sessions[sessions.length - 1];
        const answered = new Set((last?.results ?? []).map((r) => baseQid(r.qid))).size;
        this.ui.resume = last && !last.endedAt && answered > 0 ? last : undefined;
    }

    /* ── 开刷 ── */

    /** 开刷：按面板选择裁剪题目、建会话（或恢复未完成轮）。
     *
     *  **展示层选项洗牌**（Issue #131 P1，20260915 审查）：本题与桌面
     *  `QuizShell` 同口径——库/源文档是**死形态**（选项按原文顺序、答案
     *  字母指向原文位置），消剧透在展示层进卡前现洗。移动端**必须洗**：
     *  新造题按协议「正确项写最前」⇒ 不洗则正确项恒为首位，等于剧透
     *  （原稿「移动端不在本规范范围」的判断已作废）。
     *  洗的是 `shuffleListForDisplay` 出品的**新副本**：`ui.fullList`
     *  原件不动，题号栏/记账/`scopeIds` 全按 id 走（`ui.list` 与 cards
     *  同下标，副本不入库不回流）。 */
    start(progress: "fresh" | "continue"): void {
        const docId = this.ui.home.activeSetId;
        if (!docId || this.ui.fullList.length === 0) return;
        const last = this.ui.resume;
        // 判据与桌面 startRound 逐字同款：answered > 0 且未收卷
        const resuming = progress === "continue" && !!last;
        if (resuming && last) {
            this.ui.setup.reveal = last.revealMode === "after" ? "after" : "instant";
            this.ui.setup.timing = last.mode;
            const ids = new Set(last.scopeIds ?? []);
            // scope 传**该轮会话 id**（Issue #131 评审）：排列必须同轮恒定，
            // 否则恢复出来的字母指到别的选项上（口径见 CardDisplayShuffle 文件头）
            this.ui.list = shuffleListForDisplay(
                ids.size > 0 ? this.ui.fullList.filter((q) => ids.has(q.id)) : [...this.ui.fullList],
                { scope: last.id }
            );
            this.ui.session = last;
        } else {
            const src =
                this.ui.setup.count > 0 ? this.ui.fullList.slice(0, this.ui.setup.count) : [...this.ui.fullList];
            const sessionId = newSessionId(); // 会话 id 先铸：它同时是洗牌种子
            this.ui.list = shuffleListForDisplay(src, { scope: sessionId });
            this.ui.session = {
                id: sessionId,
                docId,
                startedAt: Date.now(),
                mode: this.ui.setup.timing,
                revealMode: this.ui.setup.reveal,
                stepsMode: "offline",
                scope: "all",
                elapsedSec: 0,
                answered: 0,
                correct: 0,
                results: [],
            };
        }
        this.ui.cards = this.ui.list.map(() => initCardState());
        if (resuming && last) this.restoreCardsFromSession(last);
        this.ui.qIdx = 0;
        this.ui.matOpen = false;
        this.ui.drawer = false;
        this.ui.confirmEnd = false;
        this.ui.screen = "drill";
        this.ui.elapsedSec = this.ui.session.elapsedSec;
        void this.deps.history?.upsert(this.ui.session);
        this.startTicker();
    }

    /* ── 作答（实现体在 core/MobileAnswering，函数式友元；此处只做转发） ── */

    get q(): WenguQuestion | undefined {
        return qOf(this);
    }

    get cur(): MobileCardState | undefined {
        return curOf(this);
    }

    readonly pickLetter = (letter: string): void => pickLetter(this, letter);
    readonly setMine = (text: string): void => setMine(this, text);
    readonly submit = (): Promise<void> => submit(this);
    readonly selfAssess = (correct: boolean): void => selfAssess(this, correct);
    readonly dunno = (): void => dunno(this);
    readonly skip = (): void => skip(this);

    /** 恢复卡态（继续上次）：与桌面 buildCardInit 同口径——收卷过才揭示。 */
    private restoreCardsFromSession(s: WenguSession): void {
        const byQid = resultsByQid(s);
        const revealNow = !!s.endedAt;
        const batch = s.revealMode === "after";
        this.ui.list.forEach((q, i) => {
            const r = byQid.get(q.id);
            if (!r) return;
            const ui = this.ui.cards[i];
            ui.graded = true;
            ui.locked = revealNow || !batch;
            ui.letters = q.type === QuestionType.Single || q.type === QuestionType.Multiple ? r.submitted : ui.letters;
            ui.judge = q.type === QuestionType.Judge ? r.submitted : ui.judge;
            ui.mine = ui.letters === "" && ui.judge === "" ? r.submitted : ui.mine;
            if (!revealNow) {
                ui.resultText = this.t("answeredPending");
                return;
            }
            applyVerdict(this, i, q, r.ok, r);
        });
        this.ui.elapsedSec = s.elapsedSec;
    }

    /* ── 导航 ── */

    goto(idx: number): void {
        if (idx < 0 || idx >= this.ui.list.length) return;
        this.ui.qIdx = idx;
        this.ui.matOpen = false;
        this.ui.drawer = false;
    }

    prev(): void {
        this.goto(this.ui.qIdx - 1);
    }

    next(): void {
        this.goto(this.ui.qIdx + 1);
    }

    toggleDrawer(): void {
        this.ui.drawer = !this.ui.drawer;
    }

    toggleMat(): void {
        this.ui.matOpen = !this.ui.matOpen;
    }

    /* ── 收卷 / 报告 ── */

    /** 收卷入口（即时模式恒可交；收卷模式给确认弹层）。 */
    requestEnd(): void {
        const s = this.ui.session;
        if (!s) return;
        if (s.answered <= 0) {
            notifyInfo({ key: "endRoundEmpty" });
            return;
        }
        if (this.ui.setup.reveal === "after") this.ui.confirmEnd = true;
        else this.endRound();
    }

    cancelEnd(): void {
        this.ui.confirmEnd = false;
    }

    /** 交卷：揭示全部已答（收卷模式）、结算会话、出报告。 */
    endRound(): void {
        const s = this.ui.session;
        if (!s) return;
        this.ui.confirmEnd = false;
        // 收卷模式的已答记账此前只在会话里，交卷时才补题库镜像
        if (this.ui.setup.reveal === "after") this.flushBatchMirror();
        for (let i = 0; i < this.ui.list.length; i++) {
            const ui = this.ui.cards[i];
            if (!ui?.graded) continue;
            const q = this.ui.list[i];
            const r = s.results.find((x) => baseQid(x.qid) === q.id);
            if (r) {
                applyVerdict(this, i, q, r.ok, r);
            } else if (answerKindOf(q) === "plain") {
                // 兜底题（无题型/无答案）在收卷前只记了「已答」、没记账也没
                // 揭示：与桌面 revealAll 同款——补齐揭示并露自评钮，否则交卷
                // 后这题既无答案也无自评入口（用户无法收口）。写入体在
                // MobileAnswering（揭示态只从那一处写）
                revealPlainFallback(this, i);
            }
            ui.locked = true;
        }
        s.endedAt = Date.now();
        s.elapsedSec = Math.max(s.elapsedSec, this.ui.elapsedSec);
        void this.deps.history?.upsert(s);
        this.stopTicker();
        this.ui.screen = "report";
    }

    /** 收卷模式的批量补记（重复提交只覆写，attnets 不重复）。 */
    private flushBatchMirror(): void {
        const s = this.ui.session;
        if (!s) return;
        for (const q of this.ui.list) {
            const r = s.results.find((x) => baseQid(x.qid) === q.id);
            if (!r) continue;
            mirrorResult(this.deps.bank, q.id, r.submitted, r.ok);
        }
    }

    /** 报告屏「错题再练一轮」：以本轮错题为范围开新轮。 */
    retryWrong(): void {
        const s = this.ui.session;
        if (!s) return;
        const wrong = new Set(s.results.filter((r) => !r.ok).map((r) => baseQid(r.qid)));
        if (wrong.size === 0) return;
        const subset = this.ui.list.filter((q) => wrong.has(q.id));
        // 错题再练是**新一轮**：同样现洗（洗的是新副本，作业见下）；scope
        // 传新会话 id ⇒ 换轮换排列（消剧透），同轮重进仍恒定
        const sessionId = newSessionId();
        this.ui.list = shuffleListForDisplay(subset, { scope: sessionId });
        this.ui.setup.reveal = "instant";
        this.ui.session = {
            id: sessionId,
            docId: this.ui.home.activeSetId,
            startedAt: Date.now(),
            mode: this.ui.setup.timing,
            revealMode: "instant",
            stepsMode: "offline",
            scope: "wrong",
            scopeIds: subset.map((q) => q.id),
            elapsedSec: 0,
            answered: 0,
            correct: 0,
            results: [],
        };
        this.ui.cards = subset.map(() => initCardState());
        this.ui.qIdx = 0;
        this.ui.confirmEnd = false;
        this.ui.drawer = false;
        this.ui.matOpen = false;
        this.ui.screen = "drill";
        this.ui.elapsedSec = 0;
        void this.deps.history?.upsert(this.ui.session);
        this.startTicker();
    }

    /** 回开刷面板（报告屏「返回题集」）。 */
    backHome(): void {
        this.ui.screen = "home";
        this.stopTicker();
        this.ui.drawer = false;
        this.ui.matOpen = false;
        this.ui.confirmEnd = false;
        void this.selectSet(this.ui.home.activeSetId, { silent: true }).catch((): void => undefined);
    }

    /** 作答浏览（报告屏点错题行回看原题）。 */
    openQuestion(idx: number): void {
        this.ui.screen = "drill";
        this.goto(idx);
    }

    /* ── 计时 ── */

    private startTicker(): void {
        this.stopTicker();
        // 无 window（单测/无 DOM 环境）不起走秒——秒数只在真机上有意义
        if (typeof window === "undefined") return;
        const base = this.ui.session?.elapsedSec ?? 0;
        const t0 = Date.now();
        this.tickTimer = window.setInterval(() => {
            this.ui.elapsedSec = base + Math.floor((Date.now() - t0) / 1000);
            const s = this.ui.session;
            if (s) s.elapsedSec = Math.max(s.elapsedSec, this.ui.elapsedSec);
        }, 1000);
    }

    private stopTicker(): void {
        if (this.tickTimer !== undefined && typeof window !== "undefined") {
            window.clearInterval(this.tickTimer);
        }
        this.tickTimer = undefined;
    }

    /** 答满去重标记（收卷模式的「可检查修改」提示只给一次）。 */
    allAnsweredNotified = false;

    /** 销毁（dock destroy 时调用）：停走秒并结算未落库会话。 */
    destroy(): void {
        this.stopTicker();
        const s = this.ui.session;
        if (s && !s.endedAt) {
            s.elapsedSec = Math.max(s.elapsedSec, this.ui.elapsedSec);
            void this.deps.history?.upsert(s);
        }
    }
}

/** 空白卡态。 */
function initCardState(): MobileCardState {
    return {
        letters: "",
        judge: "",
        mine: "",
        graded: false,
        locked: false,
        revealed: false,
        ok: false,
        resultText: "",
        comment: "",
        busy: false,
        selfOn: false,
    };
}

/** 会话结果按整题聚合（多步题记的是 qid#k）。 */
function resultsByQid(s: WenguSession): Map<string, WenguSessionResult> {
    const out = new Map<string, WenguSessionResult>();
    for (const r of s.results ?? []) {
        const base = baseQid(r.qid);
        if (!out.has(base) || !r.ok) out.set(base, r);
    }
    return out;
}

export type { QuestionBank, HistoryStore, WeaknessStore };
