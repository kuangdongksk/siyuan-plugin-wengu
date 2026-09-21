import type { AnswerHost } from "../flow/AnswerFlow";
import { recordAnswerFor } from "./AnswerMirror";
import { notifyQuizAnswer } from "../../companion";
import type { QTimingOwner } from "./QTimingOwner";
import type { TimerController } from "./TimerController";
import type { WenguQuestion } from "../../types";

/**
 * 记账宿主四件（Issue #182 顺带外移，与 `ConvertAccess` / `MatSplitPrefs`
 * 同款切片）：`recordAnswer` / `takeSec` / `elapsedSec` / `notifyAnswer` 是
 * `RecordAnswerHost`（AnswerMirror）要求的**固定形状**，原本散在 `QuizView`
 * 上占 15 行纯转发；#182 加单题计时后视图逼近行长上限，按先例收进本片。
 */

/** AnswerGate 需要的视图能力（全是既有访问器，零新增状态）。 */
export interface AnswerGateView {
    questions(): WenguQuestion[];
    currentSession(): import("./HistoryStore").WenguSession | undefined;
    historyStore(): import("./HistoryStore").HistoryStore | undefined;
    bankStore(): import("../../bank/data/QuestionBank").QuestionBank | undefined;
    persist(): void;
}

/** 记账宿主四件（RecordAnswerHost 结构匹配；`AnswerHost` 侧只需其中
 *  `recordAnswer`，另三件供 AnswerMirror/通知链）。 */
export interface AnswerGate {
    persist(): void;
    recordAnswer: AnswerHost["recordAnswer"];
    takeSec(qid: string): number;
    elapsedSec(): number;
    notifyAnswer(qid: string, submitted: string, ok: boolean, sec: number): void;
    /** #182 R4：结算后刷卡面（流光定格 + 读数换静态注记）。 */
    refreshQTimer(qid: string): void;
    /** #182：单题计时载体（AnswerHost/TimerHostAccess 两处结构匹配）。 */
    questionTimer(): import("./QuizTimer").QuestionTimer;
}

/** 组装记账宿主（`QuizView` 只需把四件摊回即可）。 */
/** TimerHostAccess 四件的原始状态（视图侧惰性读取，避免构造期求值）。 */
export interface TimerParts {
    activeQid(): string;
    docTotalSec(): number;
    addDocTotal(add: number): void;
    syncSession(elapsed: number): void;
}

export function answerGateFor(v: AnswerGateView, timer: TimerController, qTiming: QTimingOwner): AnswerGate {
    return {
        recordAnswer: (
            qid: string,
            submitted: string,
            ok: boolean,
            extra?: { verdict?: "right" | "partial" | "wrong"; comment?: string; cause?: string }
        ): void => recordAnswerFor(v as never, qid, submitted, ok, extra),
        // R3/R4：优先冻结结算值，无则回落整轮秒表（见 QTimingOwner.takeSec）
        takeSec: (qid: string): number => qTiming.takeSec(qid, () => timer.takeQuestionSec(qid)),
        elapsedSec: (): number => timer.elapsed(),
        notifyAnswer: (qid, submitted, ok, sec): void => notifyQuizAnswer(v as never, qid, submitted, ok, sec),
        persist: (): void => v.persist(),
        refreshQTimer: (qid: string): void => qTiming.refresh(qid),
        questionTimer: (): import("./QuizTimer").QuestionTimer => qTiming.q,
    };
}
