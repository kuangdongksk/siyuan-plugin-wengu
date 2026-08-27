import type { AnswerHost } from "../flow/AnswerFlow";
import type { WenguQuestion } from "../../types";
import { LETTERS } from "../../types";

/**
 * 做题各 Flow（Answer/Steps/Slot）共用的小 DOM 件（2026-08-26 从
 * 三处逐行同构的本地实现收敛）：题号栏标色、卡内提示行、判分选项
 * 描色。PreviewFlow 的描色是「只揭示正确项」的另一语义（类名也不同），
 * 不走 paintOptions。
 */

/** 题号栏标色（判分后）：对绿错红，先摘「已答」态。 */
export function markNum(host: AnswerHost, q: WenguQuestion, ok: boolean): void {
    const n = host.questions().indexOf(q) + 1;
    const btn = host.container().querySelector<HTMLElement>(`.wengu-num[data-num="${n}"]`);
    if (!btn) return;
    btn.classList.remove("wengu-num-answered");
    btn.classList.toggle("wengu-num-right", ok);
    btn.classList.toggle("wengu-num-wrong", !ok);
}

/** 卡内提示行写文本并显示（[data-note] 槽）。 */
export function showNote(card: HTMLElement, text: string): void {
    const note = card.querySelector<HTMLElement>("[data-note]");
    if (!note) return;
    note.textContent = text;
    note.removeAttribute("hidden");
}

/** 卡内提示行隐藏。 */
export function hideNote(card: HTMLElement): void {
    card.querySelector<HTMLElement>("[data-note]")?.setAttribute("hidden", "");
}

/** 判分流选项描色通用形：isRight 命中描 rightCls；submitted 误选描
 *  wrongCls。chip/step/slot 选项结构同构（data-letter 逐项，字母即序号），
 *  类名各 Flow 自带（CSS 已按各自类名分片）。 */
export function paintOptions(
    scope: HTMLElement,
    selector: string,
    isRight: (idx: number) => boolean,
    submitted: string,
    rightCls: string,
    wrongCls: string
): void {
    for (const el of scope.querySelectorAll<HTMLElement>(selector)) {
        const idx = LETTERS.indexOf(el.dataset.letter ?? "");
        if (idx < 0) continue;
        if (isRight(idx)) el.classList.add(rightCls);
        else if (submitted.includes(LETTERS[idx])) el.classList.add(wrongCls);
    }
}
