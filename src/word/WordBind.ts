import type { WordGrade } from "./WordStore";
import type { WordView } from "./WordView";

/**
 * 单词面板键盘分发（WordView 拆件，Svelte 化后只保留按键约定）：
 * 鼠标/输入事件已由组件直调控制器，这里只剩挂在容器上的 keydown
 * 分发。按键约定：空格=翻面/继续；选择题 1-4；回想三档 1-3；
 * 拼写框回车=提交；「认成了…」框回车=记录并判不认识。
 */
export function wordKeydown(v: WordView, ev: KeyboardEvent): void {
    const ui = v.ui;
    if (ui.mode !== "card") return;
    const inInput = (ev.target as HTMLElement).tagName === "INPUT";
    if (inInput && ev.code === "Enter" && (ev.target as HTMLElement).dataset.field === "confessed") {
        ev.preventDefault();
        v.confessEnter();
        return;
    }
    const answered = ui.answered !== undefined;
    if (ui.phase === "prompt" && !answered) {
        if (inInput) {
            if (ev.code === "Enter") {
                ev.preventDefault();
                v.submitSpell();
            }
            return;
        }
        if (ev.code === "Space") {
            if (ui.cardMode !== "choiceEn" && ui.cardMode !== "choiceZh" && ui.cardMode !== "spell") {
                ev.preventDefault();
                v.reveal();
            }
            return;
        }
        if ((ui.cardMode === "choiceEn" || ui.cardMode === "choiceZh") && /^Digit[1-4]$/.test(ev.code)) {
            ev.preventDefault();
            v.option(parseInt(ev.code.slice(5), 10) - 1);
        }
        return;
    }
    // 答完待收尾
    if (inInput) return;
    const map: Record<string, WordGrade> = { Digit1: "no", Digit2: "fuzzy", Digit3: "know" };
    const g = map[ev.code];
    if (g) {
        ev.preventDefault();
        v.grade(g);
    } else if ((ev.code === "Space" || ev.code === "Enter") && answered) {
        ev.preventDefault();
        v.continueObjective();
    }
}
