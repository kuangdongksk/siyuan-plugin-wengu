import {applySideFilter} from "./CardHtml";
import {openCollectionDialog} from "./CollectionDialog";
import type {
    CollectionRow,
    QuestionBank,
} from "./QuestionBank";
import type {
    WenguDoc,
    WenguQuestion,
} from "./types";

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
        this.collectionId = id;
        this.v.reloadFromCollection();
    }

    /** 回文档模式（不触发重载，调用方自行处理）。 */
    reset(): void {
        this.collectionId = "";
    }

    /** 拉侧栏清单（load 尾部与迁移完成后调用）。 */
    async refresh(): Promise<void> {
        const bank = this.v.bank();
        this.rows = bank ? await bank.collectionsView() : [];
    }

    /** 题库模式的题目列表（文档模式返回 undefined）。 */
    async questions(): Promise<WenguQuestion[] | undefined> {
        if (!this.collectionId) return undefined;
        const bank = this.v.bank();
        return bank ? await bank.questionsOf(this.collectionId) : [];
    }

    /** 只刷新侧栏清单块（迁移完成补专题，不打断作答中的界面）。 */
    refreshSide(): void {
        applySideFilter(
            this.v.container(),
            this.v.docs(),
            this.v.docId(),
            (key) => this.v.t(key),
            this.v.sideFilter(),
            this.rows,
            this.collectionId,
        );
    }

    /** 打开专题管理（按知识点收集/删除/切换）。 */
    openDialog(): void {
        const bank = this.v.bank();
        if (!bank) return;
        openCollectionDialog({
            t: this.v.t,
            bank,
            onChanged: () => {
                void this.refresh().then(() => this.refreshSide());
            },
            onSelect: (id) => this.switchTo(id),
        });
    }
}
