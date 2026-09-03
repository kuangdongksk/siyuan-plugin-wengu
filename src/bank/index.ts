import { refreshSideCols } from "../quiz/flow/SideMount";
import { openCollectionDialog } from "./ui/CollectionDialog";
import type { HistoryStore, WenguSession } from "../quiz/service/HistoryStore";
import { AGGREGATE_ID, allSetMaterials, allSetQuestions, setMaterials } from "./data/BankSets";
import type { CollectionRow, QuestionBank } from "./data/QuestionBank";
import { refreshLiveCollections } from "./data/LiveCols";
import type { WenguDoc, WenguMaterial, WenguQuestion } from "../types";
import type { QuizView } from "../quiz";
import { mountSvelteApp, type MountedSvelteApp } from "../ui/mountApp";
import CollectionPanelApp from "./components/CollectionPanelApp.svelte";
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
        // 虚拟聚合专题不在 rows 里，标题走 i18n（侧栏树根行同款键）
        if (this.collectionId === AGGREGATE_ID) return this.v.t("allExTitle");
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
        if (id === AGGREGATE_ID) {
            this.collectionId = id; // 虚拟聚合专题：恒有效，不走 rows 校验
            return;
        }
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

    /** 题库模式的题目列表（文档模式返回 undefined）。聚合专题走
     *  BankSets 的有序并集（题集先后 × 集内 qids 序，不重排）。 */
    async questions(): Promise<WenguQuestion[] | undefined> {
        if (!this.collectionId) return undefined;
        const bank = this.v.bank();
        if (!bank) return [];
        if (this.collectionId === AGGREGATE_ID) return allSetQuestions(bank);
        return bank.questionsOf(this.collectionId);
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
   20260901 拆分：专题管理与知识文档回两个独立工作区（20260831 □4
   曾把专题清单并入知识面板下半区，用户改回分立） ── */

let colPanelApp: MountedSvelteApp | undefined;
let knowPanelApp: MountedSvelteApp | undefined;

export function mountCollectionPanel(v: QuizView, root: HTMLElement): void {
    detachBankPanels();
    colPanelApp = mountSvelteApp(CollectionPanelApp, root, { v });
}

export function mountKnowledgePanel(v: QuizView, root: HTMLElement): void {
    detachBankPanels();
    knowPanelApp = mountSvelteApp(KnowledgePanelApp, root, { v });
}

/** 卸载两个工作区面板（renderQuizShellFor 整壳重建前与 QuizView.destroy 兜底）。 */
export function detachBankPanels(): void {
    colPanelApp?.unmount();
    colPanelApp = undefined;
    knowPanelApp?.unmount();
    knowPanelApp = undefined;
}

/** col 模式装载上下文：专题轮次（col:<id> 归档）+ 来源题集的材料并集
 *  （材料正文在 bank.materials，20260903 起零内核 IO；group 占位解析
 *  通道随文档模式退役——记录字段已直配材料 id）。聚合专题的材料=
 *  全部题集按序并集。 */
export async function colLoadContext(
    history: HistoryStore | undefined,
    bank: QuestionBank | undefined,
    colId: string
): Promise<{ rounds: WenguSession[]; materials: WenguMaterial[] }> {
    const rounds = history ? await history.docSessions(colSessionId(colId)) : [];
    if (!bank) return { rounds, materials: [] };
    if (colId === AGGREGATE_ID) return { rounds, materials: await allSetMaterials(bank) };
    const materials: WenguMaterial[] = [];
    for (const setId of await bank.collectionSourceDocs(colId)) {
        try {
            materials.push(...(await setMaterials(bank, setId)));
        } catch (_) {
            // 单题集失败按缺材料降级（该卷题按独立题渲染）
        }
    }
    return { rounds, materials };
}
