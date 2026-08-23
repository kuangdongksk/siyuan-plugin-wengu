import {svgIcon} from "./FormHtml";
import {
    esc,
    fmt,
} from "./ui";
import type {WenguWordStats} from "./WordStore";

/**
 * 单词统计页（WordView 拆件，纯渲染）：
 * 累计进度 / 今日打卡 / 误认与太简单 / 连续天数 / 未来 7 天到期柱状。
 * 多天未开的到期积压全部体现在「今天」柱里，如实呈现压力。
 */

/** 未来第 i 天的横轴标签（0=今天，1=明天，其余 MM-DD）。 */
function dayLabel(i: number): string {
    if (i === 0) return "今";
    if (i === 1) return "明";
    const d = new Date(Date.now() + i * 86400_000);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function num(t: (k: string) => string, key: string, v: number): string {
    return `<div class="wengu-stats-cell">
    <div class="wengu-stats-num">${String(v)}</div>
    <div class="wengu-stats-label">${esc(t(key))}</div>
  </div>`;
}

export function renderWordStats(
    t: (k: string) => string,
    s: WenguWordStats,
    headHtml: string,
): string {
    const max = Math.max(1, ...s.next7);
    const bars = s.next7.slice(0, 8).map((c, i) =>
        `<div class="wengu-stats-bar${i === 0 ? " wengu-stats-bar-today" : ""}" title="${c}">
    <div class="wengu-stats-bar-col" style="height:${Math.max(4, Math.round((c / max) * 100))}%"></div>
    <div class="wengu-stats-bar-count">${c > 0 ? String(c) : ""}</div>
    <div class="wengu-stats-bar-label">${esc(dayLabel(i))}</div>
  </div>`
    ).join("");
    return `<div class="wengu-word">
  ${headHtml}
  <div class="wengu-stats">
    <div class="wengu-stats-row">
      ${num(t, "wordStatsLearned", s.learned)}${num(t, "wordStatsLeft", s.left)}${
        num(t, "wordStatsMastered", s.mastered)
    }
    </div>
    <div class="wengu-stats-row">
      ${num(t, "wordStatsTodayNew", s.todayNew)}${num(t, "wordStatsTodayRev", s.todayRev)}${
        num(t, "wordStatsStreakN", s.streak)
    }
    </div>
    <div class="wengu-stats-sub">${
        esc(fmt(t("wordStatsLine2"), {
            a: String(s.mistakes),
            b: String(s.mistakesPending),
            c: String(s.familiar),
            d: String(s.starred),
            e: String(s.simple),
        }))
    }</div>
    <div class="wengu-stats-chart-title">${esc(t("wordStatsNext7"))}</div>
    <div class="wengu-stats-bars">${bars}</div>
    <div class="wengu-word-form-actions">
      <button class="b3-button b3-button--outline" data-act="home">${svgIcon("iconList")} ${
        esc(t("wordBackHome"))
    }</button>
    </div>
  </div>
</div>`;
}
