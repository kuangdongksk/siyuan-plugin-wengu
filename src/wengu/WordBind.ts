import type { WordGrade } from "./WordStore";

/**
 * 单词面板事件绑定（WordView 拆件）：DOM 委托与按键分发在此，
 * 语义动作通过 host 回调交还视图，视图不再持有监听器细节。
 *
 * 按键约定：空格=翻面/继续；选择题 1-4；
 * 回想三档 1-3；拼写框回车=提交；「认成了…」框回车=记录并判不认识。
 */

/** 视图侧需要暴露给按键分发的会话状态快照。 */
export interface WordBindState {
    mode: string;
    phase: "prompt" | "result";
    cardMode: string;
    answered: boolean;
    answeredCorrect?: boolean;
}

/** 视图侧语义回调全集。 */
export interface WordBindHost {
    state(): WordBindState;
    /** data-act 动作（goreview/gofresh/…/next/markwrong/mastered/star/…）。 */
    act(name: string, dataset: DOMStringMap): void;
    /** 选择题选项（no 从 0 起）。 */
    option(no: number): void;
    /** 三档/四档收尾。 */
    grade(g: WordGrade): void;
    /** learn/recall 未翻面点卡或空格 → 显示答案。 */
    reveal(): void;
    /** 拼写框回车/提交按钮。 */
    submitSpell(): void;
    /** 「认成了…」输入框回车 → 记录并判不认识。 */
    confessEnter(): void;
    /** 客观题作答后空格/回车 → 继续（对 know/错 no）。 */
    continueObjective(): void;
    /** 进度导入文件选中（起点面板的文件框）。 */
    importFile(file: File, input: HTMLInputElement): void;
    /** 查词输入变化。 */
    lookupInput(value: string): void;
    /** 易混辨析笔记草稿输入（查词详情，不重绘）。 */
    /** 笔记草稿输入（field: confnote/wordnote，不重绘）。 */
    noteInput(field: string, value: string): void;
}

/** 绑定点击、键盘、输入与文件选择（容器上委托，重渲染不用重绑）。 */
export function bindWordEvents(el: HTMLElement, host: WordBindHost): void {
    el.addEventListener("change", (ev) => {
        const target = ev.target as HTMLElement;
        if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "file") {
            const input = target as HTMLInputElement;
            if (input.files?.[0]) host.importFile(input.files[0], input);
            return;
        }
        if (target.tagName === "SELECT" && target.dataset.field === "groupsize") {
            host.act("setgroupsize", { value: (target as HTMLSelectElement).value });
        }
    });
    el.addEventListener("input", (ev) => {
        const input = ev.target as HTMLInputElement;
        if (input.dataset.field === "lookup") host.lookupInput(input.value);
        else if (input.dataset.field === "confnote" || input.dataset.field === "wordnote") {
            host.noteInput(input.dataset.field, input.value);
        }
    });
    el.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement;
        const optBtn = target.closest<HTMLElement>("[data-opt]");
        if (optBtn) {
            host.option(parseInt(optBtn.dataset.opt ?? "0", 10));
            return;
        }
        const gradeBtn = target.closest<HTMLElement>("[data-grade]");
        if (gradeBtn) {
            host.grade((gradeBtn.dataset.grade as WordGrade) ?? "know");
            return;
        }
        const actBtn = target.closest<HTMLElement>("[data-act]");
        if (actBtn) {
            host.act(actBtn.dataset.act ?? "", actBtn.dataset);
            return;
        }
        if (target.closest(".wengu-word-card")) host.reveal();
    });
    el.addEventListener("keydown", (ev) => {
        const s = host.state();
        if (s.mode !== "card") return;
        const inInput = (ev.target as HTMLElement).tagName === "INPUT";
        if (inInput && ev.code === "Enter" && (ev.target as HTMLElement).dataset.field === "confessed") {
            ev.preventDefault();
            host.confessEnter();
            return;
        }
        if (s.phase === "prompt" && !s.answered) {
            if (inInput) {
                if (ev.code === "Enter") {
                    ev.preventDefault();
                    host.submitSpell();
                }
                return;
            }
            if (ev.code === "Space") {
                if (s.cardMode !== "choiceEn" && s.cardMode !== "choiceZh" && s.cardMode !== "spell") {
                    ev.preventDefault();
                    host.reveal();
                }
                return;
            }
            if ((s.cardMode === "choiceEn" || s.cardMode === "choiceZh") && /^Digit[1-4]$/.test(ev.code)) {
                ev.preventDefault();
                host.option(parseInt(ev.code.slice(5), 10) - 1);
            }
            return;
        }
        // 答完待收尾
        if (inInput) return;
        const map: Record<string, WordGrade> = { Digit1: "no", Digit2: "fuzzy", Digit3: "know" };
        const g = map[ev.code];
        if (g) {
            ev.preventDefault();
            host.grade(g);
        } else if ((ev.code === "Space" || ev.code === "Enter") && s.answered) {
            ev.preventDefault();
            host.continueObjective();
        }
    });
}
