import {
    Dialog,
    Lute,
    Protyle,
    ProtyleMethod,
} from "siyuan";
import type {App} from "siyuan";
import {convertDocToQuestions} from "./ConvertService";
import {
    HistoryStore,
    newSessionId,
} from "./HistoryStore";
import type {WenguSession} from "./HistoryStore";
import {
    addDocTotalTime,
    addWrongFlashcard,
    listQuestionDocs,
    listQuestions,
    optionIsRight,
    recordAttempt,
    recordAttemptResult,
    removeWrongFlashcard,
} from "./QuestionService";
import {
    AUTO_GRADE_TYPES,
    LETTERS,
    optionDisplayMd,
    QuestionType,
} from "./types";
import type {
    WenguDoc,
    WenguQuestion,
    WenguTimingMode,
} from "./types";

/** 插件数据（saveData）里记住的偏好。 */
interface WenguPrefs {
    docId?: string;
    sideCollapsed?: boolean;
    timingMode?: WenguTimingMode;
    countdownMin?: number;
}

/**
 * 温故刷题页签视图。
 *
 * 布局：左侧可收起的「文档目录」（习题文档按 hPath 分组，点击切换，
 * 收起状态持久）+ 右侧主区。主区头部：目录开关 / 刷新 / 文档下拉 /
 * AI 转习题 / 用时；正文为当前文档的题目卡片。
 *
 * 卡片内容用**内嵌只读 Protyle** 渲染整个题目容器块——公式/样式与
 * 文档完全一致；mine/answer/solution 子块用 CSS 隐藏（块 DOM 带
 * custom-plugin-wengu-part 属性），判分/自评后揭示答案与解析，
 * mine（我的答案块）不再需要也不展示。作答位：选择题字母 chip、
 * 判断 √/×、填空输入、简答多行。
 *
 * 计时：秒表累计当前会话用时，定期/作答/切换/销毁时累加到文档块
 * total-time 属性（总时间持久，可继续刷）。
 *
 * 答题闭环（docs/question-block-contract.md §四）：
 * 客观题自动判分写 attempts/wrong-count/last-answer/right；brief 自评；
 * 错题进 riff「温故错题」卡组，答对移出。
 */
export class QuizView {
    private readonly t: (key: string) => string;
    private readonly el: HTMLElement;
    private readonly app?: App;
    /** 偏好持久化（Plugin loadData/saveData）。 */
    private readonly storage?: {load: () => Promise<unknown>; save: (v: WenguPrefs) => Promise<unknown>;};
    /** 插件设置（共享对象引用，设置页开关即时生效）。 */
    private readonly settings?: {showNums: boolean;};
    /** N 刷会话历史。 */
    private readonly history?: HistoryStore;
    /** 当前刷题的习题文档 id。 */
    private docId: string;
    /** 顶栏点击时记录的活动文档 id（生成对话框默认值）。 */
    private activeDocId: string;
    /** 已生成习题文档列表（持久，来自 SQL 聚合）。 */
    private docs: WenguDoc[] = [];
    /** 目录是否收起（持久）。 */
    private sideCollapsed = false;
    /** 刚生成、索引未可见的习题文档（下拉/目录临时补位）。 */
    private pendingDoc: {id: string; title: string;} | undefined;
    private list: WenguQuestion[] = [];
    private loading = false;
    private converting = false;
    private loadError = "";
    /** 每张卡的 Protyle 实例（qid → protyle），重渲染前销毁。 */
    private readonly protyles = new Map<string, Protyle>();
    /** 挂载代数：destroyProtyles 时自增，让在途的异步挂载自动放弃。 */
    private mountGen = 0;
    /** 计时：未落库的会话秒数 与 文档累计秒数。 */
    private sessionSec = 0;
    private docTotalSec = 0;
    private timerInt: number | undefined;
    /** 本轮计时方式与倒计时状态；started=本轮是否已开刷（先选计时方式）。 */
    private timingMode: WenguTimingMode = "countUp";
    private countdownMin = 20;
    private countdownSec = 0;
    private timeUpNoted = false;
    private started = false;
    /** 当前轮（开刷时创建，切文档/销毁时收卷落库）。 */
    private session?: WenguSession;
    /** 当前文档的历史轮次（渲染「已刷 N 轮 · 最近/最佳」）。 */
    private rounds: WenguSession[] = [];

    constructor(
        element: HTMLElement,
        i18n: Record<string, string>,
        docId = "",
        app?: App,
        storage?: {load: () => Promise<unknown>; save: (v: WenguPrefs) => Promise<unknown>;},
        settings?: {showNums: boolean;},
        history?: HistoryStore,
    ) {
        this.el = element;
        this.t = (key) => i18n[key] || key;
        this.docId = docId;
        this.activeDocId = docId;
        this.app = app;
        this.storage = storage;
        this.settings = settings;
        this.history = history;
    }

    /** 设置页开关变更后由插件调用：立即按新设置重渲染。 */
    applySettings(): void {
        this.renderList();
    }

    /** 顶栏再次点击且页签已打开时：活动文档是习题文档才切换选中。 */
    setDoc(docId: string): void {
        if (!docId) return;
        this.activeDocId = docId;
        this.selectDoc(docId);
    }

    /** 首次渲染。 */
    render(): void {
        void this.load();
        this.startTimer();
    }

    /** 页签销毁：收卷落库、落库用时并释放 Protyle。 */
    destroy(): void {
        this.stopTimer();
        this.finishSession();
        void this.flushTime();
        this.destroyProtyles();
    }

    /** 切换刷题的习题文档（目录/下拉选择），记住选择并结算旧文档用时。 */
    private selectDoc(docId: string): void {
        if (!docId || docId === this.docId) return;
        this.flushTime();
        this.docId = docId;
        this.persistPrefs();
        void this.load();
    }

    private async restorePrefs(): Promise<WenguPrefs> {
        try {
            const data = await this.storage?.load() as WenguPrefs | "" | null | undefined;
            return data && typeof data === "object" ? data : {};
        } catch (_) {
            return {};
        }
    }

    private persistPrefs(): void {
        if (!this.storage) return;
        try {
            void this.storage.save({
                docId: this.docId,
                sideCollapsed: this.sideCollapsed,
                timingMode: this.timingMode,
                countdownMin: this.countdownMin,
            });
        } catch (_) {
            // 忽略存储失败
        }
    }

    // ── 一轮刷题（N 刷会话） ────────────────────────────────

    /** 当前轮收卷：记结束时间与用时快照后落库。 */
    private finishSession(): void {
        const s = this.session;
        if (!s) return;
        this.session = undefined;
        s.endedAt = Date.now();
        s.elapsedSec = Math.max(s.elapsedSec, this.sessionSec);
        void this.history?.upsert(s);
    }

    /** 逐题作答记入当前轮（判分/自评后调用）。 */
    private noteSessionAnswer(qid: string, submitted: string, ok: boolean): void {
        const s = this.session;
        if (!s) return;
        s.results.push({qid, submitted, ok});
        s.answered++;
        if (ok) s.correct++;
        s.elapsedSec = Math.max(s.elapsedSec, this.sessionSec);
        void this.history?.upsert(s);
    }

    /** 轮询直到习题文档进入 SQL 聚合结果（内核 attributes 索引有数秒延迟）。 */
    private async waitForDocInList(docId: string, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const docs = await listQuestionDocs();
            if (docs.some((d) => d.id === docId)) return true;
            if (Date.now() >= deadline) return false;
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }

    /**
     * 拉取已生成习题文档列表与选中文档的题目卡片。
     * 选中优先级：当前选中（仍存在）> 上次记住的选择 > 活动文档 > 第一个。
     */
    private async load(): Promise<void> {
        this.finishSession(); // 切文档/刷新/重开都视为上一轮结束
        this.loading = true;
        this.loadError = "";
        this.renderList();
        try {
            const prefs = await this.restorePrefs();
            this.sideCollapsed = !!prefs.sideCollapsed;
            const mode = prefs.timingMode;
            this.timingMode = mode === "countdown" || mode === "none" ? mode : "countUp";
            this.countdownMin = clampMinutes(prefs.countdownMin ?? 20);
            this.started = false;
            this.timeUpNoted = false;
            this.countdownSec = 0;
            this.docs = await listQuestionDocs();
            if (this.pendingDoc && this.docs.some((d) => d.id === this.pendingDoc.id)) {
                this.pendingDoc = undefined;
            } else if (this.pendingDoc) {
                this.docs.unshift({
                    id: this.pendingDoc.id,
                    title: this.pendingDoc.title,
                    hPath: "",
                    total: 0,
                    attempted: 0,
                    rightCount: 0,
                    totalTime: 0,
                });
            }
            if (this.docId && !this.docs.some((d) => d.id === this.docId)) {
                const remembered = prefs.docId ?? "";
                this.docId = remembered && this.docs.some((d) => d.id === remembered) ? remembered : "";
            }
            if (!this.docId && this.docs.length > 0) {
                this.docId = this.activeDocId && this.docs.some((d) => d.id === this.activeDocId) ?
                    this.activeDocId :
                    this.docs[0].id;
            }
            this.docTotalSec = this.docs.find((d) => d.id === this.docId)?.totalTime ?? 0;
            this.sessionSec = 0;
            this.list = this.docId ? await listQuestions(this.docId) : [];
            this.rounds = this.docId && this.history ? await this.history.docSessions(this.docId) : [];
        } catch (e) {
            this.list = [];
            this.loadError = String((e as Error)?.message ?? e);
        } finally {
            this.loading = false;
            this.renderList();
        }
    }

    // ── 计时 ────────────────────────────────────────────────

    private startTimer(): void {
        if (this.timerInt !== undefined) return;
        this.timerInt = window.setInterval(() => {
            // 未开刷（选计时方式中）或不计时不走秒
            if (!this.docId || !this.started || this.timingMode === "none") return;
            this.sessionSec++;
            if (this.session) this.session.elapsedSec = this.sessionSec;
            if (this.timingMode === "countdown" && this.countdownSec > 0) {
                this.countdownSec--;
                if (this.countdownSec === 0 && !this.timeUpNoted) {
                    this.timeUpNoted = true;
                    this.showStatus(this.t("timeUp"), "muted");
                }
            }
            this.updateTimerLabel();
            if (this.sessionSec % 15 === 0) void this.flushTime();
        }, 1000);
    }

    private stopTimer(): void {
        if (this.timerInt !== undefined) {
            window.clearInterval(this.timerInt);
            this.timerInt = undefined;
        }
    }

    /** 把会话用时累加到文档块 total-time 属性。 */
    private async flushTime(): Promise<void> {
        const id = this.docId;
        const add = this.sessionSec;
        if (!id || add <= 0) return;
        this.sessionSec = 0;
        this.docTotalSec += add;
        try {
            await addDocTotalTime(id, add);
        } catch (_) {
            // 尽力而为
        }
    }

    private updateTimerLabel(): void {
        const el = this.el.querySelector<HTMLElement>("[data-timer]");
        if (!el) return;
        if (this.timingMode === "none") {
            el.style.display = "none";
            return;
        }
        el.style.display = "";
        el.textContent = this.timingMode === "countdown" ?
            (this.countdownSec === 0 && this.timeUpNoted ?
                `⏱ ${this.t("timeUpShort")}` :
                `⏱ ${mmss(this.countdownSec)}`) :
            `⏱ ${mmss(this.docTotalSec + this.sessionSec)}`;
    }

    // ── 渲染 ────────────────────────────────────────────────

    private renderList(): void {
        this.el.classList.add("wengu-panel");
        // 整体兜底：渲染途中任何异常都落到错误态，绝不残留在「加载中」
        try {
            this.renderListInner();
        } catch (e) {
            this.destroyProtyles();
            this.el.innerHTML = `<div class="wengu-head">${this.renderHead()}</div>
    <div class="wengu-status wengu-status-err">${esc(this.t("loadFailed"))}${
                esc(String((e as Error)?.message ?? e))
            }</div>`;
            this.bindHead();
        }
    }

    private renderListInner(): void {
        this.destroyProtyles();
        const main = (body: string) =>
            `${this.renderSide()}<div class="wengu-main">
    <div class="wengu-head">${this.renderHead()}</div>
    ${body}
</div>`;
        if (this.loading) {
            this.el.innerHTML = main(`<div class="wengu-muted">${esc(this.t("loading"))}</div>`);
            this.bindAll();
            return;
        }
        if (this.loadError) {
            this.el.innerHTML = main(
                `<div class="wengu-status wengu-status-err">${esc(this.t("loadFailed"))}${esc(this.loadError)}</div>`,
            );
            this.bindAll();
            return;
        }
        // 单卡隔离：一题渲染坏了给占位卡，不拖垮整个列表
        const cards = this.list
            .map((q, i) => {
                try {
                    return this.renderCard(q, i);
                } catch (e) {
                    return `<div class="wengu-card"><div class="wengu-status wengu-status-err">${
                        esc(String((e as Error)?.message ?? e))
                    }</div></div>`;
                }
            })
            .join("");
        const doc = this.docs.find((d) => d.id === this.docId);
        const info = doc ?
            `<span class="wengu-muted">${
                esc(fmt(this.t("docTitleCount"), {
                    title: doc.title || doc.id,
                    n: String(doc.total || this.list.length),
                }))
            }</span>${
                doc.attempted > 0 ?
                    `<span class="wengu-muted">${
                        esc(fmt(this.t("docProgress"), {
                            a: String(doc.attempted),
                            r: String(doc.rightCount),
                            n: String(doc.total),
                        }))
                    }</span>` :
                    ""
            }` :
            "";
        // 历史轮次：已刷 N 轮 · 最近/最佳成绩（N 刷会话历史）
        const roundsInfo = (() => {
            if (this.rounds.length === 0) return "";
            const last = this.rounds[this.rounds.length - 1];
            const best = this.rounds.reduce(
                (m, s) =>
                    s.answered > 0 && s.correct / s.answered > (m.answered > 0 ? m.correct / m.answered : -1) ? s : m,
                last,
            );
            return `<span class="wengu-muted">${
                esc(fmt(this.t("drillRounds"), {n: String(this.rounds.length)}))
            }</span>` +
                `<span class="wengu-muted">${
                    esc(fmt(this.t("lastRound"), {
                        c: String(last.correct),
                        a: String(last.answered),
                    }))
                }</span>` +
                `<span class="wengu-muted">${
                    esc(fmt(this.t("bestRound"), {
                        c: String(best.correct),
                        a: String(best.answered),
                    }))
                }</span>`;
        })();
        // 开刷前先选计时方式：选完「开始刷题」才渲染卡片并走秒
        if (doc && this.list.length > 0 && !this.started) {
            this.el.innerHTML = main(`
    <div class="wengu-subhead">${info}${roundsInfo}</div>
    <div class="wengu-status" data-status hidden></div>
    ${this.renderStartPanel()}`);
            this.bindAll();
            this.updateTimerLabel();
            return;
        }
        // 左侧题号导航 + 右侧卡片列表（点击题号平滑滚动到对应卡片；设置可关）
        const showNums = this.settings?.showNums !== false;
        const nums = showNums && this.list.length > 0 ?
            `<nav class="wengu-nums" data-nums title="${esc(this.t("qnumsTitle"))}">${
                this.list.map((q, i) => `<button class="wengu-num${numState(q)}" data-num="${i + 1}">${i + 1}</button>`)
                    .join("")
            }</nav>` :
            "";
        this.el.innerHTML = main(`
    <div class="wengu-subhead">${info}${roundsInfo}</div>
    <div class="wengu-status" data-status hidden></div>
    ${
            !doc ?
                `<div class="wengu-muted">${esc(this.t("noExerciseDocs"))}</div>` :
                (this.list.length === 0 ?
                    `<div class="wengu-muted">${esc(this.t("quizNone"))}</div>` :
                    "")
        }
    <div class="wengu-body">${nums}<div class="wengu-card-list">${cards}</div></div>`);
        this.bindAll();
        void this.mountProtyles();
        this.updateTimerLabel();
    }

    /** 开刷面板：选计时方式（正计时/倒计时分钟数/不计时）+ 开始按钮。 */
    private renderStartPanel(): string {
        const radio = (value: WenguTimingMode, label: string, extra = "") =>
            `<label class="wengu-timing"><input type="radio" name="wengu-timing" value="${value}"${
                this.timingMode === value ? " checked" : ""
            }><span>${label}</span>${extra}</label>`;
        return `<div class="wengu-start">
  <div class="wengu-start-title">${esc(this.t("timingTitle"))}</div>
  ${radio("countUp", esc(this.t("timingCountUp")))}
  ${
            radio(
                "countdown",
                esc(this.t("timingCountdown")),
                ` <input class="b3-text-field wengu-min" type="number" data-min min="1" max="600" value="${this.countdownMin}"> <span>${
                    esc(this.t("timingMinutes"))
                }</span>`,
            )
        }
  ${radio("none", esc(this.t("timingNone")))}
  <div><button class="b3-button b3-button--text" data-act="start">${esc(this.t("startDrill"))}</button></div>
</div>`;
    }

    /** 「开始刷题」：按所选方式开新一轮，写会话历史并渲染卡片。 */
    private beginDrill(): void {
        const checked = this.el.querySelector<HTMLInputElement>("input[name='wengu-timing']:checked");
        const mode: WenguTimingMode = checked?.value === "countdown" || checked?.value === "none" ?
            checked.value :
            "countUp";
        const minInput = this.el.querySelector<HTMLInputElement>("[data-min]");
        this.countdownMin = clampMinutes(Number(minInput?.value));
        this.timingMode = mode;
        this.countdownSec = mode === "countdown" ? this.countdownMin * 60 : 0;
        this.timeUpNoted = false;
        this.started = true;
        this.persistPrefs();
        this.session = {
            id: newSessionId(),
            docId: this.docId,
            startedAt: Date.now(),
            mode,
            plannedSec: mode === "countdown" ? this.countdownMin * 60 : undefined,
            elapsedSec: 0,
            answered: 0,
            correct: 0,
            results: [],
        };
        void this.history?.upsert(this.session);
        this.renderList();
    }

    /** 头部一行：目录开关（收起时）+ 刷新 + AI 转习题 + 用时。 */
    private renderHead(): string {
        return `${this.renderSideToggle()}
      ${refreshBtn(this.t)}
      <button class="wengu-btn" data-act="convert">${esc(this.t("convertBtn"))}</button>
      <span class="wengu-timer" data-timer title="${esc(this.t("totalTimeHint"))}">⏱ 0:00</span>`;
    }

    /** 左侧文档目录（hPath 分组，可收起）。 */
    private renderSide(): string {
        const groups = new Map<string, WenguDoc[]>();
        for (const d of this.docs) {
            const seg = (d.hPath || "").split("/").filter(Boolean);
            seg.pop();
            const key = seg.length ? `/${seg.join("/")}` : "/";
            const arr = groups.get(key) ?? [];
            arr.push(d);
            groups.set(key, arr);
        }
        const items = [...groups.entries()]
            .map(([group, docs]) =>
                `<div class="wengu-side-group">
        <div class="wengu-side-label">${esc(group)}</div>${
                    docs.map((d) => {
                        const active = d.id === this.docId ? " wengu-side-active" : "";
                        const meta = [
                            fmt(this.t("exerciseCount"), {n: String(d.total)}),
                            d.attempted > 0 ? fmt(this.t("drilledCount"), {a: String(d.attempted)}) : "",
                            d.totalTime > 0 ? `⏱${mmss(d.totalTime)}` : "",
                        ].filter(Boolean).join(" · ");
                        return `<div class="wengu-side-item${active}" data-docid="${esc(d.id)}" title="${
                            esc(d.hPath || d.title)
                        }">
          <div class="wengu-side-title">${esc(d.title || d.id)}</div>
          <div class="wengu-side-meta">${esc(meta)}</div>
        </div>`;
                    }).join("")
                }</div>`
            )
            .join("");
        return `<div class="wengu-side${this.sideCollapsed ? " wengu-side-collapsed" : ""}" data-side>
      <div class="wengu-side-head">
        <span>${esc(this.t("sideTitle"))}</span>
        <button class="wengu-btn wengu-side-fold" data-act="side-fold" title="${esc(this.t("sideFold"))}">«</button>
      </div>
      <div class="wengu-side-body">${items || `<div class="wengu-muted">${esc(this.t("noExerciseDocs"))}</div>`}</div>
    </div>`;
    }

    private renderSideToggle(): string {
        if (!this.sideCollapsed) return "";
        return `<button class="wengu-btn" data-act="side-toggle" title="${esc(this.t("sideTitle"))}">»</button>`;
    }

    /** 一张题卡：头部元信息 + Protyle（题目内容）+ 作答位。 */
    private renderCard(q: WenguQuestion, idx: number): string {
        const objective = q.type !== undefined && AUTO_GRADE_TYPES.includes(q.type) && !!q.answer;
        return `<div class="wengu-card" data-qid="${esc(q.id)}" data-idx="${idx}">
      <div class="wengu-card-head">
        <span class="wengu-card-title">${esc(q.knowledge || q.chapter || String(idx + 1))}</span>
        ${q.type ? `<span class="wengu-badge">${esc(this.t(typeKey(q.type)))}</span>` : ""}
        ${!objective ? `<span class="wengu-badge">${esc(this.t("selfBadge"))}</span>` : ""}
        ${q.difficulty ? `<span class="wengu-meta">${"★".repeat(q.difficulty)}</span>` : ""}
        ${q.source ? `<span class="wengu-meta">${esc(q.source)}</span>` : ""}
        ${
            q.attempts > 0 ?
                `<span class="wengu-meta">${esc(fmt(this.t("attempts"), {n: String(q.attempts)}))}</span>` :
                ""
        }
        ${
            q.wrongCount > 0 ?
                `<span class="wengu-meta wengu-wrong-count">${
                    esc(fmt(this.t("wrongCount"), {n: String(q.wrongCount)}))
                }</span>` :
                ""
        }
      </div>
      <div class="wengu-qprotyle" data-qprotyle><span class="wengu-muted">…</span></div>
      ${this.renderAnswerArea(q)}
      <button class="wengu-btn" data-act="submit">${esc(this.t("submit"))}</button>
      <div class="wengu-result" data-result hidden></div>
      <div class="wengu-note" data-note hidden></div>
      <div class="wengu-self" data-self hidden>
        <span>${esc(this.t("selfAssess"))}</span>
        <button class="wengu-btn wengu-btn-success" data-act="self-right">${esc(this.t("selfRight"))}</button>
        <button class="wengu-btn wengu-btn-error" data-act="self-wrong">${esc(this.t("selfWrong"))}</button>
      </div>
    </div>`;
    }

    /** 作答位：选择题字母 chip / 判断按钮 / 填空输入 / 简答多行。 */
    private renderAnswerArea(q: WenguQuestion): string {
        if (isChoice(q)) {
            const chips = (q.optionMd ?? [])
                .map((_, i) =>
                    `<button class="wengu-chip" data-letter="${LETTERS[i] ?? ""}">${LETTERS[i] ?? ""}</button>`
                )
                .join("");
            return `<div class="wengu-chips">${chips}</div>`;
        }
        const ph = esc(this.t("inputPlaceholder"));
        if (q.type === QuestionType.Judge) {
            return `<div class="wengu-judge">
        <button class="wengu-btn" data-judge="√">${esc(this.t("judgeYes"))}</button>
        <button class="wengu-btn" data-judge="×">${esc(this.t("judgeNo"))}</button>
      </div>`;
        }
        if (q.type === QuestionType.Brief) {
            return `<textarea class="wengu-input" data-field="mine" rows="4" placeholder="${ph}"></textarea>`;
        }
        return `<input class="wengu-input" data-field="mine" placeholder="${ph}" />`;
    }

    // ── Protyle 挂载 ────────────────────────────────────────

    /**
     * 逐卡内嵌只读 Protyle 渲染整个题目块。
     * 必须串行：并发多个 getDoc 会触发内核请求互相挂起（真机踩坑，
     * 12 张卡全部超时降级）；失败退回 Lute HTML。
     */
    private async mountProtyles(): Promise<void> {
        if (!this.app) {
            this.fallbackRenderAll();
            return;
        }
        const gen = this.mountGen;
        for (const node of Array.from(this.el.querySelectorAll<HTMLElement>("[data-qprotyle]"))) {
            if (gen !== this.mountGen) return; // 重渲染已发生，放弃本轮
            const card = node.closest<HTMLElement>(".wengu-card");
            const q = this.list.find((x) => x.id === card?.dataset.qid);
            if (!q) continue;
            await this.mountOne(node, q, gen);
        }
    }

    private async mountOne(node: HTMLElement, q: WenguQuestion, gen: number): Promise<void> {
        try {
            const protyle = new Protyle(this.app, node, {
                blockId: q.id,
                mode: "wysiwyg",
                render: {title: false, gutter: false, scroll: false, breadcrumb: false},
            });
            this.protyles.set(q.id, protyle);
            const loaded = await waitForBlockNode(node, 8000);
            if (gen !== this.mountGen) {
                try {
                    protyle.destroy();
                } catch (_) {
                    // 忽略
                }
                return;
            }
            if (loaded) {
                protyle.disable();
                return;
            }
            try {
                protyle.destroy();
            } catch (_) {
                // 忽略
            }
            this.protyles.delete(q.id);
            node.innerHTML = this.fallbackHtml(q);
            renderMath(node);
        } catch (_) {
            node.innerHTML = this.fallbackHtml(q);
            renderMath(node);
        }
    }

    private fallbackRenderAll(): void {
        for (const node of this.el.querySelectorAll<HTMLElement>("[data-qprotyle]")) {
            const card = node.closest<HTMLElement>(".wengu-card");
            const q = this.list.find((x) => x.id === card?.dataset.qid);
            if (q) node.innerHTML = this.fallbackHtml(q);
        }
        renderMath(this.el);
    }

    /** Protyle 不可用时的降级渲染（题干+选项，选项去列表标记与字母标签）。 */
    private fallbackHtml(q: WenguQuestion): string {
        const parts: string[] = [];
        if (q.stemMd) parts.push(safeLute(q.stemMd));
        for (const md of q.optionMd ?? []) {
            parts.push(`<div class="wengu-option-fallback">${safeLute(optionDisplayMd(md))}</div>`);
        }
        return parts.join("");
    }

    private destroyProtyles(): void {
        this.mountGen++;
        for (const p of this.protyles.values()) {
            try {
                p.destroy();
            } catch (_) {
                // 忽略
            }
        }
        this.protyles.clear();
    }

    // ── 事件绑定 ────────────────────────────────────────────

    private bindAll(): void {
        this.bindHead();
        this.bindSide();
        this.bindNums();
        this.bindStart();
        this.bindCards();
    }

    private bindStart(): void {
        this.el.querySelector("[data-act='start']")?.addEventListener("click", () => this.beginDrill());
    }

    /** 题号导航：点击平滑滚到对应卡片；滚动时联动高亮当前题。 */
    private bindNums(): void {
        const nav = this.el.querySelector<HTMLElement>("[data-nums]");
        if (!nav) return;
        const setActive = (n: number) => {
            nav.querySelectorAll(".wengu-num").forEach((b) => {
                b.classList.toggle("wengu-num-active", Number((b as HTMLElement).dataset.num) === n);
            });
        };
        for (const btn of nav.querySelectorAll<HTMLElement>(".wengu-num")) {
            btn.addEventListener("click", () => {
                const n = Number(btn.dataset.num);
                const card = this.el.querySelector<HTMLElement>(`.wengu-card[data-idx="${n - 1}"]`);
                card?.scrollIntoView({behavior: "smooth", block: "start"});
                setActive(n);
            });
        }
        const scroller = this.el.querySelector<HTMLElement>(".wengu-main");
        if (!scroller) return;
        let pending = false;
        scroller.addEventListener("scroll", () => {
            if (pending) return;
            pending = true;
            window.requestAnimationFrame(() => {
                pending = false;
                const cards = Array.from(this.el.querySelectorAll<HTMLElement>(".wengu-card"));
                if (cards.length === 0) return;
                const top = scroller.getBoundingClientRect().top + 24;
                let best = 0;
                let bestDist = Infinity;
                cards.forEach((c, i) => {
                    const d = Math.abs(c.getBoundingClientRect().top - top);
                    if (d < bestDist) {
                        bestDist = d;
                        best = i;
                    }
                });
                setActive(best + 1);
            });
        }, {passive: true});
        setActive(1);
    }

    private bindHead(): void {
        this.bindRefresh();
        this.updateConvertBtn();
        this.el.querySelector("[data-act='convert']")?.addEventListener("click", () => this.openConvertDialog());
        this.el.querySelector("[data-act='side-toggle']")?.addEventListener("click", () => {
            this.sideCollapsed = false;
            this.persistPrefs();
            this.renderList();
        });
        this.el.querySelector("[data-act='side-fold']")?.addEventListener("click", () => {
            this.sideCollapsed = true;
            this.persistPrefs();
            this.renderList();
        });
    }

    private bindSide(): void {
        for (const node of this.el.querySelectorAll<HTMLElement>("[data-docid]")) {
            node.addEventListener("click", () => {
                this.selectDoc(node.dataset.docid ?? "");
            });
        }
    }

    private bindCards(): void {
        for (const node of this.el.querySelectorAll(".wengu-card")) {
            const card = node as HTMLElement;
            const q = this.list.find((x) => x.id === card.dataset.qid);
            if (!q) continue;
            if (isChoice(q)) {
                for (const chip of card.querySelectorAll<HTMLElement>(".wengu-chip")) {
                    chip.addEventListener("click", () => this.toggleChip(q, card, chip));
                }
            }
            for (const btn of card.querySelectorAll<HTMLElement>("[data-judge]")) {
                btn.addEventListener("click", () => {
                    card.querySelectorAll("[data-judge]").forEach((b) => b.classList.remove("wengu-selected"));
                    btn.classList.add("wengu-selected");
                    card.dataset.judge = btn.dataset.judge ?? "";
                });
            }
            card.querySelector("[data-act='submit']")?.addEventListener("click", () => void this.submit(q, card));
            card.querySelector("[data-act='self-right']")?.addEventListener(
                "click",
                () => void this.selfGrade(q, card, true),
            );
            card.querySelector("[data-act='self-wrong']")?.addEventListener(
                "click",
                () => void this.selfGrade(q, card, false),
            );
        }
    }

    /** 字母 chip 点选：单选互斥，多选可增删。 */
    private toggleChip(q: WenguQuestion, card: HTMLElement, chip: HTMLElement): void {
        if (card.dataset.graded === "1") return;
        if (q.type === QuestionType.Single) {
            card.querySelectorAll(".wengu-chip").forEach((c) => c.classList.remove("wengu-chip-selected"));
            chip.classList.add("wengu-chip-selected");
        } else {
            chip.classList.toggle("wengu-chip-selected");
        }
    }

    /** 从卡片 DOM 读出本次作答串（字母串 / √× / 文本）。 */
    private readSubmitted(q: WenguQuestion, card: HTMLElement): string {
        const field = card.querySelector<HTMLInputElement | HTMLTextAreaElement>("[data-field='mine']");
        if (field) return field.value.trim();
        if (q.type === QuestionType.Judge) return card.dataset.judge ?? "";
        if (isChoice(q)) {
            return [...card.querySelectorAll<HTMLElement>(".wengu-chip.wengu-chip-selected")]
                .map((c) => c.dataset.letter ?? "")
                .sort()
                .join("");
        }
        return "";
    }

    private async submit(q: WenguQuestion, card: HTMLElement): Promise<void> {
        if (card.dataset.graded === "1") return;
        const objective = q.type !== undefined && AUTO_GRADE_TYPES.includes(q.type) && !!q.answer;
        const submitted = this.readSubmitted(q, card);
        if (objective && !submitted) {
            this.showResult(card, esc(this.t("noAnswer")), false, true);
            return;
        }
        card.dataset.graded = "1";
        this.lockInputs(card);
        card.classList.add("wengu-graded");
        void this.flushTime();
        if (!objective) {
            // brief（或缺题型/答案属性的题）：不自动判分，揭示后自评
            card.querySelector("[data-self]")?.removeAttribute("hidden");
            return;
        }
        const ok = await recordAttempt(q, submitted);
        this.markChips(q, card, submitted);
        this.markNum(q, ok);
        this.noteSessionAnswer(q.id, submitted, ok);
        this.showResult(
            card,
            ok ?
                esc(this.t("correct")) :
                `${esc(this.t("wrong"))}${esc(this.t("answerLabel"))}${esc(q.answer ?? "")}`,
            ok,
        );
        void this.syncWrongDeck(q.id, ok);
    }

    /** brief 自评：对错由用户判定，同样记账。 */
    private async selfGrade(q: WenguQuestion, card: HTMLElement, correct: boolean): Promise<void> {
        const mine = this.readSubmitted(q, card);
        await recordAttemptResult(q.id, mine, correct);
        this.markNum(q, correct);
        this.noteSessionAnswer(q.id, mine, correct);
        card.querySelector("[data-self]")?.setAttribute("hidden", "");
        this.showResult(card, correct ? esc(this.t("correct")) : esc(this.t("wrong")), correct);
        void this.syncWrongDeck(q.id, correct);
    }

    /** 错题入「温故错题」卡组，答对移出；变更后给出提示。 */
    private async syncWrongDeck(blockId: string, correct: boolean): Promise<void> {
        const changed = correct ? await removeWrongFlashcard(blockId) : await addWrongFlashcard(blockId);
        if (!changed) return;
        const card = this.el.querySelector<HTMLElement>(`.wengu-card[data-qid="${blockId}"]`);
        if (card) this.showNote(card, correct ? this.t("removedFromWrongDeck") : this.t("addedToWrongDeck"));
    }

    /** 判分/自评后同步题号导航的对错标记。 */
    private markNum(q: WenguQuestion, ok: boolean): void {
        const n = this.list.indexOf(q) + 1;
        const btn = this.el.querySelector<HTMLElement>(`.wengu-num[data-num="${n}"]`);
        if (!btn) return;
        btn.classList.toggle("wengu-num-right", ok);
        btn.classList.toggle("wengu-num-wrong", !ok);
    }

    /** 判分后标记字母 chip：答案项描绿，误选项描红。 */
    private markChips(q: WenguQuestion, card: HTMLElement, submitted: string): void {
        if (!isChoice(q)) return;
        for (const chip of card.querySelectorAll<HTMLElement>(".wengu-chip")) {
            const idx = LETTERS.indexOf(chip.dataset.letter ?? "");
            if (idx < 0) continue;
            if (optionIsRight(q, idx)) {
                chip.classList.add("wengu-chip-right");
            } else if (submitted.includes(LETTERS[idx])) {
                chip.classList.add("wengu-chip-wrong");
            }
        }
    }

    private showResult(card: HTMLElement, html: string, ok: boolean, warn = false): void {
        const result = card.querySelector<HTMLElement>("[data-result]");
        if (!result) return;
        result.innerHTML = html;
        result.removeAttribute("hidden");
        result.classList.remove("wengu-right", "wengu-wrong", "wengu-muted");
        result.classList.add(warn ? "wengu-muted" : ok ? "wengu-right" : "wengu-wrong");
    }

    private showNote(card: HTMLElement, text: string): void {
        const note = card.querySelector<HTMLElement>("[data-note]");
        if (!note) return;
        note.textContent = text;
        note.removeAttribute("hidden");
    }

    /** 判分后锁定作答位（chip/输入靠 dataset.graded 拦截点击）。 */
    private lockInputs(card: HTMLElement): void {
        card.querySelectorAll("input, textarea, button[data-act='submit'], [data-judge], .wengu-chip")
            .forEach((n) => {
                (n as HTMLButtonElement).disabled = true;
            });
    }

    private bindRefresh(): void {
        const btn = this.el.querySelector("[data-act='refresh']");
        btn?.addEventListener("click", () => void this.load());
    }

    // ── AI 转习题对话框 ─────────────────────────────────────

    /** AI 转习题对话框：填文档 id（或 siyuan:// 链接），进度与结果都在框内展示。 */
    private openConvertDialog(): void {
        if (this.converting) return;
        const dialog = new Dialog({
            title: this.t("convertBtn"),
            width: "520px",
            content: `<div class="b3-dialog__content wengu-convert-dialog">
      <div class="wengu-muted">${esc(this.t("convertDialogHint"))}</div>
      <input class="b3-text-field fn__block" data-act="dlg-docid" spellcheck="false"
        placeholder="${esc(this.t("docIdPlaceholder"))}" value="${esc(this.activeDocId)}" />
      <div class="wengu-status" data-act="dlg-status" hidden></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="dlg-cancel">${esc(this.t("cancel"))}</button>
      <button class="b3-button b3-button--text" data-act="dlg-ok">${esc(this.t("convertStart"))}</button>
    </div>`,
        });
        const root = dialog.element;
        const input = root.querySelector<HTMLInputElement>("[data-act='dlg-docid']");
        const okBtn = root.querySelector<HTMLButtonElement>("[data-act='dlg-ok']");
        const status = root.querySelector<HTMLElement>("[data-act='dlg-status']");
        const showDlgStatus = (text: string, kind: "ok" | "err" | "muted") => {
            if (!status) return;
            status.textContent = text;
            status.className = `wengu-status wengu-status-${kind}`;
            status.removeAttribute("hidden");
        };
        root.querySelector("[data-act='dlg-cancel']")?.addEventListener("click", () => dialog.destroy());
        input?.focus();
        const run = async () => {
            const target = (input?.value ?? "").trim();
            if (!target || !okBtn) return;
            this.converting = true;
            okBtn.disabled = true;
            this.updateConvertBtn();
            showDlgStatus(this.t("converting"), "muted");
            try {
                const r = await convertDocToQuestions(target, this.t);
                if (r.canConvert && r.docId) {
                    // 内核 attributes 索引有数秒延迟：轮询等新文档进列表，期间框内提示
                    showDlgStatus(this.t("settling"), "muted");
                    await this.waitForDocInList(r.docId, 15000);
                    dialog.destroy();
                    this.pendingDoc = {id: r.docId, title: r.title ?? ""};
                    this.docId = r.docId;
                    this.persistPrefs();
                    await this.load();
                    this.showStatus(
                        fmt(this.t("convertDone"), {title: r.title ?? "", n: String(r.count)}),
                        "ok",
                    );
                } else {
                    showDlgStatus(r.message || this.t("convertNoQuestions"), "err");
                }
            } catch (e) {
                showDlgStatus(String((e as Error)?.message ?? e), "err");
            } finally {
                this.converting = false;
                okBtn.disabled = false;
                this.updateConvertBtn();
            }
        };
        okBtn?.addEventListener("click", () => void run());
        input?.addEventListener("keydown", (ev) => {
            if ((ev as KeyboardEvent).key === "Enter") void run();
        });
    }

    /** 反映转换状态到头部按钮（转换中禁用）。 */
    private updateConvertBtn(): void {
        const btn = this.el.querySelector<HTMLButtonElement>("[data-act='convert']");
        if (!btn) return;
        btn.disabled = this.converting;
        btn.textContent = this.converting ? this.t("converting") : this.t("convertBtn");
    }

    /** 面板级状态条（转换结果/进行中提示）。 */
    private showStatus(html: string, kind: "ok" | "err" | "muted"): void {
        const status = this.el.querySelector<HTMLElement>("[data-status]");
        if (!status) return;
        status.textContent = html;
        status.className = `wengu-status wengu-status-${kind}`;
        status.removeAttribute("hidden");
    }
}

/** 该题是否用字母 chip 作答（单选/多选且转换出了选项子块）。 */
function isChoice(q: WenguQuestion): boolean {
    return (q.type === QuestionType.Single || q.type === QuestionType.Multiple) &&
        (q.optionMd?.length ?? 0) > 0;
}

/** 题号初始状态类：上次刷完答对的绿、答错的红（来自持久化属性）。 */
function numState(q: WenguQuestion): string {
    if (q.right === "1") return " wengu-num-right";
    if (q.attempts > 0 && q.right === "0") return " wengu-num-wrong";
    return "";
}

/** 题型 → i18n 键：single → typeSingle。 */
function typeKey(type: QuestionType): string {
    return `type${type[0].toUpperCase()}${type.slice(1)}`;
}

/** 把 kramdown 交给思源 Lute 渲染为块 DOM HTML。 */
function luteToHtml(md: string): string {
    const lute = Lute.New();
    lute.SetKramdownIAL(true);
    // 行级/块级公式必须显式开启（思源编辑器配置默认关着行级公式，
    // 不开的话 $...$ 原样输出——真机截图实测的「没转义」根因）
    lute.SetInlineMath(true);
    (lute as unknown as {SetMathBlock?: (b: boolean) => void;}).SetMathBlock?.(true);
    lute.SetInlineMathAllowDigitAfterOpenMarker(true);
    return lute.Md2BlockDOM(md);
}

/** Lute 渲染降级：个别畸形 kramdown 会让 Lute 抛异常，退回纯文本。 */
function safeLute(md: string): string {
    try {
        return luteToHtml(md);
    } catch (_) {
        return `<pre>${esc(md)}</pre>`;
    }
}

/** 等 Protyle 把块 DOM 渲染进容器（出现 [data-node-id]），超时返回 false。 */
function waitForBlockNode(node: HTMLElement, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
            if (node.querySelector("[data-node-id]")) {
                resolve(true);
                return;
            }
            if (Date.now() - start >= timeoutMs) {
                resolve(false);
                return;
            }
            window.setTimeout(check, 120);
        };
        check();
    });
}

/** 公式/代码高亮（降级渲染路径需要）。 */
function renderMath(el: HTMLElement): void {
    if ("mathRender" in ProtyleMethod) {
        ProtyleMethod.mathRender(el);
    }
    if ("highlightRender" in ProtyleMethod) {
        ProtyleMethod.highlightRender(el);
    }
}

/** 顶部刷新按钮。 */
function refreshBtn(t: (k: string) => string): string {
    return `<button class="wengu-btn" data-act="refresh">${esc(t("quizRefresh"))}</button>`;
}

/** 秒数 → m:ss（超 1 小时 h:mm:ss）。 */
function mmss(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, "0");
    return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 倒计时分钟数：1~600 的整数，非法回退 20。 */
function clampMinutes(n: number): number {
    return Number.isFinite(n) && n >= 1 ? Math.min(600, Math.floor(n)) : 20;
}

/** i18n 模板变量替换：attempts = "刷题 {n} 次"。 */
function fmt(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);
}

/** HTML 转义。 */
function esc(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
