import type { AnswerHost } from "../flow/AnswerFlow";
import type { WenguQuestion } from "../../types";
import { markNumRailResult } from "./NumRail";

/**
 * 做题各 Flow（Answer/Steps/Slot）共用的小 DOM 件（2026-08-26 从
 * 三处逐行同构的本地实现收敛）：题号栏标色。卡内提示行与判分选项
 * 描色已随 6-4b 作答态收敛迁进 CardCtl 响应态，此处不再保留。
 */

/** 题号栏标色（判分后）：对绿错红——写进题号栏组件响应态
 *  （NumRailApp.markResult，Svelte 化 20260830 收口三写之一）。 */
export function markNum(host: AnswerHost, q: WenguQuestion, ok: boolean): void {
    markNumRailResult(host.questions().indexOf(q) + 1, ok);
}
