import { baseQid } from "../../types";

/**
 * 单题计时（Issue #182 / 设计稿 v6 `14c6f55`）。
 *
 * 与 `TimerController` 的分工：TimerController 管**整轮**墙钟（会话累计
 * 用时/倒计时/15s flush），本类管**单题**：焦点切换、提交结算、冻结。
 * 两者并存互不替代——整轮口径一个字都不动（兼容红线）。
 *
 * 语义（对应任务书 R1/R3/R4/R5）：
 * - **R1 点击即切**：`focus(qid, now)` 是切焦点的**唯一写口**。切换时刻
 *   即新题的计时起点；旧题当场停表。滚动/悬停都不调它（`NumRail` 的
 *   滚动跟踪只刷高亮），所以「作答必先计时」是机制保证而非约定。
 * - **R3 提交即结算**：`freeze(qid, now)` 算出 `sec = ceil((now − 起点)/1000)`，
 *   `<1s` 记 1s（向上取整的边界由 `Math.max(1, …)` 兜住）。
 * - **R4 结算后冻结**：`submitted` 集合一旦置入，再 `focus` 不开表、
 *   再 `freeze` 返回冻结值；brief 在 `await` AI 判分**之前**调 freeze，
 *   故 AI 等待天然不计入。
 * - **R5 后台/隐藏不计**：`setRun(false)` 当场停表（`acc` 结算到停止时刻），
 *   `setRun(true)` 把锚点重置到恢复时刻——挂后台的墙钟时间一秒都不进。
 *   会话/收卷导致整体停钟（`stop()`）时同理保持「重新可见从零续走」。
 *
 * 时间源：默认 `performance.now()`，构造可注入（单测/测试壳）。
 */
export class QuestionTimer {
    /** qid → 已完成毫秒（含已冻结题）。 */
    private readonly acc = new Map<string, number>();
    /** 当前走表锚点时刻；null = 停表。 */
    private since: number | null = null;
    /** 已结算（冻结）的题：不再走表、不再覆写。 */
    private readonly frozen = new Map<string, { sec: number; frozenMs: number }>();
    private current = "";
    private run = false;
    private readonly now: () => number;

    constructor(now: () => number = () => performance.now()) {
        this.now = now;
    }

    /** 当前计时题（无 = 空串）。 */
    get active(): string {
        return this.current;
    }

    /** 该题是否已结算（卡上静态注记/流光淡出的判据）。 */
    submitted(qid: string): boolean {
        return this.frozen.has(qid) || this.frozen.has(baseQid(qid));
    }

    /** 切焦点（R1）：旧题停表、新题自 `now` 起算。重复切同一题 = 无操作
     *  （滚动/悬停走的是高亮，不该打到这里；真机上重复 focus 也不能重置
     *  起点，否则「回来点两下」白赚时间）。已结算的题不回表。 */
    focus(qid: string, now = this.now()): void {
        if (qid === this.current) return;
        this.stop(now);
        this.current = qid;
        this.start(now);
    }

    /** 可见/在屏开关（R5）：false 停表并结算到 `now`，true 从 `now` 重新起锚。
     *  `now` 可显式传入（binder/测试），缺省取时间源。 */
    setRun(run: boolean, now = this.now()): void {
        if (run === this.run) return;
        this.run = run;
        if (run) this.start(now);
        else this.stop(now);
    }

    /** 走表开关（`document.hidden` / 零 rect 两条闸的同义封装）。 */
    get running(): boolean {
        return this.run;
    }

    /** 当前题实时用时（ms）。已结算题恒返 0——冻结后流光停格，不该再涨。 */
    live(now = this.now()): number {
        if (this.current === "" || this.submitted(this.current)) return 0;
        return (this.acc.get(this.current) ?? 0) + (this.since === null ? 0 : Math.max(0, now - this.since));
    }

    /** 已完成毫秒（含冻结题；结算用）。 */
    livedMs(qid: string, now = this.now()): number {
        const hit = this.frozen.get(qid) ?? this.frozen.get(baseQid(qid));
        if (hit) return hit.frozenMs;
        const base = this.acc.get(qid) ?? 0;
        return qid === this.current && this.since !== null ? base + Math.max(0, now - this.since) : base;
    }

    /** 提交结算（R3/R4）：向上取整、`<1s` 记 1s；同一题只结一次，
     *  重复调用返回首次冻结值（改答只改对错、不动 sec）。 */
    freeze(qid: string, now = this.now()): { sec: number; frozenMs: number } {
        const base = baseQid(qid);
        const done = this.frozen.get(qid) ?? this.frozen.get(base);
        if (done) return done;
        const ms = this.livedMs(qid, now);
        const hit = { sec: Math.max(1, Math.ceil(ms / 1000)), frozenMs: ms };
        this.frozen.set(qid, hit);
        if (base !== qid) this.frozen.set(base, hit);
        // 冻结的题若正走表，当场停表（焦点留在它身上时不再涨）
        if (this.current === qid || this.current === base) this.stop(now);
        return hit;
    }

    /** 该题已结算秒数（未结算返 0；卡上注记与台账读它）。 */
    secOf(qid: string): number {
        return (this.frozen.get(qid) ?? this.frozen.get(baseQid(qid)))?.sec ?? 0;
    }

    /** 从会话结果回填（继续上次）：只收 >0 的秒数，且按「已结算」记入
     *  ——恢复轮不该再走表，也不该被改答覆写（R4/R6）。 */
    restore(qid: string, sec: number): void {
        if (!(sec > 0)) return;
        const base = baseQid(qid);
        if (this.frozen.has(base)) return;
        const hit = { sec, frozenMs: sec * 1000 };
        this.frozen.set(qid, hit);
        if (base !== qid) this.frozen.set(base, hit);
    }

    /** 整轮重置（开新轮）：清焦点、清表、清冻结。 */
    reset(): void {
        this.acc.clear();
        this.frozen.clear();
        this.current = "";
        this.since = null;
    }

    /* ── 内部：走表开关（`run` 与「有焦点且未结算」两条同时成立才走） ── */

    private start(now: number): void {
        if (!this.run || this.since !== null) return;
        if (this.current === "" || this.submitted(this.current)) return;
        this.since = now;
    }

    private stop(now: number): void {
        if (this.since === null) return;
        const d = Math.max(0, now - this.since);
        this.since = null;
        if (this.current === "") return;
        this.acc.set(this.current, (this.acc.get(this.current) ?? 0) + d);
    }
}
