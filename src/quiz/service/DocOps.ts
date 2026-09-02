import { showStatus, startConvertForView, convertRunEventsFor } from "../../convert";
import { convertRunActive, startExclusiveConvertRun, type ConvertRunCfg } from "../../convert/service/ConvertRun";
import { extractBlockId, getDocInfo } from "../../convert/service/ConvertService";
import { classifyChunks, type SrcGroup } from "../../convert/service/SrcChunk";
import { convertIncremental, sourceChunksOf } from "../../convert/service/ConvertIncrement";
import { keepOldChoice, openIncrementDialog, type IncrementChoice } from "../../convert/ui/IncrementDialog";
import { readRecordSrcGroups } from "../../bank/data/BankSets";
import { esc, fmt } from "../../ui/shared";
import { notifyInfo } from "../../ui/Notify";
import type { QuizView } from "../index";

/**
 * 目录题集右键「删除此题集」/「重新导入」（自 QuizView 拆出）：
 * - 删除此题集（20260903 起）：题集是题库内实体——清记录/元数据/材料/
 *   影子专题/会话历史即删净（docStats 一并随 removeDocData 口径保留，
 *   旧文档形态的存量题集不动文档本体）。
 * - 重新导入：网络中断等「导一半」的题集一键续做——查该源的续跑记录
 *   （prefs convertProgress），有则接着断点续写**同一题集**（已生成部分
 *   是题库里的真实记录，不重复生成、不重复花费）、无则清旧题集从头
 *   重转（新题集）。
 *
 * 内核调用全程尽力而为，失败停在中间态由下次操作重试。
 */

/** 严格块 id 形态（知识点根过滤用，同转换弹窗口径）。 */
const BLOCK_ID_RE = /^\d{14}-[a-z0-9]+$/i;

/** 题集配对的源讲义 id（set.srcId；无配对/自配对为空）。 */
export async function pairedSourceOf(v: QuizView, setId: string): Promise<string> {
    const bank = v.bankStore();
    if (!bank || !setId) return "";
    const data = await bank.all();
    const src = data.sets?.[setId]?.srcId ?? "";
    return src && src !== setId ? src : "";
}

/** 配对源讲义 id 且仍存活（右键菜单按它决定是否露出「重新导入」；
 *  查询失败按无源收口——fail-closed，不露出不可用的入口）。 */
export async function livingSourceOf(v: QuizView, setId: string): Promise<string> {
    try {
        const src = await pairedSourceOf(v, setId);
        if (!src) return "";
        const info = await getDocInfo(extractBlockId(src));
        return info?.notebook ? src : "";
    } catch (_) {
        return "";
    }
}

/** 「删除此题集」：清题库侧数据（记录/题集/材料/影子专题）+ 清会话
 *  历史后重载。 */
export function unregisterSetAsQuiz(v: QuizView, setId: string): void {
    void (async () => {
        if (convertRunActive()) {
            showStatus(v.el, v.t("convertBusy"), "err");
            return;
        }
        if (!setId) return;
        await v.bankStore()?.removeDocData(setId);
        await v.bankStore()?.flush();
        await v.historyStore()?.removeDocs([setId]);
        await v.reloadView(); // 选中回退链（当前>记住>活动>第一个）自动切离
    })();
}

/** 重新导入的续跑参数（纯决策）：进度记录带题集 id 才有断点可接——
 *  已生成部分是题库里的真实记录（每批已 flush），续写同一题集。 */
export function reimportResume(
    rec: { offset: number; setId?: string } | undefined
): { offset: number; setId?: string } | undefined {
    return rec?.setId ? { offset: rec.offset, setId: rec.setId } : undefined;
}

/** 重新导入的转换参数（弹窗默认同款解析：prefs 上次 > 设置默认）。
 *  有续跑记录则接着上次断点续跑（已生成部分保留），无记录才从头重转。 */
export function reimportCfg(
    srcDocId: string,
    last: { modelId: string; fill: boolean; steps: boolean; know: string },
    settings?: { convertModelId?: string; fillToChoice?: boolean; bigToSteps?: boolean; convertParallel?: number },
    resume?: { offset: number; setId?: string }
): ConvertRunCfg {
    return {
        srcDocId,
        modelId: last.modelId || settings?.convertModelId || "",
        fillToChoice: last.fill || settings?.fillToChoice === true,
        bigToSteps: last.steps || settings?.bigToSteps === true,
        parallel: Math.max(1, Math.min(4, Math.floor(settings?.convertParallel ?? 1))),
        knowRoots: last.know
            .split(/[\s,;，；]+/)
            .map((s) => extractBlockId(s))
            .filter((s) => BLOCK_ID_RE.test(s)),
        resume,
    };
}

/**
 * 「重新导入」＝检测断点续跑，而非无条件全量重转：
 * 0. **增量重转换**（增量哈希二期）：整卷完成态（无续跑记录）且题集
 *    记录带 src-hash 指纹 → 不删旧重转——重新结构切块比对三态分类，
 *    相同跳过（保原题与刷题统计）、新增补生成、变更/消失逐块选（省费
 *    模式 convertKeepOld=全保留只补新增）。中止后已入库记录自带指纹，
 *    重跑分类即跳过（自愈，无续跑记录负担）。
 * 1. 配对源讲义查得到续跑记录（prefs convertProgress）→ 接着断点续写
 *    同一题集（已生成部分是题库真实记录，随取随用，无读回步骤）。
 * 2. 完全没有续跑记录 → 清旧题集数据后从头重转（新题集）。
 */
export function reimportDocFrom(v: QuizView, setId: string): void {
    void (async () => {
        if (convertRunActive()) {
            showStatus(v.el, v.t("convertBusy"), "err");
            return;
        }
        const bank = v.bankStore();
        if (!bank) return;
        const srcId = await livingSourceOf(v, setId);
        if (!srcId) {
            showStatus(v.el, v.t("reimportNoSource"), "err");
            return;
        }
        const rec = v.convertAccess.convertProgressOf(srcId);
        // 增量分支（二期）：完成态 + 带指纹的题集走三态分类，不删旧题集
        if (!rec) {
            const groups = await readRecordSrcGroups(bank, setId).catch((): SrcGroup[] => []);
            if (groups.length > 0) {
                await runIncrementalReimport(v, setId, srcId, groups);
                return;
            }
        }
        // 续跑：保留同一题集接着写；全量重转：先清旧题集侧数据
        const resume = reimportResume(rec);
        if (!resume) {
            await bank.removeDocData(setId);
            await bank.flush();
            await v.historyStore()?.removeDocs([setId]);
        }
        v.convertAccess.saveConvertProgress(srcId, undefined);
        await v.reloadView(); // 侧栏先摘掉旧题集，转换条/渐进呈现落在新 DOM 上
        const started = startConvertForView(
            v.convertAccess,
            reimportCfg(srcId, v.convertAccess.lastConvert(), v.settingsOf(), resume)
        );
        if (!started) showStatus(v.el, v.t("convertBusy"), "err"); // reload 间隙被抢跑的兜底
    })();
}

/**
 * 增量重转换分支（二期）：源文档重新结构切块 → 与题集旧分组三态分类。
 * 全部相同=零成本收口；有变更时省费模式（settings.convertKeepOld）
 * 直通「只补新增」，否则弹窗逐块选。执行占独占运行槽（页内转换条
 * 呈现进度、可停止），产物直写题库（SetWriter）+ 视图重载。
 */
async function runIncrementalReimport(v: QuizView, setId: string, srcId: string, groups: SrcGroup[]): Promise<void> {
    const t = v.t;
    const bank = v.bankStore();
    if (!bank) return;
    let chunks;
    try {
        chunks = await sourceChunksOf(srcId);
    } catch (e) {
        showStatus(v.el, String((e as Error)?.message ?? e), "err");
        return;
    }
    if (chunks.length === 0) {
        showStatus(v.el, t("convertEmptyDoc"), "err");
        return;
    }
    const plan = classifyChunks(groups, chunks);
    if (plan.fresh.length === 0 && plan.changed.length === 0 && plan.removed.length === 0) {
        showStatus(v.el, fmt(t("reimportUnchanged"), { n: String(plan.same) }), "ok");
        return;
    }
    const start = (choice: IncrementChoice): void => {
        const cfg = reimportCfg(srcId, v.convertAccess.lastConvert(), v.settingsOf());
        const ev = convertRunEventsFor(v.convertAccess);
        const set = bank.peek()?.sets?.[setId];
        const started = startExclusiveConvertRun(ev, srcId, async (signal) => {
            ev.onStatus(esc(t("incrPreparing")), "muted");
            let res;
            let failed = "";
            try {
                res = await convertIncremental({
                    deleteQids: choice.deleteQids,
                    staleQids: choice.staleQids,
                    chunks: choice.chunks,
                    setId,
                    bank,
                    title: set?.title,
                    modelId: cfg.modelId,
                    fillToChoice: cfg.fillToChoice,
                    bigToSteps: cfg.bigToSteps,
                    knowRoots: cfg.knowRoots,
                    signal,
                    onProgress: (p) =>
                        ev.onStatus(
                            esc(
                                fmt(t("incrRunning"), {
                                    i: String(Math.min(p.done + 1, p.total)),
                                    n: String(p.total),
                                    c: String(p.count),
                                })
                            ),
                            "muted"
                        ),
                });
            } catch (e) {
                failed = String((e as Error)?.message ?? e);
            }
            // 题库写入由 convertIncremental 逐块 flush；中止/失败已入库
            // 部分自带指纹，重跑分类即跳过（自愈）
            if (failed) throw new Error(failed); // 交给运行槽收口为 err 终态
            ev.onStatus(
                esc(
                    fmt(res!.aborted ? t("incrAborted") : t("incrDone"), {
                        a: String(res!.added),
                        d: String(res!.deleted),
                        s: String(res!.staled),
                    })
                ),
                res!.aborted ? "muted" : "ok",
                true
            );
            if (!res!.aborted)
                notifyInfo(
                    fmt(t("incrDone"), { a: String(res!.added), d: String(res!.deleted), s: String(res!.staled) })
                );
            await v.reloadView();
        });
        if (!started) showStatus(v.el, t("convertBusy"), "err");
    };
    if (v.settingsOf()?.convertKeepOld) start(keepOldChoice(plan));
    else openIncrementDialog({ t, plan, onConfirm: start });
}
