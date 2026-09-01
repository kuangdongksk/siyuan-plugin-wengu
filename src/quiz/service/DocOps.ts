import { ATTR_PREFIX, Attr } from "../../siyuan/attrs";
import { KernelBlock } from "../../siyuan/block";
import { KernelDoc } from "../../siyuan/doc";
import { KernelQuery } from "../../siyuan/query";
import { showStatus, startConvertForView, convertRunEventsFor } from "../../convert";
import { convertRunActive, startExclusiveConvertRun, type ConvertRunCfg } from "../../convert/service/ConvertRun";
import { extractBlockId, getDocInfo } from "../../convert/service/ConvertService";
import { classifyChunks, type SrcGroup } from "../../convert/service/SrcChunk";
import { convertIncremental, readSrcGroups, sourceChunksOf } from "../../convert/service/ConvertIncrement";
import { keepOldChoice, openIncrementDialog, type IncrementChoice } from "../../convert/ui/IncrementDialog";
import { refreshDocFor } from "../../bank/data/BankMigrate";
import { esc, fmt } from "../../ui/shared";
import { notifyInfo } from "../../ui/Notify";
import type { QuizView } from "../index";

/**
 * 目录文档右键「删除此题集」/「重新导入」（自 QuizView 拆出）：
 * - 删除此题集（20260829 起替代「删除文档」）：只解除题集登记——把
 *   文档内全部 wengu 属性**置空剥离**（内核 setBlockAttrs 空值=删属性，
 *   20260829 真机探针验证）+ 清题库/会话历史，**文档本体与内容原样
 *   保留**、不再进回收站；source-doc 配对随属性一并剥离，此后源讲义
 *   被删也不会被 OrphanCleaner 连带删除。
 * - 重新导入：网络中断等「导一半」的题集一键续做——查该源的续跑
 *   记录（prefs convertProgress），有则接着断点跑（已生成部分不重复
 *   生成、不重复花费）、无则从头重转；删旧题集（回收站可找回）后另存
 *   一份新《源·习题》（生成在源讲义旁，源讲义不动）。
 *
 * fetchSyncPost 必须串行（内核并发互吞响应）；内核调用全程尽力而为，
 * 失败停在中间态由下次操作重试。
 */

/** 块 id 字符集校验（拼 SQL 前防脏值，同 OrphanCleaner）。 */
const ID_RE = /^[\w-]+$/;

/** 严格块 id 形态（知识点根过滤用，同转换弹窗口径）。 */
const BLOCK_ID_RE = /^\d{14}-[a-z0-9]+$/i;

/** 题集的配对源讲义 id（attributes 表查 source-doc；无配对/自配对为空）。 */
export async function pairedSourceDoc(docId: string): Promise<string> {
    if (!ID_RE.test(docId)) return "";
    const rows = await KernelQuery.rows<{ srcId?: string }>(
        `SELECT value AS srcId FROM attributes WHERE name = '${Attr.sourceDoc}' AND block_id = '${docId}' LIMIT 1`
    );
    const src = String(rows[0]?.srcId ?? "");
    return src && ID_RE.test(src) && src !== docId ? src : "";
}

/** 配对源讲义 id 且仍存活（右键菜单按它决定是否露出「重新导入」；
 *  查询失败按无源收口——fail-closed，不露出不可用的入口）。 */
export async function livingSourceOf(docId: string): Promise<string> {
    try {
        const src = await pairedSourceDoc(docId);
        if (!src) return "";
        const info = await getDocInfo(extractBlockId(src));
        return info?.notebook ? src : "";
    } catch (_) {
        return "";
    }
}

/** 属性行按块分组（剥离用：一块一次 setAttrs 清掉它的全部 wengu 属性）。 */
export function groupAttrsByBlock(rows: { id?: string; name?: string }[]): Map<string, string[]> {
    const byBlock = new Map<string, string[]>();
    for (const r of rows) {
        if (!r.id || !r.name) continue;
        const names = byBlock.get(r.id) ?? [];
        if (!names.includes(r.name)) names.push(r.name);
        byBlock.set(r.id, names);
    }
    return byBlock;
}

/** 「删除此题集」：剥离 wengu 属性（文档与内容保留）+ 清插件侧数据后重载。 */
export function unregisterDocAsQuiz(v: QuizView, docId: string): void {
    void (async () => {
        if (convertRunActive()) {
            showStatus(v.el, v.t("convertBusy"), "err");
            return;
        }
        if (!ID_RE.test(docId)) return;
        try {
            // rowsAll 自动分页：大卷题目属性行数超 64 会被无 LIMIT 截断
            const rows = await KernelQuery.rowsAll<{ id?: string; name?: string }>(
                `SELECT block_id AS id, name FROM attributes WHERE root_id = '${docId}' AND name LIKE '${ATTR_PREFIX}%'`
            );
            for (const [id, names] of groupAttrsByBlock(rows)) {
                const attrs: Record<string, string> = {};
                for (const n of names) attrs[n] = "";
                await KernelBlock.setAttrs(id, attrs);
            }
        } catch (_) {
            return; // 剥离失败不动插件数据，下次再试
        }
        await v.bankStore()?.removeDocData(docId);
        await v.bankStore()?.flush();
        await v.historyStore()?.removeDocs([docId]);
        await v.reloadView(); // 选中回退链（当前>记住>活动>第一个）自动切离
    })();
}

/** 重新导入的读回计划（纯决策，IO 由调用方执行）：续跑记录的渐进文档
 *  就是当前题集本身（newdoc 中途终止「保留已生成」的常态——渐进文档
 *  即《源·习题》）时，读回目标同样是它、但不单独删（题集稍后统一删除，
 *  漏读=前半截随删除消失、续跑只剩后半截，20260830 踩坑）；渐进文档
 *  另有其人则读它并单独删，防孤儿。 */
export function planReimportRead(
    rec: { docId?: string } | undefined,
    quizDocId: string
): { readId: string; removeId: string } {
    const keepId = rec?.docId && ID_RE.test(rec.docId) ? rec.docId : "";
    if (keepId && keepId !== quizDocId) return { readId: keepId, removeId: keepId };
    return keepId ? { readId: keepId, removeId: "" } : { readId: "", removeId: "" };
}

/** 重新导入的续跑参数（纯决策）：读得回已生成内容才带断点——读不回还
 *  硬按 offset 跳批，只会产出「只有后半截」的文档，宁可从头全量重转；
 *  读回为空时回落记录里的 kramdown（原位形态残留）。 */
export function reimportResume(
    rec: { offset: number; kramdown?: string } | undefined,
    readBack: string
): { offset: number; kramdown: string } | undefined {
    const carried = readBack.trim() ? readBack : (rec?.kramdown ?? "");
    return rec && carried.trim() ? { offset: rec.offset, kramdown: carried } : undefined;
}

/** 重新导入的转换参数（弹窗默认同款解析：prefs 上次 > 设置默认）。
 *  有续跑记录则接着上次断点续跑（已生成部分保留），无记录才从头重转。 */
export function reimportCfg(
    srcDocId: string,
    last: { modelId: string; fill: boolean; steps: boolean; know: string },
    settings?: { convertModelId?: string; fillToChoice?: boolean; bigToSteps?: boolean; convertParallel?: number },
    resume?: { offset: number; docId?: string; kramdown?: string }
): ConvertRunCfg {
    return {
        srcDocId,
        modelId: last.modelId || settings?.convertModelId || "",
        fillToChoice: last.fill || settings?.fillToChoice === true,
        bigToSteps: last.steps || settings?.bigToSteps === true,
        parallel: Math.max(1, Math.min(4, Math.floor(settings?.convertParallel ?? 1))),
        writeMode: "newdoc",
        targetRaw: "",
        knowRoots: last.know
            .split(/[\s,;，；]+/)
            .map((s) => extractBlockId(s))
            .filter((s) => BLOCK_ID_RE.test(s)),
        resume,
    };
}

/**
 * 「重新导入」＝检测断点续跑，而非无条件全量重转：
 * 0. **增量重转换**（20260831 二期）：整卷完成态（无续跑记录）且题集
 *    带 src-hash 指纹（二期起生成的题集）→ 不删旧重转——重新结构切块
 *    比对三态分类，相同跳过（保原题与刷题统计）、新增补生成、变更/
 *    消失逐块选（省费模式 convertKeepOld=全保留只补新增）。中止后已
 *    追加块自带指纹，重跑分类即跳过（自愈，无续跑记录负担）。
 * 1. 配对源讲义查得到续跑记录（prefs convertProgress）→ 接着断点跑。
 *    记录保留的渐进文档（rec.docId，含它就是当前题集本身的常态形态）
 *    删除前先把内容读回转进 resume.kramdown——否则它随删除消失，
 *    ConvertBatch 挂不上目标会静默丢掉已生成部分（created 挂不上）；
 *    读不回任何旧内容时不带断点从头重转（硬按 offset 跳批只会产出
 *    「只有后半截」的文档）。清续跑记录防止「全部完成」短路直接把
 *    已删文档当完成态返回。
 * 2. 完全没有续跑记录 → 从头重转（kramdown=空即全量）。
 * 落盘统一另存一份新《源·习题》（源讲义不动），失败自动记回续跑进度。
 */
export function reimportDocFrom(v: QuizView, docId: string): void {
    void (async () => {
        if (convertRunActive()) {
            showStatus(v.el, v.t("convertBusy"), "err");
            return;
        }
        const srcId = await livingSourceOf(docId);
        if (!srcId) {
            showStatus(v.el, v.t("reimportNoSource"), "err");
            return;
        }
        const rec = v.convertAccess.convertProgressOf(srcId);
        // 增量分支（二期）：完成态 + 带指纹的题集走三态分类，不删旧文档
        if (!rec) {
            const groups = await readSrcGroups(docId).catch((): SrcGroup[] => []);
            if (groups.length > 0) {
                await runIncrementalReimport(v, docId, srcId, groups);
                return;
            }
        }
        let kramdown = "";
        let docDeleted = false;
        const plan = planReimportRead(rec, docId);
        if (plan.readId) {
            // 删除前读回已生成内容（续跑 existing 的来源；渐进文档=当前
            // 题集时读的就是它，必须在下方 remove 之前）
            const old = await KernelBlock.kramdown(plan.readId);
            kramdown = String((old.data as { kramdown?: string } | null)?.kramdown ?? "");
            if (plan.removeId) {
                try {
                    await KernelDoc.remove(plan.removeId);
                } catch (_) {
                    // 渐进文档删除失败不阻断续跑（可能本就是孤儿）
                }
            }
        }
        try {
            const { code } = await KernelDoc.remove(docId);
            if (code === 0) docDeleted = true;
        } catch (_) {
            docDeleted = false;
        }
        if (docDeleted) {
            await v.bankStore()?.removeDocData(docId);
            await v.bankStore()?.flush();
            await v.historyStore()?.removeDocs([docId]);
        }
        // 删与建之间清续跑记录：防「offset 已覆盖全文」短路把已删/待删
        // 的保留文档当完成态返回；失败路径会重新记回（延续上下文）
        v.convertAccess.saveConvertProgress(srcId, undefined);
        // 读不回已生成内容时不带断点（防半截，见 reimportResume）
        const resume = reimportResume(rec, kramdown);
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
 * 呈现进度、可停止），完成后题库重扫入库（refreshDocFor 幂等，删除/
 * 追加的块同步进 records 与影子专题）+ 视图重载。
 */
async function runIncrementalReimport(
    v: QuizView,
    quizDocId: string,
    srcId: string,
    groups: SrcGroup[]
): Promise<void> {
    const t = v.t;
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
        const started = startExclusiveConvertRun(ev, srcId, async (signal) => {
            ev.onStatus(esc(t("incrPreparing")), "muted");
            let res;
            let failed = "";
            try {
                res = await convertIncremental({
                    deleteBlockIds: choice.deleteBlockIds,
                    staleBlockIds: choice.staleBlockIds,
                    chunks: choice.chunks,
                    quizDocId,
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
            // 题库重扫（幂等）：追加块入 records、删除块出 records，影子
            // 专题题单刷新——中止/失败也要扫（已追加部分自愈的入库半场）
            const bank = v.bankStore();
            if (bank) {
                const info = await getDocInfo(quizDocId);
                await refreshDocFor(bank, quizDocId, info?.title ?? "");
                await bank.flush();
            }
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
