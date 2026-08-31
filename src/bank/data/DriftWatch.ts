import type { QuestionBank, DriftEntry } from "./QuestionBank";
import { refreshDocFor } from "./BankMigrate";
import { questionHash } from "./BankParse";
import { getBlockKramdown, listQuestions } from "../../quiz/service/QuestionService";

/**
 * 题目镜像漂移检测（数据自托管二期，20260831）：题库记录的 hash 就是
 * 「入库时文档题块的内容指纹基线」（questionHash 归一化剥运行时统计，
 * 作答不再扰动指纹）。dryRunDoc 重拉文档题块重算指纹与基线比对——
 * 只比不写；漂移落 BankData.driftDocs 供 UI 徽标与「采纳/忽略」弹窗
 * 消费。检测时机：ws-main update 事务防抖（内核广播块编辑，root 命中
 * migratedDocs 才扫）。插件自身写（挂引用/转换落盘）先更新 record.hash
 * 再落块，dry-run 得「相同」天然免疫。
 */

/** 一次 dry-run 的三态比对结果（gen- 生成题无文档块，天然跳过）。 */
export interface DriftDiff {
    /** 文档块指纹 ≠ 题库基线（用户手改了题）。 */
    changed: string[];
    /** 文档有、题库无（手贴新题未入库）。 */
    fresh: string[];
    /** 题库有、文档已无（题块被删，记录滞留）。 */
    gone: string[];
}

/** 比对一个习题文档的题块现状与题库镜像（只读不写；文档读取失败返回
 *  undefined，与 refreshDocFor 的容错口径一致）。 */
export async function dryRunDoc(bank: QuestionBank, docId: string): Promise<DriftDiff | undefined> {
    const data = await bank.all();
    let alive: { id: string }[];
    try {
        alive = await listQuestions(docId);
    } catch (_) {
        return undefined;
    }
    const diff: DriftDiff = { changed: [], fresh: [], gone: [] };
    const seen = new Set<string>();
    for (const q of alive) {
        seen.add(q.id);
        let kd: string;
        try {
            kd = await getBlockKramdown(q.id);
        } catch (_) {
            continue;
        }
        const rec = data.records[q.id];
        if (!rec) {
            diff.fresh.push(q.id);
        } else if (rec.hash !== questionHash(kd)) {
            diff.changed.push(q.id);
        }
    }
    for (const [qid, r] of Object.entries(data.records)) {
        if (r.sourceDocId === docId && !qid.startsWith("gen-") && !seen.has(qid)) diff.gone.push(qid);
    }
    return diff;
}

/** 检测并落登记：三类空=删条目（漂移被用户/重扫自行解决），非空=写
 *  driftDocs（幂等——每次 update 事务重算覆盖）。 */
export async function runDriftCheck(bank: QuestionBank, docId: string): Promise<void> {
    const diff = await dryRunDoc(bank, docId);
    if (!diff) return;
    const data = await bank.all();
    const total = diff.changed.length + diff.fresh.length + diff.gone.length;
    if (total === 0) {
        if (data.driftDocs?.[docId]) {
            delete data.driftDocs[docId];
            bank.markDirty();
        }
        return;
    }
    const entry: DriftEntry = { ...diff, updatedAt: Date.now() };
    if (!data.driftDocs) data.driftDocs = {};
    const prev = data.driftDocs[docId];
    if (
        prev &&
        prev.changed.length === entry.changed.length &&
        prev.fresh.length === entry.fresh.length &&
        prev.gone.length === entry.gone.length
    ) {
        return; // 同构漂移不重复落盘（防抖窗口内重复触发常见）
    }
    data.driftDocs[docId] = entry;
    bank.markDirty();
}

/** 用户决策收口：adopt=重扫入库（changed/fresh/gone 三类一次收编，
 *  stats 保留——作答统计是行为数据不随内容变）；两者都清登记。 */
export async function resolveDrift(bank: QuestionBank, docId: string, mode: "adopt" | "ignore"): Promise<void> {
    if (mode === "adopt") await refreshDocFor(bank, docId);
    const data = await bank.all();
    if (data.driftDocs?.[docId]) {
        delete data.driftDocs[docId];
        bank.markDirty();
    }
    await bank.flush();
}

/** 漂移总数（UI 徽标文案用）。 */
export function driftCountOf(e: DriftEntry | undefined): number {
    return e ? e.changed.length + e.fresh.length + e.gone.length : 0;
}
