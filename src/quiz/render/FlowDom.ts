import type { AnswerHost } from "../flow/AnswerFlow";
import type { WenguQuestion } from "../../types";
import { markNumRailResult } from "./NumRail";

/**
 * 做题各 Flow（Answer/Steps/Slot）共用的小 DOM 件（2026-08-26 从
 * 三处逐行同构的本地实现收敛）：题号栏标色。卡内提示行与判分选项
 * 描色已随 6-4b 作答态收敛迁进 CardCtl 响应态，此处不再保留。
 */

/** 题号栏标色（判分后）：对绿错红——写进题号栏组件响应态
 *  （NumRailApp.markResult，Svelte 化 20260830 收口三写之一）。
 *
 *  ⚠️ 序号按 **id 反查**，不用 `indexOf(q)`（Issue #131）：展示层洗牌
 *  会给每题换一个新对象（卡拿到的是副本，`v.list` 仍是原件），身份
 *  比对会落空 → 标色静默失效。id 是题的稳定标识，与对象身份无关。 */
export function markNum(host: AnswerHost, q: WenguQuestion, ok: boolean): void {
    markNumRailResult(qIndexById(host, q.id) + 1, ok);
}

/** 题在整卷里的下标（0 基；找不到返回 -1）——按 id 反查，见 markNum 注释。
 *  入参只取 `questions()`（结构匹配），便于单测用最小替身锁住这条口径。 */
export function qIndexById(host: { questions(): WenguQuestion[] }, qid: string): number {
    return host.questions().findIndex((x) => x.id === qid);
}
