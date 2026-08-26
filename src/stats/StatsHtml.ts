import { svgIcon } from "../ui/FormHtml";
import type { WenguQuizStats, WenguWrongItem } from "./StatsService";
import type { WeakCause, WeakTopRow } from "../bank/WeaknessStore";
import type { WenguDoc } from "../types";
import { esc, fmt, mmss } from "../ui/shared";

/**
 * 统计面板纯渲染（浮层两页：总览 / 本文档详情）。
 * 数字卡复用单词统计的 wengu-stats-* 网格；图表位置只留
 * data-chart 占位，echarts 实例由 StatsPanel 挂载。
 */

type T = (k: string) => string;

/** 总览扩展块数据（错题概况 + 薄弱知识点 + 错因分布，D6）。 */
export interface OverviewExtra {
    /** 错题概况（缓存未就绪时 undefined，显示占位）。 */
    wrong?: { pending: number; mastered: number };
    weakRows: WeakTopRow[];
    causeDist: { cause: WeakCause; n: number }[];
}

function cell(t: T, key: string, value: string): string {
    return `<div class="wengu-stats-cell">
        <div class="wengu-stats-num">${esc(value)}</div>
        <div class="wengu-stats-label">${esc(t(key))}</div>
    </div>`;
}

function dateLabel(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function weakCauseLabel(t: T, cause: WeakCause): string {
    return t(`weakCause${cause[0].toUpperCase()}${cause.slice(1)}`);
}

/** 总览扩展块 HTML（D6：错题概况 / 薄弱 Top / 错因分布；wrong 未就绪显示占位）。 */
function overviewExtraHtml(t: T, extra: OverviewExtra): string {
    const num = (v: number | undefined) => (v === undefined ? "—" : String(v));
    const wrongBlock = `<div class="wengu-stats-row wengu-stats-wrong-over">
            ${cell(t, "reviewFilterPending", num(extra.wrong?.pending))}${cell(t, "reviewFilterMastered", num(extra.wrong?.mastered))}
            <button class="b3-button b3-button--outline wengu-stats-enter-review" data-act="enter-review">
                ${svgIcon("iconRight")} ${esc(t("statsEnterReview"))}
            </button>
        </div>`;
    const weakItems = extra.weakRows
        .map(
            (r) =>
                `<div class="wengu-weak-row" title="${esc(r.title)}">
    <span class="wengu-weak-title">${esc(r.title)}</span>
    <span class="wengu-meta">${esc(fmt(t("weakStats"), { w: String(r.wrong), n: String(r.total) }))}</span>${
        r.topCause ? `<span class="wengu-badge">${esc(weakCauseLabel(t, r.topCause))}</span>` : ""
    }
  </div>`
        )
        .join("");
    const weakBlock =
        extra.weakRows.length > 0
            ? `<div class="wengu-stats-chart-title">${esc(t("statsWeakTop"))}</div><div class="wengu-weak-list">${weakItems}</div>`
            : "";
    const max = Math.max(1, ...extra.causeDist.map((c) => c.n));
    const causeRows = extra.causeDist
        .map(
            (c) =>
                `<div class="wengu-stats-cause-row">
    <span class="wengu-stats-cause-label">${esc(weakCauseLabel(t, c.cause))}</span>
    <span class="wengu-stats-cause-track"><span class="wengu-stats-cause-fill" style="width:${Math.round(
        (c.n / max) * 100
    )}%"></span></span>
    <span class="wengu-stats-cause-n">${c.n}</span>
</div>`
        )
        .join("");
    const causeBlock =
        extra.causeDist.length > 0
            ? `<div class="wengu-stats-chart-title">${esc(t("statsCauseDist"))}</div>${causeRows}`
            : "";
    return `<div class="wengu-stats-chart-title">${esc(t("statsOverviewWrong"))}</div>${wrongBlock}${weakBlock}${causeBlock}`;
}

/** 浮层外壳：sticky 头（tab + 关闭）+ 内容区（滚动）。 */
export function renderStatsShell(t: T, tabsHtml: string, bodyHtml: string): string {
    return `<div class="wengu-stats-layer" data-stats-layer>
        <div class="wengu-stats-head">
            <span class="wengu-stats-title">${esc(t("statsTitle"))}</span>
            <span class="wengu-stats-tabs">${tabsHtml}</span>
            <button class="wengu-side-iconbtn" data-act="stats-close" title="${esc(t("statsClose"))}">
                ${svgIcon("iconClose")}
            </button>
        </div>
        <div class="wengu-stats-body" data-stats-body>${bodyHtml}</div>
    </div>`;
}

/** 总览页：数字卡 + 总览扩展块 + 近 N 轮趋势 + 文档榜（行可点击下钻）。 */
export function renderOverviewHtml(
    t: T,
    s: WenguQuizStats,
    docs: WenguDoc[],
    docId: string,
    extra?: OverviewExtra
): string {
    const rate = `${Math.round(s.rate * 100)}%`;
    const rows = docs
        .map((d) => {
            const r = d.attempted > 0 ? `${Math.round((d.rightCount / d.attempted) * 100)}%` : "-";
            return `<tr
                class="wengu-stats-doc-row${d.id === docId ? " wengu-stats-doc-cur" : ""}"
                data-docid="${esc(d.id)}"
            >
                <td class="wengu-stats-doc-name" title="${esc(d.hPath || d.title || d.id)}">${esc(d.title || d.id)}</td>
                <td>${d.total}</td>
                <td>${d.attempted}</td>
                <td>${d.rightCount}</td>
                <td>${esc(r)}</td>
                <td>${esc(mmss(d.totalTime))}</td>
            </tr>`;
        })
        .join("");
    return `<div class="wengu-stats">
        <div class="wengu-stats-row">
            ${cell(t, "statsRounds", String(s.rounds))}${cell(
                t,
                "statsAnswered",
                String(s.answered)
            )}${cell(t, "statsAccuracy", rate)}
        </div>
        <div class="wengu-stats-row">
            ${cell(t, "statsTotalTime", mmss(s.totalSec))}${cell(t, "statsStreakN", String(s.streak))}
        </div>
        ${extra ? overviewExtraHtml(t, extra) : ""}
        ${
            s.recent.length > 0
                ? `<div class="wengu-stats-chart-title">${esc(t("statsRecentChart"))}</div>
                      <div class="wengu-stats-chart-box" data-chart="trend"></div>`
                : `<div class="wengu-muted wengu-stats-empty">${esc(t("statsEmpty"))}</div>`
        }
        ${
            docs.length > 0
                ? `<div class="wengu-stats-chart-title">${esc(t("statsDocChart"))}</div>
                      <table class="wengu-stats-table">
                          <thead>
                              <tr>
                                  <th>${esc(t("statsColDoc"))}</th>
                                  <th>${esc(t("statsColTotal"))}</th>
                                  <th>${esc(t("statsColAttempted"))}</th>
                                  <th>${esc(t("statsColRight"))}</th>
                                  <th>${esc(t("statsColRate"))}</th>
                                  <th>${esc(t("statsColTime"))}</th>
                              </tr>
                          </thead>
                          <tbody>
                              ${rows}
                          </tbody>
                      </table>`
                : ""
        }
    </div>`;
}

function wrongHtml(t: T, w: WenguWrongItem): string {
    const recent = w.right === "1" ? t("statsWrongRecentRight") : w.right === "0" ? t("statsWrongRecentWrong") : "";
    const meta = [
        w.knowledge ? esc(w.knowledge) : "",
        esc(fmt(t("statsWrongCount"), { n: String(w.wrongCount) })),
        recent,
        w.lastAnswer ? esc(fmt(t("statsWrongLast"), { a: w.lastAnswer })) : "",
    ]
        .filter(Boolean)
        .join(" · ");
    return `<div class="wengu-stats-wrong" title="${esc(w.qid)}" data-wrong-qid="${esc(w.qid)}">
        <span class="wengu-stats-wrong-idx">${w.index}</span>
        <div class="wengu-stats-wrong-body">
            <div class="wengu-stats-wrong-stem">${esc(w.stemSummary)}</div>
            <div class="wengu-stats-wrong-meta">${meta}</div>
        </div>
    </div>`;
}

/** 详情页：轮次趋势图 + 逐轮评分记录 + 错题清单 + AI 学习建议。 */
export function renderDocStatsHtml(
    t: T,
    m: {
        docTitle: string;
        total: number;
        rounds: {
            startedAt: number;
            mode: string;
            answered: number;
            correct: number;
            elapsedSec: number;
        }[];
        wrongs: WenguWrongItem[];
        wrongTotal: number;
    }
): string {
    const rows = m.rounds
        .map((r, i) => {
            const rate = r.answered > 0 ? `${Math.round((r.correct / r.answered) * 100)}%` : "-";
            return `<tr>
                <td>${esc(fmt(t("statsRoundN"), { n: String(i + 1) }))}</td>
                <td>${esc(dateLabel(r.startedAt))}</td>
                <td>${esc(r.mode)}</td>
                <td>${r.correct}/${r.answered}</td>
                <td>${esc(rate)}</td>
                <td>${esc(mmss(r.elapsedSec))}</td>
            </tr>`;
        })
        .join("");
    const wrongs = m.wrongs.map((w) => wrongHtml(t, w)).join("");
    return `<div class="wengu-stats">
        <div class="wengu-stats-sub">${esc(fmt(t("statsDocHead"), { title: m.docTitle, n: String(m.total) }))}</div>
        ${
            m.rounds.length > 0
                ? `<div class="wengu-stats-chart-box" data-chart="rounds"></div>
                      <div class="wengu-stats-chart-title">${esc(t("statsRoundList"))}</div>
                      <table class="wengu-stats-table">
                          <thead>
                              <tr>
                                  <th>#</th>
                                  <th>${esc(t("statsRoundColDate"))}</th>
                                  <th>${esc(t("statsRoundColMode"))}</th>
                                  <th>${esc(t("statsRoundColScore"))}</th>
                                  <th>${esc(t("statsColRate"))}</th>
                                  <th>${esc(t("statsColTime"))}</th>
                              </tr>
                          </thead>
                          <tbody>
                              ${rows}
                          </tbody>
                      </table>`
                : `<div class="wengu-muted wengu-stats-empty">${esc(t("statsEmpty"))}</div>`
        }
        <div class="wengu-stats-chart-title">${esc(fmt(t("statsWrongList"), { n: String(m.wrongTotal) }))}</div>
        ${wrongs || `<div class="wengu-muted wengu-stats-empty">${esc(t("statsNoWrong"))}</div>`}
        <div class="wengu-word-form-actions">
            <button class="b3-button b3-button--outline" data-act="ai-stats">
                ${svgIcon("iconSparkles")} ${esc(t("statsAiBtn"))}
            </button>
        </div>
        <div class="wengu-report-ai" data-ai hidden></div>
    </div>`;
}
