import { GROUP_PREV } from "./attrs";
import type { ConvertProgressRecord } from "./ConvertBatch";
import type { HistoryStore } from "./HistoryStore";
import { listMaterials, resolveGroupPlaceholders } from "./MaterialService";
import { cleanOrphanExerciseDocs } from "./OrphanCleaner";
import { listQuestionDocs, listQuestions } from "./QuestionService";
import type { WenguSettingsShape as SettingsDialogShape } from "./SettingsDialog";
import type { TimerController } from "./TimerController";
import type { WenguDoc, WenguMaterial, WenguQuestion, WenguRevealMode } from "./types";
import { clampMinutes } from "./ui";

/**
 * 刷题数据装载（从 QuizView 拆出）：一次 load 要拉的文档列表、当前
 * 文档题目、历史轮次，以及从 prefs/设置恢复的会话状态。
 */

/** 装载入参（QuizView 的当前状态快照 + 依赖）。 */
export interface QuizLoadDeps {
    prefs: {
        docId?: string;
        sideCollapsed?: boolean;
        lastConvertModelId?: string;
        lastConvertFill?: boolean;
        lastConvertSteps?: boolean;
        lastConvertKnow?: string;
        convertProgress?: Record<string, ConvertProgressRecord>;
    };
    settings?: SettingsDialogShape;
    timer: TimerController;
    history?: HistoryStore;
    /** 之前的选中（仍存在则保持）。 */
    docId: string;
    /** 顶栏带来的活动文档（无历史选择时优先）。 */
    activeDocId: string;
    /** 刚生成、索引未可见的习题文档（列表临时补位）。 */
    pendingDoc?: { id: string; title: string };
}

/** 装载结果。 */
export interface QuizLoadResult {
    docs: WenguDoc[];
    docId: string;
    /** pendingDoc 是否仍需保留（未进列表）。 */
    pendingDoc: { id: string; title: string } | undefined;
    fullList: WenguQuestion[];
    /** 当前文档的材料块（材料组渲染用）。 */
    materials: WenguMaterial[];
    rounds: Awaited<ReturnType<HistoryStore["docSessions"]>>;
    sideCollapsed: boolean;
    lastConvertModelId: string;
    lastConvertFill: boolean;
    lastConvertSteps: boolean;
    /** 知识点根文档上次输入（转换弹窗预填）。 */
    lastConvertKnow: string;
    /** 未完成转换的进度（源文档 id → 记录），供「继续生成」。 */
    convertProgress: Record<string, ConvertProgressRecord>;
    revealMode: WenguRevealMode;
    docTotalSec: number;
    loadError: string;
}

export async function loadQuizState(deps: QuizLoadDeps): Promise<QuizLoadResult> {
    const r: QuizLoadResult = {
        docs: [],
        docId: deps.docId,
        pendingDoc: deps.pendingDoc,
        fullList: [],
        materials: [],
        rounds: [],
        sideCollapsed: !!deps.prefs.sideCollapsed,
        lastConvertModelId: deps.prefs.lastConvertModelId ?? "",
        lastConvertFill: deps.prefs.lastConvertFill ?? deps.settings?.fillToChoice === true,
        lastConvertSteps: deps.prefs.lastConvertSteps ?? deps.settings?.bigToSteps === true,
        lastConvertKnow: deps.prefs.lastConvertKnow ?? "",
        convertProgress: deps.prefs.convertProgress ?? {},
        revealMode: deps.settings?.defaultReveal === "after" ? "after" : "instant",
        docTotalSec: 0,
        loadError: "",
    };
    try {
        // 开刷面板默认值来自设置页（design-review P1-3）
        const s = deps.settings;
        const timing = s?.defaultTiming;
        deps.timer.mode = timing === "countdown" || timing === "none" || timing === "perQuestion" ? timing : "countUp";
        deps.timer.countdownMin = clampMinutes(s?.defaultCountdownMin ?? 20);
        // 源讲义已删的孤儿习题文档先清理（含其会话历史），再拉列表
        try {
            const removed = await cleanOrphanExerciseDocs();
            if (removed.length > 0 && deps.history) await deps.history.removeDocs(removed);
        } catch (_) {
            // 清理失败不阻断装载，下次装载再试
        }
        r.docs = await listQuestionDocs();
        if (r.pendingDoc && r.docs.some((d) => d.id === r.pendingDoc.id)) {
            r.pendingDoc = undefined;
        } else if (r.pendingDoc) {
            r.docs.unshift({
                id: r.pendingDoc.id,
                title: r.pendingDoc.title,
                hPath: "",
                total: 0,
                attempted: 0,
                rightCount: 0,
                totalTime: 0,
            });
        }
        // 选中优先级：当前选中（仍存在）> 上次记住的选择 > 活动文档 > 第一个
        if (r.docId && !r.docs.some((d) => d.id === r.docId)) {
            const remembered = deps.prefs.docId ?? "";
            r.docId = remembered && r.docs.some((d) => d.id === remembered) ? remembered : "";
        }
        if (!r.docId && r.docs.length > 0) {
            r.docId =
                deps.activeDocId && r.docs.some((d) => d.id === deps.activeDocId) ? deps.activeDocId : r.docs[0].id;
        }
        r.docTotalSec = r.docs.find((d) => d.id === r.docId)?.totalTime ?? 0;
        r.fullList = r.docId ? await listQuestions(r.docId) : [];
        // 材料组：转换写的 group="prev" 占位按文档序解析回写真实材料块 id
        // （渐进重建期间不解析，装载即最终文档，幂等）
        if (r.docId && r.fullList.some((q) => q.group === GROUP_PREV)) {
            try {
                const patches = await resolveGroupPlaceholders(r.docId);
                for (const q of r.fullList) {
                    const mid = patches.get(q.id);
                    if (mid) q.group = mid;
                }
            } catch (_) {
                // 解析失败按无材料降级（下次装载再试）
            }
        }
        r.materials = r.docId ? await listMaterials(r.docId).catch((): WenguMaterial[] => []) : [];
        r.rounds = r.docId && deps.history ? await deps.history.docSessions(r.docId) : [];
    } catch (e) {
        r.fullList = [];
        r.loadError = String((e as Error)?.message ?? e);
    }
    return r;
}

/** 插件数据（saveData("quiz")）读写：会话状态（设置默认值另在设置页）。 */
export interface WenguPrefsIo {
    docId?: string;
    /** 上次选中的专题 id（重开页签恢复专题模式）。 */
    colId?: string;
    sideCollapsed?: boolean;
    lastConvertModelId?: string;
    lastConvertFill?: boolean;
    lastConvertSteps?: boolean;
    /** 知识点根文档上次输入（转换弹窗预填）。 */
    lastConvertKnow?: string;
    /** 未完成的分批转换进度（源文档 id → 记录），供「继续生成」。 */
    convertProgress?: Record<string, ConvertProgressRecord>;
}

export async function loadPrefs(storage?: { load: () => Promise<unknown> }): Promise<WenguPrefsIo> {
    try {
        const data = (await storage?.load()) as WenguPrefsIo | "" | null | undefined;
        return data && typeof data === "object" ? data : {};
    } catch (_) {
        return {};
    }
}

export function savePrefs(
    storage: { save: (v: WenguPrefsIo) => Promise<unknown> } | undefined,
    prefs: WenguPrefsIo
): void {
    if (!storage) return;
    try {
        void storage.save(prefs);
    } catch (_) {
        // 忽略存储失败
    }
}
