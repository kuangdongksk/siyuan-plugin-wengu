import { AUTO_GRADE_TYPES, QuestionType } from "../../types";
import type { WenguDoc, WenguQuestion } from "../../types";
import { esc, fmt } from "../../ui/shared";

/**
 * 纯 HTML 构建层（design-review 拆分）：壳拼接与次头部。
 * 只做字符串拼接与谓词判断，不持有状态；QuizView 消费这些函数。
 * 题卡/多步/逐空卡的渲染已组件化（components/QuizCardApp，6-4a；
 * 步骤区运行时 DOM 小件 6-4b 随三写收敛退役），目录/头部 6-5
 * 随 SideMount 组件化退役（SidePanelApp/QuizHeadApp），本文件
 * 保留：题型谓词、题号态、次头部信息行、主区外壳。
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

/** 主区外壳渲染入参（QuizView 组装好各片段后交给这里拼装）。
 *  6-5 起侧栏/头部的入参（docs/专题/搜索词/次头部等）不再经本壳
 *  透传——由 SideMount 从视图直取喂组件，本壳只留主区四态所需。 */
export interface MainShellModel {
    t: (key: string) => string;
    loading: boolean;
    loadError: string;
    started: boolean;
    /** 转换渐进呈现：按作答态渲染卡片但屏蔽作答位（生成中）。 */
    previewing: boolean;
    hasDoc: boolean;
    listCount: number;
    /** 未开刷时渲染开刷面板。 */
    startPanelHtml?: string;
    cardsHtml: string;
    numsHtml: string;
}

/** 面板整体 innerHTML（目录 + 主区，加载/错误/开刷/作答四态）。
 *  6-5 起侧栏与头部改 Svelte 组件挂载（SideMount），这里只放空
 *  占位宿主（data-side-host/data-head-host）；次头部/专题/搜索词等
 *  挂载入参由 SideMount 从视图取，不再经本壳透传。 */
export function renderMainShell(m: MainShellModel): string {
    const main = (body: string) =>
        `<div data-side-host></div><div class="wengu-main">
    <div class="wengu-head" data-head-host></div>
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
    <div data-report hidden></div>
    <div class="wengu-body">${m.numsHtml}<div class="wengu-card-list${
        m.previewing ? " wengu-previewing" : ""
    }">${m.cardsHtml}</div></div>`);
}
