import { isObjective, QuestionType } from "../../types";
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

export { isObjective };

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

/** 统计段：数字走 <b>（tabular-nums 在 CSS），其余字符逐字转义。 */
function statSeg(html: string): string {
    return `<span class="wengu-head-seg">${html}</span>`;
}

/** 数字加重（转义 + 包 <b>）。 */
function num(v: string): string {
    return `<b>${esc(v)}</b>`;
}

/** 文档信息 + 轮次成绩（已刷 N 轮 · 最近 c/a · 最佳 c/a）。
 *  Issue #100：输出**结构化分段**供头部统计条样式化——段序
 *  题集名 → 已刷/答对 → 竖线 → 轮次成绩；数字加重，段间竖线只在
 *  **两侧都有内容**时才插（无进度/无轮次时不留悬挂分隔符）；文案仍
 *  全部来自既有 i18n 键，逐字不改（题集名整段逐字转义，不认数字，
 *  免得标题里带数字时被误加重）。 */
export function renderSubheadHtml(m: SubheadModel): string {
    const { t, doc, rounds } = m;
    if (!doc) return "";
    const total = String(doc.total || m.listCount);
    const title = `<span class="wengu-head-seg is-title">${esc(
        fmt(t("docTitleCount"), { title: doc.title || doc.id, n: total })
    )}</span>`;
    // 轮次成绩段（无轮次则整段不出）
    const last: { answered: number; correct: number } | undefined = rounds[rounds.length - 1];
    const best = last
        ? rounds.reduce(
              (acc, r) =>
                  r.answered > 0 && r.correct / r.answered > (acc.answered > 0 ? acc.correct / acc.answered : -1)
                      ? r
                      : acc,
              last
          )
        : undefined;
    // 进度段：只在刷过题时出（含「共 n 题」的重复占位按序喂实参）
    const progress =
        doc.attempted > 0
            ? statSeg(
                  fmt(t("docProgress"), {
                      a: num(String(doc.attempted)),
                      r: num(String(doc.rightCount)),
                      n: num(total),
                  })
              )
            : "";
    if (!last || !best) return title + progress;
    const roundsHtml =
        statSeg(fmt(t("drillRounds"), { n: num(String(rounds.length)) })) +
        statSeg(fmt(t("lastRound"), { c: num(String(last.correct)), a: num(String(last.answered)) })) +
        statSeg(fmt(t("bestRound"), { c: num(String(best.correct)), a: num(String(best.answered)) }));
    // 未刷过（无进度段）时不插空分隔符：轮次段直接接在题集名段之后
    return progress === ""
        ? title + roundsHtml
        : title + progress + '<span class="wengu-head-sep"></span>' + roundsHtml;
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
    /** 阅读面作用域（Issue #83 **结构判据**）：整卷**每段都有材料组**时
     *  挂主区题卡列表（`.wengu-card-list.wengu-reading`），混合刷下材料段
     *  与纯独立题段并存时此处 false、改由段包装逐段挂（QuizShell）。 */
    reading: boolean;
    /** 未开刷时渲染开刷面板。 */
    startPanelHtml?: string;
    cardsHtml: string;
    numsHtml: string;
}

/** 面板整体 innerHTML（目录 + 主区，加载/错误/开刷/作答四态）。
 *  6-5 起侧栏与头部改 Svelte 组件挂载（SideMount），这里只放两个占位
 *  div——`[data-head-host]` 是组件宿主（`.wengu-head` 直挂）；侧栏那颗
 *  `[data-side-host]` **只是挂载锚**（Issue #202 起，锚法：组件根插到锚位
 *  后锚自删），`.wengu-side` 须直接子元素 `.wengu-panel` 才能 stretch 全高。
 *  次头部/专题/搜索词等挂载入参由 SideMount 从视图取，不再经本壳透传。 */
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
    <div class="wengu-body">${m.numsHtml}<div class="wengu-card-list${m.reading ? " wengu-reading" : ""}${
        m.previewing ? " wengu-previewing" : ""
    }">${m.cardsHtml}</div></div>`);
}
