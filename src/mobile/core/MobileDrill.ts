import type { WenguQuestion, WenguMaterial, WenguDoc } from "../../types";
import { QuestionType, baseQid } from "../../types";
import type { QuestionBank } from "../../bank/data/QuestionBank";
import { type HistoryStore, type WenguSession, type WenguSessionResult } from "../../quiz/service/HistoryStore";
import { ensureSets, setDocsView, setMaterials, setQuestions } from "../../bank/data/BankSets";
import { mirrorResult } from "../../quiz/service/AnswerMirror";
import type { WeaknessStore } from "../../bank/data/WeaknessStore";
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
import { endNowPicked, goConfirmEndPicked, requestEnd as requestEndGuard } from "./MobileEndGuard";
import { answerKindOf } from "./MobileModel";
import {
    firstUnansweredIdx,
    restoreResumeFor as restoreResumeForIn,
    resumeRound as resumeRoundIn,
    retryWrongRound as retryWrongRoundIn,
    startRound,
    type MobileResumeView,
} from "./MobileRound";
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
    /** 交卷确认弹层的第二态：「还有 N 题已选择未确认」（Issue #164）。
     *  `null` = 未触发；两模式（即时/收卷）同口径。守卫在 `core/MobileEndGuard`。 */
    endPickedN: number | null;
    /** 材料面板展开（组题）。 */
    matOpen: boolean;
    /** 本轮会话（收卷后仍保留快照供报告）。 */
    session?: WenguSession;
    elapsedSec: number;
    /** 未完成轮（判据只看 endedAt；恢复路径以**本对象**为准，不再二次探测）。 */
    resume?: WenguSession;
    /** 恢复卡的展示料（题集标题 / 已答 / 本轮题数）——由 `MobileRound`
     *  的探测与恢复路径写入，组件只读（跨题集时分母才是对的）。 */
    resumeView?: MobileResumeView;
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
        endPickedN: null,
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
        await restoreResumeForIn(this);
    }

    /** 未完成轮的恢复探测（题集切换/回开刷面板/交卷后调用）：
     *  **扫全库取最近一条**未完成轮（Issue #167 A1/A1b，实现体在
     *  `core/MobileRound`）——只看激活题集会让「未完成轮不在首个题集」
     *  与「目标题集有更新的已收卷轮」两种常态探测不到。 */
    restoreResumeFor(): Promise<void> {
        return restoreResumeForIn(this);
    }

    /* ── 开刷 ── */

    /** 开刷（fresh）／恢复未完成轮（continue）：实现体在 `core/MobileRound`
     *  ——按面板选择裁剪题目、写 scopeIds 快照、建会话、洗牌、落点定位。
     *  ⚠️ 恢复路径以 `ui.resume` 携带的会话为准，**不二次探测**（边界 A）。 */
    start(progress: "fresh" | "continue"): void {
        if (!this.ui.home.activeSetId || this.ui.fullList.length === 0) return;
        startRound(this, progress);
    }

    /** 恢复卡点击（**异步**）：跨题集时先装载目标题集再恢复（Issue #167）。 */
    resumeRound(): Promise<void> {
        return resumeRoundIn(this);
    }

    /** 本轮卡片态初始化（按 list 起一组空白态，恢复时再回填作答态）。 */
    initRoundCards(): void {
        this.ui.cards = this.ui.list.map(() => initCardState());
        const s = this.ui.session;
        if (s) this.restoreCardsFromSession(s);
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

    /** 首道未作答题的下标（恢复落点，Issue #167 A3；纯逻辑在 MobileRound）。 */
    firstUnanswered(): number {
        return firstUnansweredIdx(this);
    }

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

    /** 收卷入口（即时模式恒可交；收卷模式给确认弹层；「已选未确认」给第二态
     *  弹层）。守卫与判据收口在 `core/MobileEndGuard`（#158 空轮静默关轮 +
     *  #164 已选未确认不静默丢弃），此处只做转发——移动端收卷入口**只有
     *  这一个**，别在别处再写一份空轮/选择态判定。 */
    requestEnd(): void {
        requestEndGuard(this);
    }

    /** 「去确认」：收起弹层并定位到第一道「已选未确认」的题。 */
    goConfirmEndPicked(): void {
        goConfirmEndPicked(this);
    }

    /** 「按当前已选交卷」：把这批已选按既有提交链补记后收卷出报告。 */
    endNowPicked(): Promise<void> {
        return endNowPicked(this);
    }

    cancelEnd(): void {
        this.ui.confirmEnd = false;
        this.ui.endPickedN = null;
    }

    /** 交卷：揭示全部已答（收卷模式）、结算会话、出报告。 */
    endRound(): void {
        const s = this.ui.session;
        if (!s) return;
        this.ui.confirmEnd = false;
        this.ui.endPickedN = null;
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

    /** 报告屏「错题再练一轮」：以本轮错题为范围开新轮（实现在 MobileRound）。 */
    retryWrong(): void {
        retryWrongRoundIn(this);
    }

    /** 回开刷面板（报告屏「返回题集」）。 */
    backHome(): void {
        this.ui.screen = "home";
        this.stopTicker();
        this.ui.drawer = false;
        this.ui.matOpen = false;
        this.ui.confirmEnd = false;
        this.ui.endPickedN = null;
        void this.selectSet(this.ui.home.activeSetId, { silent: true }).catch((): void => undefined);
    }

    /** 作答浏览（报告屏点错题行回看原题）。 */
    openQuestion(idx: number): void {
        this.ui.screen = "drill";
        this.goto(idx);
    }

    /* ── 计时 ── */

    /** 起走秒（`MobileRound` 开新轮也用，故 public——口径不变）。 */
    startTicker(): void {
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

    /** 停走秒（关轮/回面板/销毁都走它，`MobileRound` 也用）。 */
    stopTicker(): void {
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

/** 空白卡态（`MobileRound` 开新轮也用，故导出）。 */
export function initCardState(): MobileCardState {
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
export type { MobileResumeView };
