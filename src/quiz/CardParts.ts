import { svgIcon } from "../ui/FormHtml";
import type { WenguQuestion } from "../types";
import { esc, fmt } from "../ui/shared";

/**
 * 题卡共享部件（自 CardHtml 拆出）：卡头元信息行 + 「思路」折叠区。
 * 拆分动机：slots 卡的渲染层（SlotHtml）与普通卡（CardHtml）共用这
 * 两个部件，放独立模块避免 CardHtml ↔ SlotHtml 循环引用。
 */

/** 题型 → i18n 键：single → typeSingle。 */
export function typeKey(type: string): string {
    return `type${type[0].toUpperCase()}${type.slice(1)}`;
}

/** 题卡渲染入参（展示开关由 QuizView 按设置/模式算好传入）。 */
export interface CardHtmlModel {
    t: (key: string) => string;
    showAttempts: boolean;
    showWrongBadge: boolean;
}

/** 「思路」折叠输入区（收卷时快照进会话 thoughts，AI 判卷点评用）。 */
export function renderThoughtArea(t: (k: string) => string): string {
    return `<button class="wengu-thought-toggle" data-act="thought-toggle">${svgIcon("iconEdit")} ${esc(
        t("thoughtToggle")
    )}</button>
      <div class="wengu-thought" data-thought-wrap hidden>
        <textarea class="wengu-input" data-field="thought" rows="3" placeholder="${esc(
            t("thoughtPlaceholder")
        )}"></textarea>
      </div>`;
}

/** 卡片头部：题号 + 题型徽标 + 知识点标题 + 难度/来源/次数（各题型卡共用）。 */
export function renderCardHead(
    q: WenguQuestion,
    idx: number,
    m: CardHtmlModel,
    objective: boolean,
    t: (k: string) => string
): string {
    const label = q.knowledge || q.chapter;
    return `<div class="wengu-card-head">
        <span class="wengu-card-num">${idx + 1}</span>
        ${q.type ? `<span class="wengu-badge">${esc(t(typeKey(q.type)))}</span>` : ""}
        ${label ? `<span class="wengu-card-title">${esc(label)}</span>` : ""}
        ${!objective ? `<span class="wengu-badge">${esc(t("selfBadge"))}</span>` : ""}
        ${q.difficulty ? `<span class="wengu-meta">${svgIcon("iconStar", "wengu-star").repeat(q.difficulty)}</span>` : ""}
        ${q.source ? `<span class="wengu-meta">${esc(q.source)}</span>` : ""}
        ${
            q.attempts > 0 && m.showAttempts
                ? `<span class="wengu-meta">${esc(fmt(t("attempts"), { n: String(q.attempts) }))}</span>`
                : ""
        }
        ${
            q.wrongCount > 0 && m.showWrongBadge
                ? `<span class="wengu-meta wengu-wrong-count">${esc(
                      fmt(t("wrongCount"), { n: String(q.wrongCount) })
                  )}</span>`
                : ""
        }
        <button class="wengu-side-iconbtn wengu-regen-btn" data-act="regen" title="${esc(t("regenTitle"))}">${svgIcon(
            "iconRefresh"
        )}</button>
      </div>`;
}
