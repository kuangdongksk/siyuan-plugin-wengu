import { svgIcon } from "../ui/FormHtml";
import { esc, fmt } from "../ui/shared";
import WORD_BOOK from "./WordBook";
import { renderWordStats } from "./WordStats";
import { buildQueue, buildStats, starredList, type WenguWordProgress } from "./WordStore";

/**
 * 单词每日首页与选择层（WordView 拆件，仿不背单词首页）：
 *
 * - 首页:到期复习、新学两个入口卡;复习清零后只剩新学一个入口,
 *   全书学完只剩复习。
 * - 点「新学」且有到期复习时,先弹「先复习」确认层(去复习/仍学新词)。
 * - 会话完成页:按队列种类给文案,含生词重过与回首页。
 */

/** 首页入口渲染。reviewDue=到期复习数,freshLeft=未学新词数,starN=星标词数。 */
export function renderWordHome(
    t: (k: string) => string,
    reviewDue: number,
    freshLeft: number,
    headHtml: string,
    msgHtml: string,
    starN = 0
): string {
    const entries: string[] = [];
    if (reviewDue > 0) {
        entries.push(`<button class="wengu-word-entry" data-act="goreview">
  <span class="wengu-word-entry-title">${esc(t("wordHomeReviewTitle"))}</span>
  <span class="wengu-word-entry-count">${esc(fmt(t("wordHomeReviewCount"), { n: String(reviewDue) }))}</span>
</button>`);
    }
    if (freshLeft > 0) {
        entries.push(`<button class="wengu-word-entry" data-act="gofresh">
  <span class="wengu-word-entry-title">${esc(t("wordHomeFreshTitle"))}</span>
  <span class="wengu-word-entry-count">${esc(fmt(t("wordHomeFreshCount"), { n: String(freshLeft) }))}</span>
</button>`);
    }
    if (starN > 0) {
        entries.push(`<button class="wengu-word-entry wengu-word-entry-star" data-act="gostar">
  <span class="wengu-word-entry-title">${esc(t("wordHomeStarTitle"))}</span>
  <span class="wengu-word-entry-count">${esc(fmt(t("wordHomeStarCount"), { n: String(starN) }))}</span>
</button>`);
    }
    if (entries.length === 0) {
        entries.push(`<div class="wengu-word-entry wengu-word-entry-muted">${esc(t("wordBookDone"))}</div>`);
    }
    return `<div class="wengu-word">
  ${headHtml}
  ${msgHtml}
  <div class="wengu-word-entries">${entries.join("")}</div>
</div>`;
}

/** 刷题卡头部:标题+今日统计+徽标+可选按钮组(回首页/设置由本函数统一给)。 */
export function renderCardHead(t: (k: string) => string, stats: string, badge: string, extraButtons: string): string {
    return `<div class="wengu-word-head">
    <span class="wengu-word-title">${esc(WORD_BOOK.title)}</span>
    <span class="wengu-word-stats">${stats}</span>${badge}
    <span class="fn__flex-1"></span>
    ${extraButtons}
    <button class="b3-button b3-button--icon" data-act="home" title="${esc(t("wordBackHome"))}">${svgIcon(
        "iconList"
    )}</button>
    <button class="b3-button b3-button--icon" data-act="setstart" title="${esc(t("wordSetStart"))}">${svgIcon(
        "iconSettings"
    )}</button>
  </div>`;
}

/** 「先复习」确认层:n=到期复习数。 */
export function renderAskReview(t: (k: string) => string, n: number, headHtml: string): string {
    return `<div class="wengu-word">
  ${headHtml}
  <div class="wengu-word-card wengu-word-revealed">
    <div class="wengu-word-zh">${esc(fmt(t("wordAskReview"), { n: String(n) }))}</div>
    <div class="wengu-word-actions">
      <button class="b3-button b3-button--outline" data-act="goreview">${esc(t("wordGoReview"))}</button>
      <button class="b3-button b3-button--cancel" data-act="gofreshanyway">${esc(t("wordStillFresh"))}</button>
    </div>
  </div>
</div>`;
}

/** 会话完成页:kind 决定文案;hardN>0 给生词重过。 */
export function renderWordDone(
    t: (k: string) => string,
    kind: "review" | "fresh" | "star",
    todayNew: number,
    todayRev: number,
    hardN: number,
    headHtml: string,
    msgHtml: string
): string {
    const title = kind === "review" ? t("wordReviewDone") : t("wordDoneTitle");
    const body =
        kind === "review"
            ? fmt(t("wordDoneBody"), { a: String(todayNew), b: String(todayRev) })
            : fmt(t("wordDoneBody"), { a: String(todayNew), b: String(todayRev) });
    return `<div class="wengu-word">
  ${headHtml}
  ${msgHtml}
  <div class="wengu-word-card wengu-word-done">
    <div class="wengu-word-text">${esc(title)}</div>
    <div class="wengu-word-meaning wengu-word-revealed">${esc(body)}</div>
    <div class="wengu-word-actions">
      <button class="b3-button b3-button--outline" data-act="redohard" ${hardN === 0 ? " disabled" : ""}>${esc(
          fmt(t("wordRedoHard"), { n: String(hardN) })
      )}</button>
      <button class="b3-button b3-button--outline" data-act="home">${esc(t("wordBackHome"))}</button>
    </div>
  </div>
</div>`;
}

/** 首页/完成页共用的头部(标题 + 可选按钮组,如 AI 分析/回首页)。 */
export function renderWordHead(t: (k: string) => string, extraButtons: string): string {
    return `<div class="wengu-word-head">
    <span class="wengu-word-title">${esc(WORD_BOOK.title)}</span>
    <span class="fn__flex-1"></span>
    ${extraButtons}
    <button class="b3-button b3-button--icon" data-act="setstart" title="${esc(t("wordSetStart"))}">${svgIcon(
        "iconSettings"
    )}</button>
  </div>`;
}

/* ── 视图组装（自 WordView 外移，行数受限） ── */

/** AI 视图胶水的最小面（避免 WordHome 反向 import WordAi）。 */
export interface AiGlue {
    buttonHtml(p: WenguWordProgress): string;
    msgHtml(): string;
}

/** 非答题页头部按钮组：统计 + 查词 + AI。 */
export function homeExtrasHtml(t: (k: string) => string, ai: AiGlue, p: WenguWordProgress): string {
    return `<button class="b3-button b3-button--icon" data-act="stats" title="${esc(t("wordStatsTitle"))}">${svgIcon(
        "iconInfo"
    )}</button><button class="b3-button b3-button--icon" data-act="lookup" title="${esc(t("wordLookup"))}">${svgIcon(
        "iconSearch"
    )}</button>${ai.buttonHtml(p)}`;
}

/** 首页 / 先复习确认层组装。 */
export function paintHomeInto(
    el: HTMLElement,
    t: (k: string) => string,
    p: WenguWordProgress,
    askReview: boolean,
    ai: AiGlue
): void {
    const { review, fresh } = buildQueue(p);
    const head = renderWordHead(t, homeExtrasHtml(t, ai, p));
    el.innerHTML = askReview
        ? renderAskReview(t, review.length, head)
        : renderWordHome(t, review.length, fresh.length, head, ai.msgHtml(), starredList(p).length);
}

/** 统计页组装。 */
export function paintStatsInto(el: HTMLElement, t: (k: string) => string, p: WenguWordProgress, ai: AiGlue): void {
    el.innerHTML = renderWordStats(t, buildStats(p), renderWordHead(t, homeExtrasHtml(t, ai, p)));
}

/** 会话完成页组装（自 WordView 外移）。 */
export function paintDoneInto(
    el: HTMLElement,
    t: (k: string) => string,
    p: WenguWordProgress,
    kind: "review" | "fresh" | "star",
    hardN: number,
    ai: AiGlue
): void {
    el.innerHTML = renderWordDone(
        t,
        kind,
        p.today.newCount,
        p.today.revCount,
        hardN,
        renderWordHead(t, homeExtrasHtml(t, ai, p)),
        ai.msgHtml()
    );
}
