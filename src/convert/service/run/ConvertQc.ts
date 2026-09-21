/**
 * 转换质检的**编排侧收口**（Issue #184 自 `ConvertBatch` 抽出压行数红线）：
 * 把「逐批判定 → 只累计存疑 → 收口载荷/报告尾巴」这段搬出主流程，
 * `ConvertBatch` 只留一行调用。四段职责都在这里，主流程不再各写一遍：
 *  1. {@link QcAcc}：跨批计数器（判定数 / 存疑批数 / 存疑项）与载荷/尾巴；
 *  2. {@link judgeBatch}：一键判定（总闸关＝零请求；失败＝空报告）；
 *  3. {@link terminalOf}：三条终态的收口拼装（同样只在有存疑时带 `qc` 键）；
 *  4. {@link qcOf}：收尾事件载荷的条件展开。
 *
 * **零行为变化**是硬口径：没配 key / 总开关关 / 判定失败时，`judgeBatch`
 * 不累计任何东西 ⇒ 载荷不给 `qc` 键、尾巴是空串，转换结果与文案逐字节不变。
 */
import {
    checkBatch,
    dedupeSuspects,
    qcSummary,
    type CheckDraft,
    type JevQcSuspect,
} from "../../../ai/jev/convertChecks";
import { screenChunks } from "../../../ai/jev/chunkScreen";
import { isJevEnabled } from "../../../ai/jev/enabled";
import { fmt } from "../../../ui/shared";
import type { ConvertQc } from "./ConvertBatchModel";

/** 质检设置的最小面（与 `ai/jev/enabled` 的 `JevSettingsLike` 同口径）。 */
export interface QcSettings {
    jevKey?: string;
    jevEnabled?: boolean;
}

/**
 * 切片预筛的**编排侧累计器**（Issue #186 A2，整卷链）：整卷链的窗口是逐批
 * 自推进的、事前不知道，做不到「生成之前批量问完」，故按**窗口**问
 * （一次请求问一片，纪律 5 的「一片一问」），本类把「问过几片、跳过几片」
 * 收在一处。
 *
 * 与增量链共用 `ai/jev/chunkScreen.ts` 的判定层（阈值与回落口径同源）；
 * 本类只管**计数与回落**：
 *  - 总闸关 → 一次请求都不发、恒回 false（零行为变化）；
 *  - 判定失败/低置信 → 恒回 false（`screenChunks` 内部已按「一个都不跳」回落）。
 */
export class ScreenAcc {
    /** 判定为「没料」而跳过的窗口数（0 = 零跳过 ⇒ 报告零追加）。 */
    skipped = 0;

    /** 本窗口该不该跳（供片执行器在生成之前调用）。 */
    windowOf(text: string, settings: QcSettings | undefined): Promise<boolean> {
        return this.judge(text, settings);
    }

    private async judge(text: string, settings: QcSettings | undefined): Promise<boolean> {
        if (!isJevEnabled(settings)) return false;
        try {
            const out = await screenChunks([{ key: "", text }], { apiKey: settings?.jevKey });
            this.skipped += out.skipped;
            return out.verdicts[0]?.skip === true;
        } catch (_) {
            // 兜底（`screenChunks` 内部已逐批接住）：预筛的任何意外都**不许**
            // 变成整卷转换的失败——不跳即现状行为
            return false;
        }
    }

    /** 完成消息尾巴（零跳过/未启用 → 空串，调用方据此零拼接）。 */
    tail(t: (k: string) => string): string {
        if (this.skipped === 0) return "";
        return `${t("jevScreen")}${fmt(t("jevScreenSkipped"), { n: String(this.skipped) })}`;
    }
}

/** 跨批的质检累计器（内存态，不落盘）。 */
export class QcAcc {
    /** 已判定的题目数。 */
    checked = 0;
    /** 存疑项清单（顺序即出现顺序）。 */
    suspects: JevQcSuspect[] = [];
    /** 切片预筛（Issue #186 A2）：与质检**同一次运行、同一份设置**，
     *  故挂在这里（少一个跨层传参；两者都只累计内存态、都不落盘）。 */
    screen = new ScreenAcc();

    /** 存疑项去重后的清单（同一毛病在多批出现 = 一个结论，别复读）。 */
    list(): JevQcSuspect[] {
        return dedupeSuspects(this.suspects);
    }

    /** 收口载荷：**无存疑时不给 `qc` 键**（既有结果形状逐字节不变）。 */
    payload(): { qc?: ConvertQc } {
        const suspects = this.list();
        if (suspects.length === 0) return {};
        return { qc: { checked: this.checked, suspects } };
    }

    /** 完成消息尾巴（无存疑且零跳过 → 空串，调用方据此零拼接）。
     *  两段各自独立：质检段管存疑项、预筛段管跳过计数（两者都不落盘）。 */
    tail(t: (k: string) => string): string {
        const qc = this.list().length > 0 ? qcSummary(t, { checked: this.checked, suspects: this.suspects }) : "";
        const screen = this.screen.tail(t);
        return [qc, screen].filter(Boolean).join(" · ");
    }
}

/**
 * 判定一批并累计结果（**不抛错**：失败即视为未判定）。
 * `settings` 缺省或 `isJevEnabled` 为假 → 直接返回（**零请求**）。
 */
export async function judgeBatch(
    acc: QcAcc,
    batch: { drafts: CheckDraft[]; materialText: string },
    settings: QcSettings | undefined
): Promise<void> {
    if (!isJevEnabled(settings)) return;
    const report = await checkBatch({ ...batch, apiKey: settings?.jevKey });
    if (report.checked === 0) return; // 未判定（失败/无题）＝本批无痕
    acc.checked += report.checked;
    acc.suspects.push(...report.suspects);
}

/** {@link terminalOf} 的事实快照（收口那一刻的既有局部变量）。 */
export interface TerminalFacts {
    /** 用户终止（true 走 aborted，否则 failed）。 */
    aborted: boolean;
    /** AI 失败原因（空=无错）。 */
    firstError: string;
    /** 全程零产物（题与材料都没有）。 */
    noProducts: boolean;
    /** 已落库题数 / 题集 id / 标题。 */
    count: number;
    setId?: string;
    title?: string;
    /** 已落库连续前缀末尾（terminated 的断点）与源文长度（零产物/done 的断点）。 */
    cursor: number;
    srcLen: number;
    /** done 的完成消息（`doneMessageOf` 产物；质检尾巴在这里拼）。 */
    message: string;
    /** 零产物且无题集时的失败文案（首片首批拒收原因或「无有效题目块」）。 */
    refusedMessage: string;
}

/**
 * 三条终态的收口（Issue #184 自 `ConvertBatch` 抽出压红线）：各给一个
 * `BatchedResult`，**统一经 `payload()` 带上质检载荷**（无存疑时不给 `qc`
 * 键——三条分支与改造前逐字节一致）。纯拼装：不写库、不发通知。
 * `aiBatches` = 各片 AI 调用批数之和（与「已落库批数」分账，见主流程）。
 */
export function terminalOf(
    t: (k: string) => string,
    acc: QcAcc,
    f: TerminalFacts,
    aiBatches: number,
    writtenQids: string[]
): import("./ConvertBatchModel").BatchedResult {
    const done = (message: string, count: number, offset: number): import("./ConvertBatchModel").BatchedResult => ({
        status: "done",
        message,
        setId: f.setId!,
        title: f.title,
        count,
        batches: aiBatches,
        total: aiBatches,
        doneOffset: offset,
        writtenQids,
        ...acc.payload(),
    });
    if (f.aborted || f.firstError) {
        return {
            status: f.aborted ? "aborted" : "failed",
            message: f.aborted ? "" : `${t("convertAiFailed")}${f.firstError}`,
            count: f.count,
            batches: aiBatches,
            total: aiBatches,
            doneOffset: f.cursor,
            setId: f.setId,
            title: f.setId ? f.title : undefined,
            writtenQids,
            ...acc.payload(),
        };
    }
    if (f.noProducts) {
        // 续跑时题集保持原样按完成收口；全新转换按无题失败。
        // ⚠️ 零产物**也要带上预筛尾巴**（Issue #186 A2）：全被预筛跳过时，
        // 用户看到的不能只是「无有效题目块」——那会像「源文档没内容」；
        // 必须说清「Jev 预筛跳过 N 块」。零跳过时尾巴为空串 ⇒ 逐字不变。
        const screenTail = acc.tail(t);
        const withTail = (m: string): string => m + (screenTail ? (m ? ` ｜ ${screenTail}` : screenTail) : "");
        return f.setId
            ? {
                  ...done(withTail(t("convertResumeSettled")), 0, f.srcLen),
                  setId: f.setId,
                  title: f.title,
              }
            : {
                  status: "failed",
                  message: withTail(f.refusedMessage),
                  count: 0,
                  batches: 0,
                  total: 0,
                  doneOffset: 0,
                  writtenQids: [],
              };
    }
    const tail = acc.tail(t);
    return done(f.message + (tail ? ` ｜ ${tail}` : ""), f.count, f.srcLen);
}

/** 收尾载荷里的质检字段（Issue #184）：**无存疑/未启用时返回空对象**
 *  ——调用方 `{...qcOf(r)}` 展开后 `qc` 键不出现（既有结果形状逐字节不变）。 */
export function qcOf(r: { qc?: ConvertQc }): { qc?: ConvertQc } {
    return r.qc ? { qc: r.qc } : {};
}
