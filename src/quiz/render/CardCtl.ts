import type { AnswerHost } from "../flow/AnswerFlow";
import type { CardUi, ResultStatus } from "./CardState";
import { QuestionType } from "../../types";
import type { WenguQuestion } from "../../types";

/**
 * 题卡控制器（6-4b）：持 CardUi 响应态 + 组件根元素，向三流程与组件
 * 提供统一读写面——流程方法体里写 ctl.ui.* 即触发组件细粒度更新
 * （四件套惯例）。实例由 QuizCardApp 创建并经实例导出 + CardMount
 * 登记表暴露（registerCard），事件编排（提交/判分/申诉）在
 * flow/AnswerFlow|StepsFlow|SlotFlow，本类只放与形态无关的小件。
 */

export class CardCtl {
    readonly host: AnswerHost;
    readonly q: WenguQuestion;
    readonly idx: number;
    readonly ui: CardUi;
    /** 可交互（绑作答事件）：预览/渐进/收卷后的卡为 false。 */
    readonly interactive: boolean;
    /** 组件根元素（scrollIntoView / DOM 扫描兜底用；组件 onMount 绑定）。 */
    el: HTMLElement | undefined;

    constructor(host: AnswerHost, q: WenguQuestion, idx: number, ui: CardUi, interactive: boolean) {
        this.host = host;
        this.q = q;
        this.idx = idx;
        this.ui = ui;
        this.interactive = interactive;
    }

    /* ── 读（旧 readSubmitted/守卫们） ── */

    /** 本次作答串（字母串 / √× / 文本），提交与收口共口径。 */
    submitted(): string {
        if (this.isChoiceCard()) return this.ui.letters;
        if (this.q.type === QuestionType.Judge) return this.ui.judge;
        return this.ui.mine.trim();
    }

    get graded(): boolean {
        return this.ui.graded;
    }

    /** 「思路」草稿（收卷快照 collectThoughts 用）。 */
    thought(): string {
        return this.ui.thought.trim();
    }

    /* ── 写（判分/揭示/恢复路径共用小件） ── */

    /** 判分总闸：置 graded + 锁作答位（旧 dataset.graded + lockInputs）。 */
    setGraded(): void {
        this.ui.graded = true;
        this.ui.locked = true;
    }

    /** 结果行（正文 html + 状态类；icon 前缀渲染派生）。 */
    setResult(html: string, status: ResultStatus): void {
        this.ui.resultHtml = html;
        this.ui.resultStatus = status;
    }

    /** 卡内提示行（纯文本：AI 判分中/用时/失败）。 */
    setNote(text: string): void {
        this.ui.note = text;
    }

    hideNote(): void {
        this.ui.note = "";
    }

    /** 揭示描色（chip/选项 mark 的派生闸）。 */
    reveal(submitted: string): void {
        this.ui.revealed = true;
        this.ui.submitted = submitted;
    }

    /** 自评/改判行。 */
    showSelf(label?: string): void {
        this.ui.selfOn = true;
        if (label) this.ui.selfLabel = label;
    }

    hideSelf(): void {
        this.ui.selfOn = false;
    }

    /** brief AI 判分落账（评语行 + 三态标记）。 */
    setAi(verdict: string, comment: string): void {
        this.ui.aiVerdict = verdict;
        if (comment) this.ui.aiComment = comment;
    }

    /* ── 内部谓词（避免与 CardHtml 循环依赖的本地窄化） ── */

    private isChoiceCard(): boolean {
        return (
            (this.q.type === QuestionType.Single || this.q.type === QuestionType.Multiple) &&
            (this.q.optionMd?.length ?? 0) > 0
        );
    }
}
