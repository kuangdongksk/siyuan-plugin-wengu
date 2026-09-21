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
import { checkBatch, qcSummary, type CheckDraft, type JevQcSuspect } from "../../../ai/jev/convertChecks";
import { isJevEnabled } from "../../../ai/jev/enabled";
import type { ConvertQc } from "./ConvertBatchModel";

/** 质检设置的最小面（与 `ai/jev/enabled` 的 `JevSettingsLike` 同口径）。 */
export interface QcSettings {
    jevKey?: string;
    jevEnabled?: boolean;
}

/** 跨批的质检累计器（内存态，不落盘）。 */
export class QcAcc {
    /** 已判定的题目数。 */
    checked = 0;
    /** 有存疑项的批数。 */
    suspectBatches = 0;
    /** 存疑项清单（顺序即出现顺序）。 */
    suspects: JevQcSuspect[] = [];

    /** 收口载荷：**无存疑时不给 `qc` 键**（既有结果形状逐字节不变）。 */
    payload(): { qc?: ConvertQc } {
        if (this.suspects.length === 0) return {};
        return { qc: { checked: this.checked, suspectBatches: this.suspectBatches, suspects: this.suspects } };
    }

    /** 完成消息尾巴（无存疑/未判定 → 空串，调用方据此零拼接）。 */
    tail(t: (k: string) => string): string {
        if (this.suspects.length === 0) return "";
        return qcSummary(t, { checked: this.checked, suspects: this.suspects });
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
    if (report.suspects.length > 0) acc.suspectBatches++;
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
        // 续跑时题集保持原样按完成收口；全新转换按无题失败
        return f.setId
            ? { ...done(t("convertResumeSettled"), 0, f.srcLen), setId: f.setId, title: f.title }
            : {
                  status: "failed",
                  message: f.refusedMessage,
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
