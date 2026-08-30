import type { QuizView } from "../../quiz";
import type { QuestionBank } from "../data/QuestionBank";
import { kpRootMap } from "../data/BankReconcile";
import { knowRootsOf, removeKnowRoot, setKnowRoots } from "../data/KnowRoots";
import { openRelatedDialog } from "../ui/RelatedDialog";
import { openMatchDialog } from "../ui/MatchDialog";
import {
    buildKnowTree,
    groupKnowByDoc,
    importedKnowDocs,
    mergeKnowDocs,
    type KnowDocView,
    type KnowTreeNode,
} from "../ui/KnowledgePanel";
import { openKnowPicker } from "../../ui/KnowPicker";
import { KernelDoc } from "../../siyuan/doc";
import type { KnowPanelUi } from "./KnowPanelUi";

/**
 * 知识文档面板控制器（四件套之一）：装载聚合（kp 引用 → 根文档映射 →
 * 递归展开手动导入，详见 ui/KnowledgePanel 的纯函数层）、折叠/两击退册
 * 状态机、行内五动作（匹配/转习题/关联/打开/移除）。旧 paintTree 整树
 * innerHTML 重绘换成 ui 字段写入；卸载后 load 作废（alive 标志，对应
 * 旧 root.isConnected 竞态守卫——装载期间骨架可能被 refreshSide 重建）。
 */
export class KnowPanelCtl {
    private alive = true;
    private rmTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly ui: KnowPanelUi,
        private readonly v: QuizView
    ) {}

    destroy(): void {
        this.alive = false;
        if (this.rmTimer) clearTimeout(this.rmTimer);
        this.rmTimer = undefined;
    }

    private bank(): QuestionBank | undefined {
        return this.v.bankStore();
    }

    /** 装载/重拉（刷新、导入、退册后都走这里）。 */
    async load(): Promise<void> {
        const bank = this.bank();
        if (!bank) {
            this.ui.phase = "nobank";
            return;
        }
        this.ui.phase = "loading";
        this.disarm();
        const refs = await bank.collectKpRefs();
        const rootsMap = await kpRootMap([...refs.keys()]);
        const registered = await knowRootsOf(bank);
        const info = await KernelDoc.infoOf([...new Set([...rootsMap.values(), ...registered])]);
        const titles = new Map([...info].map(([k, v]) => [k, v.title]));
        let docs = groupKnowByDoc(refs, rootsMap, await bank.knowledgeIndex(), titles);
        if (registered.length > 0) {
            const imp = await importedKnowDocs(registered, titles);
            for (const [k, v] of imp.info) info.set(k, v); // 展开行自带标题/hPath，供树化分支
            docs = mergeKnowDocs(docs, imp.docs, imp.manualAll, new Set(registered));
        }
        if (!this.alive) return; // 骨架已被重建，本次结果作废
        this.ui.docs = docs;
        this.ui.info = info;
        // 分支默认全展开（知识树浅、文档即叶子）；小节容器不进集合=默认收起
        this.ui.openPaths = new Set(collectBranchPaths(buildKnowTree(docs, info)));
        this.ui.phase = "ready";
    }

    /** 折叠切换（分支 key=树路径；文档行的箭头 key=小节容器）。 */
    toggle(path: string): void {
        if (this.ui.openPaths.has(path)) this.ui.openPaths.delete(path);
        else this.ui.openPaths.add(path);
    }

    /* ── 行内动作（匹配/转习题/关联/打开） ── */

    match(d: KnowDocView): void {
        const bank = this.bank();
        if (!bank) return;
        void openMatchDialog({
            t: this.v.t,
            bank,
            modelId: this.v.aiModelId(),
            knowDocId: d.docId,
            knowTitle: d.title,
            onDone: () => void this.load(),
        });
    }

    /** 转习题：源=知识点根=该文档（转换生成时即挂自身小节反链）。 */
    gen(d: KnowDocView): void {
        this.v.openConvertPrefilled(d.docId, d.docId);
    }

    related(d: KnowDocView): void {
        const bank = this.bank();
        if (bank) void openRelatedDialog(bank, this.v.t, d.docId);
    }

    open(docId: string): void {
        window.open(`siyuan://blocks/${docId}`);
    }

    /** 头部「导入」：文档选择浮层（多选，锚定按钮）。 */
    importRoots(anchor: HTMLElement): void {
        const bank = this.bank();
        if (!bank) return;
        void (async () => {
            const current = await knowRootsOf(bank);
            openKnowPicker({
                t: this.v.t,
                anchor,
                current,
                single: false,
                onConfirm: (ids) => {
                    void setKnowRoots(bank, ids)
                        .then(() => bank.flush())
                        .then(() => this.load());
                },
            });
        })();
    }

    /* ── 「移除」两击确认（3s 复位；armed 与渲染同源，重拉后不漂移） ── */

    armRemove(docId: string): void {
        if (this.ui.rmArmed === docId) {
            this.disarm();
            void this.removeRoot(docId);
            return;
        }
        this.disarm();
        this.ui.rmArmed = docId;
        this.rmTimer = setTimeout((): void => {
            this.ui.rmArmed = undefined;
            this.rmTimer = undefined;
        }, 3000);
    }

    private disarm(): void {
        if (this.rmTimer) clearTimeout(this.rmTimer);
        this.rmTimer = undefined;
        this.ui.rmArmed = undefined;
    }

    /** 退册整个登记子树。 */
    private async removeRoot(docId: string): Promise<void> {
        const bank = this.bank();
        if (!bank) return;
        await removeKnowRoot(bank, docId);
        await bank.flush();
        await this.load();
    }
}

/** 全部分支路径（装载时 openPaths 初值=分支全开）。 */
function collectBranchPaths(nodes: KnowTreeNode[]): string[] {
    return nodes.flatMap((n) => [n.path, ...collectBranchPaths(n.children)]);
}
