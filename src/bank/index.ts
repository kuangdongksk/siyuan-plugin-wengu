import { refreshSideCols } from "../quiz/flow/SideMount";
import { openCollectionDialog } from "./ui/CollectionDialog";
import { GROUP_PREV } from "../siyuan/attrs";
import type { HistoryStore, WenguSession } from "../quiz/service/HistoryStore";
import { listMaterials, resolveGroupPlaceholders } from "../quiz/service/MaterialService";
import type { CollectionRow, QuestionBank } from "./data/QuestionBank";
import { refreshLiveCollections } from "./data/LiveCols";
import type { WenguDoc, WenguMaterial, WenguQuestion } from "../types";
import type { QuizView } from "../quiz";
import { mountSvelteApp, type MountedSvelteApp } from "../ui/mountApp";
import KnowledgePanelApp from "./components/KnowledgePanelApp.svelte";

/**
 * 专题编排（从 QuizView 拆出）：持有当前选中的专题 id 与侧栏清单，
 * 负责切换（题库模式/回文档模式）、清单刷新与「按知识点收集」对话框。
 * 题目列表由题库解析（BankParse）供给，渲染走静态路径。
 */
export interface CollectionViewAccess {
    t: (key: string) => string;
    container(): HTMLElement;
    bank(): QuestionBank | undefined;
    docs(): WenguDoc[];
    docId(): string;
    /** 侧栏搜索过滤词（清单局部刷新用）。 */
    sideFilter(): string;
    /** 侧栏树展开集合（树形渲染用）。 */
    sideTreeOpen(): string[];
    /** AI 模型 id（收集并补题用）。 */
    modelId(): string;
    /** 切换前结算计时（旧口径 total-time 落库）：switchTo 先改选中再
     *  重载，若不先结算，flush 读到的是新专题 id——旧上下文的用时
     *  落错目标（「专题边界计时错账」挂账，20260829）。 */
    settleTimer(): void;
    /** 模式切换收尾（结算旧上下文、置空文档选中并重载，视图实现）。 */
    reloadFromCollection(): void;
}

export class CollectionFlow {
    private collectionId = "";
    private rows: CollectionRow[] = [];

    constructor(private readonly v: CollectionViewAccess) {}

    id(): string {
        return this.collectionId;
    }

    isActive(): boolean {
        return this.collectionId !== "";
    }

    activeTitle(): string | undefined {
        return this.rows.find((c) => c.id === this.collectionId)?.title;
    }

    rowsView(): CollectionRow[] {
        return this.rows;
    }

    /** 切换专题（同 id 忽略；空串=回文档模式）。 */
    switchTo(id: string): void {
        if (id === this.collectionId) return;
        this.v.settleTimer(); // 先按旧口径结算，再改选中（防边界错账）
        this.collectionId = id;
        this.v.reloadFromCollection();
    }

    /** 回文档模式（不触发重载，调用方自行处理）。 */
    reset(): void {
        this.collectionId = "";
    }

    /** 从 prefs 恢复专题选中（不触发重载；失效 id 静默忽略回文档模式）。 */
    async restore(id: string): Promise<void> {
        const bank = this.v.bank();
        const rows = bank ? await bank.collectionsView() : [];
        if (rows.some((c) => c.id === id)) this.collectionId = id;
    }

    /** 拉侧栏清单（load 尾部与迁移完成后调用）。活视图专题先对账
     *  （□3：按 subKeys 重算 qids，侧栏计数不漂）。 */
    async refresh(): Promise<void> {
        const bank = this.v.bank();
        if (bank) await refreshLiveCollections(bank);
        this.rows = bank ? await bank.collectionsView() : [];
    }

    /** 题库模式的题目列表（文档模式返回 undefined）。 */
    async questions(): Promise<WenguQuestion[] | undefined> {
        if (!this.collectionId) return undefined;
        const bank = this.v.bank();
        return bank ? await bank.questionsOf(this.collectionId) : [];
    }

    /** 只刷新侧栏专题清单块（迁移完成补专题，不打断作答中的界面）。
     *  6-5 侧栏组件化后走 SidePanelApp 实例导出，不重灌树与搜索。 */
    refreshSide(): void {
        refreshSideCols(this.rows, this.collectionId);
    }

    /** 打开专题管理（按知识点收集/补题/删除/切换）。preset=预勾知识点
     *  （知识树节点行「针对此节点生成」入口，0 题节点合成 0 计数行）。 */
    openDialog(preset?: { key: string; title: string }[]): void {
        const bank = this.v.bank();
        if (!bank) return;
        openCollectionDialog({
            t: this.v.t,
            bank,
            preset,
            modelId: () => this.v.modelId(),
            docTitle: (docId) => this.v.docs().find((d) => d.id === docId)?.title ?? "",
            onChanged: () => {
                void this.refresh().then(() => this.refreshSide());
            },
            onEdited: (id) => {
                void this.refresh().then(() => {
                    this.refreshSide();
                    if (this.collectionId === id) {
                        // 活跃专题被编辑（移题/删除）：删没了回文档模式，否则重载题目集
                        if (!this.rows.some((c) => c.id === id)) this.reset();
                        this.v.reloadFromCollection();
                    }
                });
            },
            onSelect: (id) => this.switchTo(id),
        });
    }
}

/** col 模式的会话域 id（history 里与文档 id 同场存放，前缀天然隔离）。 */
export function colSessionId(colId: string): string {
    return `col:${colId}`;
}

/* ── 工作区面板挂载（Svelte 化，companion 同款单例+detach 模式；
   20260831 rail 合并（□4）：专题清单并入知识面板下半区，
   CollectionPanelApp 退役为内嵌 ColListSection，独立挂载入口删除 ── */

let knowPanelApp: MountedSvelteApp | undefined;

export function mountKnowledgePanel(v: QuizView, root: HTMLElement): void {
    detachBankPanels();
    knowPanelApp = mountSvelteApp(KnowledgePanelApp, root, { v });
}

/** 卸载知识工作区面板（renderQuizShellFor 整壳重建前与 QuizView.destroy 兜底）。 */
export function detachBankPanels(): void {
    knowPanelApp?.unmount();
    knowPanelApp = undefined;
}

/** col 模式装载上下文：专题轮次（col:<id> 归档）+ 来源文档的材料并集。
 *  group="prev" 占位按来源文档解析回写（同 QuizLoader 文档模式手法），
 *  请求串行（fetchSyncPost 并发互吞，真机踩坑）。 */
export async function colLoadContext(
    history: HistoryStore | undefined,
    bank: QuestionBank | undefined,
    colId: string,
    questions: WenguQuestion[]
): Promise<{ rounds: WenguSession[]; materials: WenguMaterial[] }> {
    const rounds = history ? await history.docSessions(colSessionId(colId)) : [];
    const materials: WenguMaterial[] = [];
    if (!bank) return { rounds, materials };
    const pending = questions.filter((q) => q.group === GROUP_PREV);
    for (const docId of await bank.collectionSourceDocs(colId)) {
        try {
            if (pending.length > 0) {
                const patches = await resolveGroupPlaceholders(docId);
                for (const q of pending) {
                    const mid = patches.get(q.id);
                    if (mid) q.group = mid;
                }
            }
            materials.push(...(await listMaterials(docId)));
        } catch (_) {
            // 单文档失败按缺材料降级（该卷题按独立题渲染）
        }
    }
    return { rounds, materials };
}
