import type { QuestionBank } from "../../bank/data/QuestionBank";
import { pushSessionAnswer, type WenguSession } from "./HistoryStore";
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

/** 一次作答的**全链记账**（自 QuizView 拆出压 500 行红线，Issue #137）：
 *  会话侧 upsert → 题库侧镜像 → 学伴事件，三件事一个入口。
 *
 *  ⚠️ **重复提交判据必须在 upsert 之前取**（`former`）：after 模式可反复
 *  改答案，同题提交多次时 `pushSessionAnswer` 是覆写、`answered` 不涨，
 *  而题库侧要分流成「首答常规记账」/「覆写 lastAnswer·right，不动 attempts」
 *  （Issue #12 B2）。
 *  ⚠️ `qid#k`（steps/slots 逐空/逐步）**刻意跳过题库**——整题由
 *  `bankMirror` 补记一次（契约「调用方剥后缀」）。 */
export interface RecordAnswerHost {
    /** 进行中会话（无会话=不做任何事）。 */
    currentSession(): WenguSession | undefined;
    /** 本次作答的用时（秒）与全程用时（`TimerController.takeQuestionSec` / `elapsed`）。 */
    takeSec(qid: string): number;
    elapsedSec(): number;
    readonly historyStore?: () => { upsert(s: WenguSession): Promise<void> } | undefined;
    /** 题库（既有访问器 `bankStore`）。 */
    readonly bankStore?: () => QuestionBank | undefined;
    /** 学伴事件（看板娘，含错题讲解上下文）。 */
    notifyAnswer(qid: string, submitted: string, ok: boolean, sec: number): void;
    /** 会话变更落库。 */
    persist(): void;
}

/** 见上。会话计数/时长的写入语义全在 `pushSessionAnswer` 内。 */
export function recordAnswerFor(
    v: RecordAnswerHost,
    qid: string,
    submitted: string,
    ok: boolean,
    extra?: { verdict?: "right" | "partial" | "wrong"; comment?: string; cause?: string }
): void {
    const s = v.currentSession();
    if (!s) return;
    const former = s.results.some((r) => r.qid === qid); // upsert 前先看是否重复提交
    const sec = v.takeSec(qid);
    pushSessionAnswer(s, qid, submitted, ok, sec, v.elapsedSec(), extra);
    void v.historyStore?.()?.upsert(s);
    // 守空在镜像函数内部统一做（与另两个镜像入口同口径）
    if (!qid.includes("#")) {
        if (former) mirrorRepeatAnswer(v.bankStore?.(), qid, submitted, ok);
        else mirrorAnswer(v.bankStore?.(), qid, submitted, ok);
    }
    v.notifyAnswer(qid, submitted, ok, sec);
}
