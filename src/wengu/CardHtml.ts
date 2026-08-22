import {svgIcon} from "./FormHtml";
import {
    mdFragmentHtml,
    renderMathIn,
} from "./ProtyleHost";
import type {WenguQuestion} from "./types";
import type {WenguStep} from "./types";
import {
    AUTO_GRADE_TYPES,
    hasSteps,
    LETTERS,
    optionDisplayMd,
    QuestionType,
} from "./types";
import type {WenguDoc} from "./types";
import {
    esc,
    fmt,
    mmss,
} from "./ui";

/**
 * 纯 HTML 构建层（design-review 拆分）：题卡/作答位/目录/头部。
 * 只做字符串拼接与谓词判断，不持有状态；QuizView 消费这些函数。
 */

/** 该题是否用字母 chip 作答（单选/多选且转换出了选项子块）。 */
export function isChoice(q: WenguQuestion): boolean {
    return (q.type === QuestionType.Single || q.type === QuestionType.Multiple) &&
        (q.optionMd?.length ?? 0) > 0;
}

/** 客观题（有题型且有答案，可自动判分）；否则走自评流程。 */
export function isObjective(q: WenguQuestion): boolean {
    return q.type !== undefined && AUTO_GRADE_TYPES.includes(q.type) && !!q.answer;
}

/** 题型 → i18n 键：single → typeSingle。 */
export function typeKey(type: QuestionType): string {
    return `type${type[0].toUpperCase()}${type.slice(1)}`;
}

/** 题号初始状态类：上次答对绿、答错红（持久化属性）。showPast=false
 *  （统一展示模式 / 设置关闭）时一律中性，不透历史对错。 */
export function numState(q: WenguQuestion, showPast: boolean): string {
    if (!showPast) return "";
    if (q.right === "1") return " wengu-num-right";
    if (q.attempts > 0 && q.right === "0") return " wengu-num-wrong";
    return "";
}

/** 题卡渲染入参（展示开关由 QuizView 按设置/模式算好传入）。 */
export interface CardHtmlModel {
    t: (key: string) => string;
    showAttempts: boolean;
    showWrongBadge: boolean;
}

/** 一张题卡：头部元信息 + Protyle 占位（题目内容）+ 作答位。 */
export function renderCardHtml(q: WenguQuestion, idx: number, m: CardHtmlModel): string {
    if (hasSteps(q)) return renderStepsCardHtml(q, idx, m);
    const objective = isObjective(q);
    const {t} = m;
    return `<div class="wengu-card" data-qid="${esc(q.id)}" data-idx="${idx}">
      ${renderCardHead(q, idx, m, objective)}
      <div class="wengu-qprotyle" data-qprotyle><span class="wengu-muted">…</span></div>
      ${renderAnswerArea(q, m.t)}
      <button class="wengu-btn" data-act="submit">${esc(t("submit"))}</button>
      <div class="wengu-result" data-result hidden></div>
      <div class="wengu-note" data-note hidden></div>
      <div class="wengu-ai-comment" data-ai-comment hidden></div>
      <div class="wengu-self" data-self hidden>
        <span>${esc(t("selfAssess"))}</span>
        <button class="wengu-btn wengu-btn-success" data-act="self-right">${esc(t("selfRight"))}</button>
        <button class="wengu-btn wengu-btn-error" data-act="self-wrong">${esc(t("selfWrong"))}</button>
      </div>
    </div>`;
}

/** 卡片头部：标题 + 题型/自评徽标 + 难度/来源/次数（两种题卡共用）。 */
function renderCardHead(q: WenguQuestion, idx: number, m: CardHtmlModel, objective: boolean): string {
    const {t} = m;
    return `<div class="wengu-card-head">
        <span class="wengu-card-title">${esc(q.knowledge || q.chapter || String(idx + 1))}</span>
        ${q.type ? `<span class="wengu-badge">${esc(t(typeKey(q.type)))}</span>` : ""}
        ${!objective ? `<span class="wengu-badge">${esc(t("selfBadge"))}</span>` : ""}
        ${q.difficulty ? `<span class="wengu-meta">${"★".repeat(q.difficulty)}</span>` : ""}
        ${q.source ? `<span class="wengu-meta">${esc(q.source)}</span>` : ""}
        ${
        q.attempts > 0 && m.showAttempts ?
            `<span class="wengu-meta">${esc(fmt(t("attempts"), {n: String(q.attempts)}))}</span>` :
            ""
    }
        ${
        q.wrongCount > 0 && m.showWrongBadge ?
            `<span class="wengu-meta wengu-wrong-count">${
                esc(fmt(t("wrongCount"), {n: String(q.wrongCount)}))
            }</span>` :
            ""
    }
      </div>`;
}

/** 一张多步引导卡：头部 + Protyle 题干 + 逐步解锁作答区。
 *  步骤引导语/选项内容由 StepsFlow 用 Lute 填充——step-* 子块在
 *  Protyle 渲染里被 CSS 隐藏（防剧透），选项只在解锁后出现。 */
export function renderStepsCardHtml(q: WenguQuestion, idx: number, m: CardHtmlModel): string {
    return `<div class="wengu-card" data-qid="${esc(q.id)}" data-idx="${idx}">
      ${renderCardHead(q, idx, m, false)}
      <div class="wengu-qprotyle" data-qprotyle><span class="wengu-muted">…</span></div>
      <div class="wengu-steps" data-steps>${renderStepsInnerHtml(q, m.t)}</div>
      <div class="wengu-result" data-result hidden></div>
      <div class="wengu-note" data-note hidden></div>
    </div>`;
}

/** 步骤作答区 HTML（实时模式回落离线时 StepsFlow 重建用）。
 *  引导语/选项文本留空占位（data-step-stem / data-opt-text），由
 *  fillOneStep 填 Lute HTML 以渲染公式。 */
export function renderStepsInnerHtml(q: WenguQuestion, t: (k: string) => string): string {
    return (q.steps ?? []).map((s, k) => renderOneStepHtml(s, k, t)).join("");
}

/** 单步作答区 HTML（离线静态渲染与 AI 实时逐步追加共用）。 */
export function renderOneStepHtml(step: WenguStep, k: number, t: (k2: string) => string): string {
    return `<div class="wengu-step" data-step="${k}"${k > 0 ? " hidden" : ""}>
        <div class="wengu-step-head">
          <span class="wengu-badge wengu-step-kind">${
        esc(step.kind === "method" ? t("stepMethodBadge") : t("stepResultBadge"))
    }</span>
          <span class="wengu-step-stem" data-step-stem></span>
        </div>
        <div class="wengu-step-opts">${
        step.optionMd
            .map((_, i) =>
                `<button class="wengu-step-opt" data-letter="${LETTERS[i] ?? ""}">
              <span class="wengu-step-letter">${LETTERS[i] ?? ""}</span>
              <span class="wengu-step-text" data-opt-text></span>
            </button>`
            )
            .join("")
    }</div>
        <button class="wengu-btn wengu-step-next" data-act="step-next">${esc(t("stepNext"))}</button>
        <div class="wengu-step-result" data-step-result hidden></div>
      </div>`;
}

/** 往一步的占位里填内容：引导语 + 各选项文本（Lute 渲染公式后高亮）。 */
export function fillOneStep(stepEl: HTMLElement, step: WenguStep): void {
    const stem = stepEl.querySelector<HTMLElement>("[data-step-stem]");
    if (stem && step.stemMd) stem.innerHTML = mdFragmentHtml(step.stemMd);
    for (const opt of stepEl.querySelectorAll<HTMLElement>(".wengu-step-opt")) {
        const idx = LETTERS.indexOf(opt.dataset.letter ?? "");
        const text = opt.querySelector<HTMLElement>("[data-opt-text]");
        if (text && step.optionMd[idx]) text.innerHTML = mdFragmentHtml(optionDisplayMd(step.optionMd[idx]));
    }
    renderMathIn(stepEl);
}

/** 作答位：选择题字母 chip / 判断按钮 / 填空输入 / 简答多行。 */
export function renderAnswerArea(q: WenguQuestion, t: (k: string) => string): string {
    if (isChoice(q)) {
        const chips = (q.optionMd ?? [])
            .map((_, i) => `<button class="wengu-chip" data-letter="${LETTERS[i] ?? ""}">${LETTERS[i] ?? ""}</button>`)
            .join("");
        return `<div class="wengu-chips">${chips}</div>`;
    }
    const ph = esc(t("inputPlaceholder"));
    if (q.type === QuestionType.Judge) {
        return `<div class="wengu-judge">
        <button class="wengu-btn" data-judge="√">${esc(t("judgeYes"))}</button>
        <button class="wengu-btn" data-judge="×">${esc(t("judgeNo"))}</button>
      </div>`;
    }
    if (q.type === QuestionType.Brief) {
        return `<textarea class="wengu-input" data-field="mine" rows="4" placeholder="${ph}"></textarea>`;
    }
    return `<input class="wengu-input" data-field="mine" placeholder="${ph}" />`;
}

/** 目录渲染入参。 */
export interface SideHtmlModel {
    t: (key: string) => string;
    docs: WenguDoc[];
    docId: string;
    sideCollapsed: boolean;
    hasSettingsButton: boolean;
}

/** 左侧文档目录（hPath 分组，可收起；底部刷新/转习题/设置）。 */
export function renderSideHtml(m: SideHtmlModel): string {
    const {t, docs, docId} = m;
    const groups = new Map<string, WenguDoc[]>();
    for (const d of docs) {
        const seg = (d.hPath || "").split("/").filter(Boolean);
        seg.pop();
        const key = seg.length ? `/${seg.join("/")}` : "/";
        const arr = groups.get(key) ?? [];
        arr.push(d);
        groups.set(key, arr);
    }
    const items = [...groups.entries()]
        .map(([group, gdocs]) =>
            `<div class="wengu-side-group">
        <div class="wengu-side-label">${esc(group)}</div>${
                gdocs.map((d) => {
                    const active = d.id === docId ? " wengu-side-active" : "";
                    const meta = [
                        fmt(t("exerciseCount"), {n: String(d.total)}),
                        d.attempted > 0 ? fmt(t("drilledCount"), {a: String(d.attempted)}) : "",
                        d.totalTime > 0 ? mmss(d.totalTime) : "",
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
    return `<div class="wengu-side${m.sideCollapsed ? " wengu-side-collapsed" : ""}" data-side>
      <div class="wengu-side-head">
        <span>${esc(t("sideTitle"))}</span>
        <button class="wengu-btn wengu-side-fold" data-act="side-fold" title="${esc(t("sideFold"))}">«</button>
      </div>
      <div class="wengu-side-body">${items || `<div class="wengu-muted">${esc(t("noExerciseDocs"))}</div>`}</div>
      <div class="wengu-side-foot">
        <button class="wengu-btn wengu-side-action" data-act="refresh" title="${esc(t("quizRefresh"))}">${
        svgIcon("iconRefresh")
    } ${esc(t("quizRefresh"))}</button>
        <button class="wengu-btn wengu-side-action" data-act="convert" title="${esc(t("convertBtn"))}">${
        svgIcon("iconSparkles")
    } ${esc(t("convertBtn"))}</button>
        ${
        m.hasSettingsButton ?
            `<button class="wengu-btn wengu-side-action" data-act="settings" title="${esc(t("settingsBtn"))}">${
                svgIcon("iconSettings")
            }</button>` :
            ""
    }
      </div>
    </div>`;
}

/** 头部：目录开关（收起时）+ 用时。 */
export function renderHeadHtml(t: (k: string) => string, sideCollapsed: boolean): string {
    const toggle = sideCollapsed ?
        `<button class="wengu-btn" data-act="side-toggle" title="${esc(t("sideTitle"))}">»</button>` :
        "";
    return `${toggle}
      <span class="wengu-timer" data-timer title="${esc(t("totalTimeHint"))}">${
        svgIcon("iconClock", "wengu-timer-icon")
    }<span data-timer-text>0:00</span></span>`;
}

/** 次头部信息行入参。 */
export interface SubheadModel {
    t: (key: string) => string;
    doc?: WenguDoc;
    listCount: number;
    /** 历史轮次（N 刷：题量/已刷/最近/最佳）。 */
    rounds: {answered: number; correct: number;}[];
}

/** 文档信息 + 轮次成绩（已刷 N 轮 · 最近 c/a · 最佳 c/a）。 */
export function renderSubheadHtml(m: SubheadModel): string {
    const {t, doc, rounds} = m;
    if (!doc) return "";
    const info = `<span class="wengu-muted">${
        esc(fmt(t("docTitleCount"), {
            title: doc.title || doc.id,
            n: String(doc.total || m.listCount),
        }))
    }</span>${
        doc.attempted > 0 ?
            `<span class="wengu-muted">${
                esc(fmt(t("docProgress"), {
                    a: String(doc.attempted),
                    r: String(doc.rightCount),
                    n: String(doc.total),
                }))
            }</span>` :
            ""
    }`;
    if (rounds.length === 0) return info;
    const last = rounds[rounds.length - 1];
    const best = rounds.reduce(
        (acc, r) =>
            r.answered > 0 && r.correct / r.answered > (acc.answered > 0 ? acc.correct / acc.answered : -1) ?
                r :
                acc,
        last,
    );
    return info +
        `<span class="wengu-muted">${esc(fmt(t("drillRounds"), {n: String(rounds.length)}))}</span>` +
        `<span class="wengu-muted">${
            esc(fmt(t("lastRound"), {c: String(last.correct), a: String(last.answered)}))
        }</span>` +
        `<span class="wengu-muted">${
            esc(fmt(t("bestRound"), {c: String(best.correct), a: String(best.answered)}))
        }</span>`;
}

/** 主区外壳渲染入参（QuizView 组装好各片段后交给这里拼装）。 */
export interface MainShellModel {
    t: (key: string) => string;
    docs: WenguDoc[];
    docId: string;
    sideCollapsed: boolean;
    hasSettingsButton: boolean;
    loading: boolean;
    loadError: string;
    started: boolean;
    hasDoc: boolean;
    listCount: number;
    /** 未开刷时渲染开刷面板。 */
    startPanelHtml?: string;
    subheadHtml: string;
    cardsHtml: string;
    numsHtml: string;
}

/** 面板整体 innerHTML（目录 + 主区，加载/错误/开刷/作答四态）。 */
export function renderMainShell(m: MainShellModel): string {
    const main = (body: string) =>
        `${
            renderSideHtml({
                t: m.t,
                docs: m.docs,
                docId: m.docId,
                sideCollapsed: m.sideCollapsed,
                hasSettingsButton: m.hasSettingsButton,
            })
        }<div class="wengu-main">
    <div class="wengu-head">${renderHeadHtml(m.t, m.sideCollapsed)}</div>
    ${body}
</div>`;
    if (m.loading) {
        return main(`<div class="wengu-muted">${esc(m.t("loading"))}</div>`);
    }
    if (m.loadError) {
        return main(
            `<div class="wengu-status wengu-status-err">${esc(m.t("loadFailed"))}${esc(m.loadError)}</div>`,
        );
    }
    if (m.hasDoc && m.listCount > 0 && !m.started) {
        return main(`
    <div class="wengu-subhead">${m.subheadHtml}</div>
    <div class="wengu-status" data-status hidden></div>
    ${m.startPanelHtml ?? ""}`);
    }
    return main(`
    <div class="wengu-subhead">${m.subheadHtml}</div>
    <div class="wengu-status" data-status hidden></div>
    <div data-timeup-slot></div>
    ${
        !m.hasDoc ?
            `<div class="wengu-muted">${esc(m.t("noExerciseDocs"))}</div>` :
            (m.listCount === 0 ? `<div class="wengu-muted">${esc(m.t("quizNone"))}</div>` : "")
    }
    <div class="wengu-body">${m.numsHtml}<div class="wengu-card-list">${m.cardsHtml}</div></div>
    <div data-report hidden></div>`);
}

/** 题卡列表 HTML（单卡渲染失败给占位卡，不拖垮整个列表）。 */
export function renderCardsHtml(list: WenguQuestion[], m: CardHtmlModel): string {
    return list
        .map((q, i) => {
            try {
                return renderCardHtml(q, i, m);
            } catch (e) {
                return `<div class="wengu-card"><div class="wengu-status wengu-status-err">${
                    esc(String((e as Error)?.message ?? e))
                }</div></div>`;
            }
        })
        .join("");
}

/** 题号导航 HTML（设置关闭或无题时为空）。 */
export function renderNumsHtml(
    list: WenguQuestion[],
    t: (k: string) => string,
    showNums: boolean,
    showPast: boolean,
): string {
    if (!showNums || list.length === 0) return "";
    return `<nav class="wengu-nums" data-nums title="${esc(t("qnumsTitle"))}">${
        list
            .map((q, i) => `<button class="wengu-num${numState(q, showPast)}" data-num="${i + 1}">${i + 1}</button>`)
            .join("")
    }</nav>`;
}
