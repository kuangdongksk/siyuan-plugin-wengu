import type { ConvertProgressRecord } from "../../convert/service/ConvertBatch";
import type { QuestionBank } from "../../bank/data/QuestionBank";
import { ensureSets, setDocsView, setMaterials, setQuestions } from "../../bank/data/BankSets";
import type { HistoryStore } from "./HistoryStore";
import type { WenguSettingsShape as SettingsDialogShape } from "../../ui/SettingsDialog";
import type { TimerController } from "./TimerController";
import type { WenguDoc, WenguMaterial, WenguQuestion, WenguRevealMode } from "../../types";
import { clampMinutes } from "../../ui/shared";

/**
 * 刷题数据装载（从 QuizView 拆出）：一次 load 要拉的题集列表、当前
 * 题集题目、历史轮次，以及从 prefs/设置恢复的会话状态。
 * 20260903 起题目内容唯一真相在题库——列表/题目/材料全部出自 bank
 * （零内核 SQL；存量记录按 sourceDocId 分组推导题集，见 BankSets）。
 */

/** 装载入参（QuizView 的当前状态快照 + 依赖）。 */
export interface QuizLoadDeps {
    prefs: {
        docId?: string;
        sideCollapsed?: boolean;
        workspace?: string;
        sideTreeOpen?: string[];
        lastConvertModelId?: string;
        lastConvertFill?: boolean;
        lastConvertSteps?: boolean;
        lastConvertKnow?: string;
        convertProgress?: Record<string, ConvertProgressRecord>;
    };
    settings?: SettingsDialogShape;
    timer: TimerController;
    history?: HistoryStore;
    /** 题库（列表/题目/材料的唯一来源）。 */
    bank?: QuestionBank;
    /** 之前的选中（仍存在则保持）。 */
    docId: string;
    /** 顶栏带来的活动文档（无历史选择时优先；源文档按 set.srcId 反查）。 */
    activeDocId: string;
    /** 刚生成、尚未进列表的题集（转换渐进期临时补位）。 */
    pendingDoc?: { id: string; title: string };
}

/** 装载结果。 */
export interface QuizLoadResult {
    docs: WenguDoc[];
    docId: string;
    /** 侧栏树展开集合（undefined=首次，QuizView 落默认第一层并持久化）。 */
    sideTreeOpen: string[] | undefined;
    /** pendingDoc 是否仍需保留（未进列表）。 */
    pendingDoc: { id: string; title: string } | undefined;
    fullList: WenguQuestion[];
    /** 当前题集的材料（材料组渲染用）。 */
    materials: WenguMaterial[];
    rounds: Awaited<ReturnType<HistoryStore["docSessions"]>>;
    sideCollapsed: boolean;
    /** 上次停留的工作区（规整前原值，QuizView 自行 normalize）。 */
    workspace: string | undefined;
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

/** 顶栏活动文档 → 题集选中：直接命中题集 id 优先，否则按 set.srcId
 *  反查（用户正开着的源讲义，其题集自动选中）。 */
async function setActiveFallback(bank: QuestionBank, docs: WenguDoc[], activeDocId: string): Promise<string> {
    if (activeDocId && docs.some((d) => d.id === activeDocId)) return activeDocId;
    if (!activeDocId) return "";
    const data = await bank.all();
    return Object.values(data.sets ?? {}).find((s) => s.srcId === activeDocId)?.id ?? "";
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
        workspace: deps.prefs.workspace,
        sideTreeOpen: deps.prefs.sideTreeOpen,
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
        if (!deps.bank) throw new Error("bank unavailable");
        // 存量题集推导（records 按 sourceDocId 分组补 sets 条目；标题尽力
        // 从仍在的旧文档读一次——此后本插件零读旧文档）
        await ensureSets(deps.bank);
        r.docs = await setDocsView(deps.bank);
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
        // 选中优先级：当前选中（仍存在）> 上次记住的选择 > 活动文档（含
        // 源文档反查）> 第一个
        if (r.docId && !r.docs.some((d) => d.id === r.docId)) {
            const remembered = deps.prefs.docId ?? "";
            r.docId = remembered && r.docs.some((d) => d.id === remembered) ? remembered : "";
        }
        if (!r.docId && r.docs.length > 0) {
            r.docId = (await setActiveFallback(deps.bank, r.docs, deps.activeDocId)) || r.docs[0].id;
        }
        r.docTotalSec = r.docs.find((d) => d.id === r.docId)?.totalTime ?? 0;
        r.fullList = r.docId ? await setQuestions(deps.bank, r.docId) : [];
        r.materials = r.docId ? await setMaterials(deps.bank, r.docId) : [];
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
    /** 上次停留的左栏工作区（重开恢复）。 */
    workspace?: string;
    /** 侧栏树展开的路径集合（undefined=未初始化，load 时落默认第一层）。 */
    sideTreeOpen?: string[];
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
