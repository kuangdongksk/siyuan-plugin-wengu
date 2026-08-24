import { svgIcon } from "./FormHtml";
import type { WenguQuizStats, WenguWrongItem } from "./StatsService";
import type { WenguDoc } from "./types";
import { esc, fmt, mmss } from "./ui";

/**
 * 统计面板纯渲染（浮层两页：总览 / 本文档详情）。
 * 数字卡复用单词统计的 wengu-stats-* 网格；图表位置只留
 * data-chart 占位，echarts 实例由 StatsPanel 挂载。
 */

type T = (k: string) => string;

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

/** 总览页：数字卡 + 近 N 轮趋势 + 文档榜（行可点击下钻）。 */
export function renderOverviewHtml(t: T, s: WenguQuizStats, docs: WenguDoc[], docId: string): string {
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
    return `<div class="wengu-stats-wrong" title="${esc(w.qid)}">
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
