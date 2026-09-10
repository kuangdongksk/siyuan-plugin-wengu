import type { QuestionBank } from "../../bank/data/QuestionBank";
import {
    overrideAnswer,
    overrideStepsResult,
    recordSlotsResult,
    recordStepsResult,
    recordVerifyResult,
} from "../../bank/data/BankRecording";

/**
 * 题库统计镜像（Issue #12 外移，index.ts 压回 500 红线）：作答记账的
 * bank 侧全部入口——首答常规记账 / after 模式重复提交覆写 / steps·slots
 * 整题收口 / brief 改判。20260831 起运行时统计自托管（唯一真相在题库
 * stats），故这层不是「可选附加」而是记账本体。
 *
 * 全部函数对 `bank` 为 undefined 静默跳过（无题库上下文的视图壳/单测
 * 直接不接），调用侧不必先判空——旧写法 `this.bank!.foo()` 在无 bank
 * 时是异步 TypeError（漏成未捕获拒绝，20260910 修）。
 */

/** steps/slots 整题收口细粒度（自托管后块属性停写，细粒度进题库）。 */
export interface BankMirrorDetail {
    kind: "steps" | "slots";
    letters: string[];
    oks: boolean[];
    persist?: boolean;
}

/** 首次提交（常规记账，attempts+1）。 */
export function mirrorAnswer(bank: QuestionBank | undefined, qid: string, submitted: string, ok: boolean): void {
    if (!bank) return;
    void bank.recordAnswer(qid, submitted, ok);
}

/** after 模式重复提交（改答案）：只覆写 lastAnswer/right，**不动 attempts**
 *  （Issue #12 B2「重复提交记账不重复」）。 */
export function mirrorRepeatAnswer(bank: QuestionBank | undefined, qid: string, submitted: string, ok: boolean): void {
    if (!bank) return;
    void recordVerifyResult(bank, qid, submitted, ok);
}

/** 整题收口镜像（steps/slots 用，qid 已剥 #k 后缀）：按整题记一次。 */
export function mirrorResult(
    bank: QuestionBank | undefined,
    qid: string,
    submitted: string,
    ok: boolean,
    detail?: BankMirrorDetail
): void {
    if (!bank) return;
    if (detail?.kind === "steps")
        void recordStepsResult(bank, qid, detail.letters, detail.oks, detail.persist === true);
    else if (detail?.kind === "slots") void recordSlotsResult(bank, qid, detail.letters, detail.oks);
    else void bank.recordAnswer(qid, submitted, ok);
}

/** 改判镜像（brief 纠错/steps 申诉复核）：只翻 right 微调 wrongCount。 */
export function mirrorOverride(
    bank: QuestionBank | undefined,
    qid: string,
    correct: boolean,
    detail?: { kind: "steps"; letters: string[]; oks: boolean[] }
): void {
    if (!bank) return;
    if (detail?.kind === "steps") void overrideStepsResult(bank, qid, detail.letters, detail.oks);
    else void overrideAnswer(bank, qid, correct);
}
