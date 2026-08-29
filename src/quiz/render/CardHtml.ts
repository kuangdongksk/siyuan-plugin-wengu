import { svgIcon } from "../../ui/FormHtml";
import { renderCardHead, renderThoughtArea } from "./CardParts";
import type { CardHtmlModel } from "./CardParts";
import { mdFragmentHtml, optionInline, renderMathIn } from "../service/ProtyleHost";
import { renderSlotsCardHtml } from "./SlotHtml";
import type { WenguQuestion } from "../../types";
import type { WenguStep } from "../../types";
import { AUTO_GRADE_TYPES, hasSlots, hasSteps, isBriefLike, LETTERS, optionDisplayMd, QuestionType } from "../../types";
import type { WenguDoc } from "../../types";
import { esc, fmt, mmss } from "../../ui/shared";
import { buildSideTree, renderSideTree } from "./SideTree";

/**
 * 纯 HTML 构建层（design-review 拆分）：题卡/作答位/目录/头部。
 * 只做字符串拼接与谓词判断，不持有状态；QuizView 消费这些函数。
 * 共享部件（卡头/思路区）在 CardParts；slots 卡渲染在 SlotHtml。
 */

/** 该题是否用字母 chip 作答（单选/多选且转换出了选项子块）。 */
export function isChoice(q: WenguQuestion): boolean {
    return (q.type === QuestionType.Single || q.type === QuestionType.Multiple) && (q.optionMd?.length ?? 0) > 0;
}

/** 客观题（有题型且有答案，可自动判分）；否则走自评流程。 */
export function isObjective(q: WenguQuestion): boolean {
    return q.type !== undefined && AUTO_GRADE_TYPES.includes(q.type) && !!q.answer;
}

/** 题号初始状态类：上次答对绿、答错红（持久化属性）。showPast=false
 *  （统一展示模式 / 设置关闭）时一律中性，不透历史对错。 */
export function numState(q: WenguQuestion, showPast: boolean): string {
    if (!showPast) return "";
    if (q.right === "1") return " wengu-num-right";
    if (q.attempts > 0 && q.right === "0") return " wengu-num-wrong";
    return "";
}

/** 一张题卡：头部元信息 + Protyle 占位（题目内容）+ 作答位。 */
export function renderCardHtml(q: WenguQuestion, idx: number, m: CardHtmlModel): string {
    if (hasSteps(q)) return renderStepsCardHtml(q, idx, m);
    if (hasSlots(q)) return renderSlotsCardHtml(q, idx, m);
    const objective = isObjective(q);
    const { t } = m;
    return `<div class="wengu-card" data-qid="${esc(q.id)}" data-idx="${idx}">
      ${renderCardHead(q, idx, m, objective, m.t)}
      <div class="wengu-qprotyle" data-qprotyle><span class="wengu-muted">…</span></div>
      ${renderAnswerArea(q, m.t)}
      ${renderThoughtArea(m.t)}
      <button class="wengu-btn" data-act="submit">${esc(t("submit"))}</button>
      <div class="wengu-result" data-result hidden></div>
      <div class="wengu-note" data-note hidden></div>
      <div class="wengu-ai-comment" data-ai-comment hidden></div>
      <div class="wengu-self" data-self hidden>
        <span>${esc(t("selfAssess"))}</span>
        <button class="wengu-btn wengu-btn-success" data-act="self-right">${svgIcon("iconCheck")} ${esc(
            t("selfRight")
        )}</button>
        <button class="wengu-btn wengu-btn-error" data-act="self-wrong">${svgIcon("iconClose")} ${esc(
            t("selfWrong")
        )}</button>
      </div>
    </div>`;
}

/** 一张多步引导卡：头部 + Protyle 题干 + 逐步解锁作答区。
 *  步骤引导语/选项内容由 StepsFlow 用 Lute 填充——step-* 子块在
 *  Protyle 渲染里被 CSS 隐藏（防剧透），选项只在解锁后出现。 */
export function renderStepsCardHtml(q: WenguQuestion, idx: number, m: CardHtmlModel): string {
    return `<div class="wengu-card" data-qid="${esc(q.id)}" data-idx="${idx}">
      ${renderCardHead(q, idx, m, false, m.t)}
      <div class="wengu-qprotyle" data-qprotyle><span class="wengu-muted">…</span></div>
      <div class="wengu-steps" data-steps>${renderStepsInnerHtml(q, m.t)}</div>
      ${renderThoughtArea(m.t)}
      <div class="wengu-result" data-result hidden></div>
      <div class="wengu-note" data-note hidden></div>
    </div>`;
}

/** 收集各题卡「思路」输入（qid→思路，空值跳过；收卷快照用）。 */
export function collectCardThoughts(root: ParentNode): Record<string, string> {
    const out: Record<string, string> = {};
    for (const ta of root.querySelectorAll<HTMLTextAreaElement>("[data-field='thought']")) {
        const v = ta.value.trim();
        const card = ta.closest<HTMLElement>(".wengu-card");
        if (v && card?.dataset.qid) out[card.dataset.qid] = v;
    }
    return out;
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
          <span class="wengu-badge wengu-step-kind">${esc(
              step.kind === "method" ? t("stepMethodBadge") : t("stepResultBadge")
          )}</span>
          <span class="wengu-step-stem" data-step-stem></span>
        </div>
        <div class="wengu-step-opts">${step.optionMd
            .map(
                (_, i) =>
                    `<button class="wengu-step-opt" data-letter="${LETTERS[i] ?? ""}">
              <span class="wengu-step-letter">${LETTERS[i] ?? ""}</span>
              <span class="wengu-step-text" data-opt-text></span>
            </button>`
            )
            .join("")}</div>
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
        if (text && step.optionMd[idx]) {
            const { body, tier } = optionInline(optionDisplayMd(step.optionMd[idx]));
            text.innerHTML = body;
            if (tier) opt.classList.add(tier); // 短选项多列档类（opt-compact）
        }
    }
    renderMathIn(stepEl);
}

/** 作答位：选择题字母 chip / 判断按钮 / 填空输入 / 简答·作文·翻译多行。 */
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
    if (isBriefLike(q)) {
        // 作文给更高的输入区 + 实时词数（E3；AnswerFlow 绑定 input 更新）
        const area = `<textarea class="wengu-input" data-field="mine" rows="${
            q.type === QuestionType.Essay ? 10 : 4
        }" placeholder="${ph}"></textarea>`;
        return q.type === QuestionType.Essay
            ? `${area}<div class="wengu-wordcount" data-wordcount>0 words</div>`
            : area;
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
    /** 目录搜索过滤词（按标题/路径包含匹配，空=全部）。 */
    filter: string;
    /** 题库专题清单（空=不渲染专题区；doc: 源卷影子不在此显示，S3 消双显）。 */
    collections: { id: string; title: string; count: number }[];
    /** 当前选中的专题 id（题库模式）。 */
    activeCollection: string;
    /** 展开的树路径集合（搜索态走平铺不用它）。 */
    sideTreeOpen: string[];
}

/** 目录文档清单（空搜索=树形渲染，S1~S3；有搜索词=临时平铺分组便于扫结果）。
 *  单独导出：搜索输入时只刷新这一块，输入框不重建。collections 非空时顶部
 *  先渲染「专题」区（doc: 源卷影子过滤掉——文档树本体已在眼前）。 */
export function renderSideBodyHtml(
    docs: WenguDoc[],
    docId: string,
    t: (key: string) => string,
    filter: string,
    collections: { id: string; title: string; count: number }[] = [],
    activeCollection = "",
    sideTreeOpen: string[] = []
): string {
    const q = filter.trim().toLowerCase();
    const cols = collections.filter((c) => !c.id.startsWith("doc:"));
    const colSection =
        cols.length > 0
            ? `<div class="wengu-side-group">
        <div class="wengu-side-label">${esc(t("collectionsTitle"))}</div>${cols
            .map(
                (c) =>
                    `<div class="wengu-side-item${c.id === activeCollection ? " wengu-side-active" : ""}" data-colid="${esc(
                        c.id
                    )}" title="${esc(c.title)}">
          <div class="wengu-side-title">${esc(c.title)}</div>
          <div class="wengu-side-meta">${esc(fmt(t("collectionCount"), { n: String(c.count) }))}</div>
        </div>`
            )
            .join("")}</div>`
            : "";
    if (!q) {
        // 树形（默认视图）：hPath 建树，展开集合由调用方持有持久化
        if (docs.length === 0)
            return colSection + `<div class="wengu-muted wengu-side-empty">${esc(t("noExerciseDocs"))}</div>`;
        return (
            colSection +
            renderSideTree(buildSideTree(docs), {
                t,
                docId,
                activeCollection,
                openPaths: new Set(sideTreeOpen),
            })
        );
    }
    const groups = new Map<string, WenguDoc[]>();
    for (const d of docs) {
        if (q && !`${d.title}\n${d.hPath}`.toLowerCase().includes(q)) continue;
        const seg = (d.hPath || "").split("/").filter(Boolean);
        seg.pop();
        const key = seg.length ? `/${seg.join("/")}` : "/";
        const arr = groups.get(key) ?? [];
        arr.push(d);
        groups.set(key, arr);
    }
    const items =
        colSection +
        [...groups.entries()]
            .map(
                ([group, gdocs]) =>
                    `<div class="wengu-side-group">
        <div class="wengu-side-label">${esc(group)}</div>${gdocs
            .map((d) => {
                const active = d.id === docId && !activeCollection ? " wengu-side-active" : "";
                const meta = [
                    fmt(t("exerciseCount"), { n: String(d.total) }),
                    d.attempted > 0 ? fmt(t("drilledCount"), { a: String(d.attempted) }) : "",
                    d.totalTime > 0 ? mmss(d.totalTime) : "",
                ]
                    .filter(Boolean)
                    .join(" · ");
                return `<div class="wengu-side-item${active}" data-docid="${esc(d.id)}" title="${esc(
                    d.hPath || d.title
                )}">
          <div class="wengu-side-title">${esc(d.title || d.id)}</div>
          <div class="wengu-side-meta">${esc(meta)}</div>
        </div>`;
            })
            .join("")}</div>`
            )
            .join("");
    if (items) return items;
    return `<div class="wengu-muted wengu-side-empty">${esc(
        docs.length === 0 ? t("noExerciseDocs") : t("sideNoMatch")
    )}</div>`;
}

/** 左侧文档目录：头部图标操作（刷新/设置/收起）+ 顶部工具区（搜索 + AI 转习题）+ 分组清单。 */
export function renderSideHtml(m: SideHtmlModel): string {
    const { t, docId } = m;
    return `<div class="wengu-side${m.sideCollapsed ? " wengu-side-collapsed" : ""}" data-side>
      <div class="wengu-side-head">
        <span>${esc(t("sideTitle"))}</span>
        <span class="wengu-side-headbtns">
          <button class="wengu-side-iconbtn" data-act="refresh" title="${esc(t("quizRefresh"))}">${svgIcon(
              "iconRefresh"
          )}</button>
          ${
              m.hasSettingsButton
                  ? `<button class="wengu-side-iconbtn" data-act="settings" title="${esc(t("settingsBtn"))}">${svgIcon(
                        "iconSettings"
                    )}</button>`
                  : ""
          }
          <button class="wengu-side-iconbtn" data-act="side-fold" title="${esc(t("sideFold"))}">${svgIcon(
              "iconLeft"
          )}</button>
        </span>
      </div>
      <div class="wengu-side-tools">
        <input class="b3-text-field wengu-side-search" data-act="side-search" type="search" spellcheck="false"
          placeholder="${esc(t("sideSearch"))}" value="${esc(m.filter)}">
        <div class="wengu-side-actions">
          <button class="wengu-side-iconbtn" data-act="stats" title="${esc(t("statsTitle"))}">${svgIcon("iconInfo")}</button>
          <button class="wengu-side-iconbtn" data-act="collections" title="${esc(
              t("collectionsBtn")
          )}">${svgIcon("iconList")}</button>
          <button class="b3-button b3-button--outline wengu-side-convert" data-act="convert" title="${esc(
              t("convertBtn")
          )}">${svgIcon("iconSparkles")} <span data-convert-label>${esc(t("convertBtn"))}</span></button>
        </div>
      </div>
      <div class="wengu-side-body" data-side-body>${renderSideBodyHtml(
          m.docs,
          docId,
          t,
          m.filter,
          m.collections,
          m.activeCollection,
          m.sideTreeOpen
      )}</div>
    </div>`;
}

/** 头部：目录开关（收起时）+ 文档信息/轮次成绩 + 「结束本次」（做题中）
 *  + 用时（单行合并；模式入口在开刷面板三按钮，头部不再放切换器）。 */
export function renderHeadHtml(
    t: (key: string) => string,
    sideCollapsed: boolean,
    subhead = "",
    canEndRound = false
): string {
    const toggle = sideCollapsed
        ? `<button class="wengu-btn" data-act="side-toggle" title="${esc(t("sideTitle"))}">${svgIcon(
              "iconRight"
          )}</button>`
        : "";
    const endBtn = canEndRound
        ? `<button class="b3-button b3-button--outline wengu-end-round" data-act="end-round" title="${esc(
              t("endRoundHint")
          )}">${esc(t("endRoundBtn"))}</button>`
        : "";
    return `${toggle}${subhead}${endBtn}
      <span class="wengu-timer" data-timer title="${esc(t("totalTimeHint"))}">${svgIcon(
          "iconClock",
          "wengu-timer-icon"
      )}<span data-timer-text>0:00</span></span>`;
}

/** 次头部信息行入参。 */
export interface SubheadModel {
    t: (key: string) => string;
    doc?: WenguDoc;
    listCount: number;
    /** 历史轮次（N 刷：题量/已刷/最近/最佳）。 */
    rounds: { answered: number; correct: number }[];
}

/** 文档信息 + 轮次成绩（已刷 N 轮 · 最近 c/a · 最佳 c/a）。 */
export function renderSubheadHtml(m: SubheadModel): string {
    const { t, doc, rounds } = m;
    if (!doc) return "";
    const info = `<span class="wengu-muted">${esc(
        fmt(t("docTitleCount"), {
            title: doc.title || doc.id,
            n: String(doc.total || m.listCount),
        })
    )}</span>${
        doc.attempted > 0
            ? `<span class="wengu-muted">${esc(
                  fmt(t("docProgress"), {
                      a: String(doc.attempted),
                      r: String(doc.rightCount),
                      n: String(doc.total),
                  })
              )}</span>`
            : ""
    }`;
    if (rounds.length === 0) return info;
    const last = rounds[rounds.length - 1];
    const best = rounds.reduce(
        (acc, r) =>
            r.answered > 0 && r.correct / r.answered > (acc.answered > 0 ? acc.correct / acc.answered : -1) ? r : acc,
        last
    );
    return (
        info +
        `<span class="wengu-muted">${esc(fmt(t("drillRounds"), { n: String(rounds.length) }))}</span>` +
        `<span class="wengu-muted">${esc(
            fmt(t("lastRound"), { c: String(last.correct), a: String(last.answered) })
        )}</span>` +
        `<span class="wengu-muted">${esc(
            fmt(t("bestRound"), { c: String(best.correct), a: String(best.answered) })
        )}</span>`
    );
}

/** 主区外壳渲染入参（QuizView 组装好各片段后交给这里拼装）。 */
export interface MainShellModel {
    t: (key: string) => string;
    docs: WenguDoc[];
    docId: string;
    sideCollapsed: boolean;
    hasSettingsButton: boolean;
    /** 目录搜索过滤词（透传给目录）。 */
    filter: string;
    /** 侧栏树展开集合（透传给目录）。 */
    sideTreeOpen: string[];
    /** 题库专题清单与选中项（透传给目录）。 */
    collections: { id: string; title: string; count: number }[];
    activeCollection: string;
    loading: boolean;
    loadError: string;
    started: boolean;
    /** 转换渐进呈现：按作答态渲染卡片但屏蔽作答位（生成中）。 */
    previewing: boolean;
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
        `${renderSideHtml({
            t: m.t,
            docs: m.docs,
            docId: m.docId,
            sideCollapsed: m.sideCollapsed,
            hasSettingsButton: m.hasSettingsButton,
            filter: m.filter,
            collections: m.collections,
            activeCollection: m.activeCollection,
            sideTreeOpen: m.sideTreeOpen,
        })}<div class="wengu-main">
    <div class="wengu-head">${renderHeadHtml(m.t, m.sideCollapsed, m.subheadHtml, m.started)}</div>
    ${body}
</div>`;
    if (m.loading) {
        return main(`<div class="wengu-muted">${esc(m.t("loading"))}</div>`);
    }
    if (m.loadError) {
        return main(`<div class="wengu-status wengu-status-err">${esc(m.t("loadFailed"))}${esc(m.loadError)}</div>`);
    }
    if (m.hasDoc && m.listCount > 0 && !m.started && !m.previewing) {
        return main(`
    <div class="wengu-status" data-status hidden></div>
    ${m.startPanelHtml ?? ""}`);
    }
    return main(`
    <div class="wengu-status" data-status hidden></div>
    <div data-timeup-slot></div>
    ${
        !m.hasDoc
            ? `<div class="wengu-muted">${esc(m.t("noExerciseDocs"))}</div>`
            : m.listCount === 0
              ? `<div class="wengu-muted">${esc(m.t("quizNone"))}</div>`
              : ""
    }
    <div class="wengu-body">${m.numsHtml}<div class="wengu-card-list${
        m.previewing ? " wengu-previewing" : ""
    }">${m.cardsHtml}</div></div>
    <div data-report hidden></div>`);
}

/** 题卡列表 HTML（单卡渲染失败给占位卡，不拖垮整个列表）。 */
export function renderCardsHtml(list: WenguQuestion[], m: CardHtmlModel): string {
    return list
        .map((q, i) => {
            try {
                return renderCardHtml(q, i, m);
            } catch (e) {
                return `<div class="wengu-card"><div class="wengu-status wengu-status-err">${esc(
                    String((e as Error)?.message ?? e)
                )}</div></div>`;
            }
        })
        .join("");
}

/** 题号导航 HTML（设置关闭或无题时为空）。 */
export function renderNumsHtml(
    list: WenguQuestion[],
    t: (k: string) => string,
    showNums: boolean,
    showPast: boolean
): string {
    if (!showNums || list.length === 0) return "";
    return `<nav class="wengu-nums" data-nums title="${esc(t("qnumsTitle"))}">${list
        .map((q, i) => `<button class="wengu-num${numState(q, showPast)}" data-num="${i + 1}">${i + 1}</button>`)
        .join("")}</nav>`;
}

/** 目录搜索：只重绘清单块（输入框不重建、焦点不丢）。 */
export function applySideFilter(
    el: HTMLElement,
    docs: WenguDoc[],
    docId: string,
    t: (key: string) => string,
    text: string,
    collections: { id: string; title: string; count: number }[] = [],
    activeCollection = "",
    sideTreeOpen: string[] = []
): void {
    const body = el.querySelector("[data-side-body]");
    if (body) body.innerHTML = renderSideBodyHtml(docs, docId, t, text, collections, activeCollection, sideTreeOpen);
}
