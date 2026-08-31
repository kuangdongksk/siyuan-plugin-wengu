import type { QuizView } from "../../quiz";
import type { QuestionBank } from "../data/QuestionBank";
import { kpRootMap } from "../data/BankReconcile";
import { hideKnowDoc, knowHiddenOf, knowRootsOf, removeKnowRoot, setKnowRoots } from "../data/KnowRoots";
import { openRelatedDialog } from "../ui/RelatedDialog";
import { openMatchDialog } from "../ui/MatchDialog";
import { openBatchLinkDialog } from "../ui/BatchLinkDialog";
import { lexiconOfRoots, linkBankByText } from "../data/KnowLinkText";
import { knowHash } from "../data/KnowHash";
import { expandKnowDocs } from "../../convert/service/KnowledgeLink";
import { generateKnowledgeOutline } from "../../convert/service/KnowOutline";
import { convertRunActive } from "../../convert/service/ConvertRun";
import {
    buildKnowTree,
    groupKnowByDoc,
    importedKnowDocs,
    mergeKnowDocs,
    type KnowDocView,
    type KnowSectionTreeView,
    type KnowTreeNode,
} from "../ui/KnowledgePanel";
import { ensureLiveCollection, subKeysOf } from "../data/LiveCols";
import { openKnowPicker } from "../../ui/KnowPicker";
import { KernelDoc } from "../../siyuan/doc";
import type { KnowPanelUi } from "./KnowPanelUi";

/**
 * 知识文档面板控制器（四件套之一）：装载聚合（kp 引用 → 根文档映射 →
 * 递归展开手动导入，详见 ui/KnowledgePanel 的纯函数层）、折叠/两击退册
 * 状态机、行内六动作（匹配/转习题/关联/打开/删除/移除）。
 * 删除 = 软隐藏（bank.knowHidden + 顺手退册 knowRoots，2026-08-31 改
 * 「只清面板」口径，思源文档不动）；移除 = 仅退册整个登记子树（仅登记
 * 根行可用，保留为轻量退路）。
 * 旧 paintTree 整树 innerHTML 重绘换成 ui 字段写入；卸载后 load 作废
 * （alive 标志，对应旧 root.isConnected 竞态守卫——装载期间骨架可能被
 * refreshSide 重建）。
 */
export class KnowPanelCtl {
    private alive = true;
    private rmTimer: ReturnType<typeof setTimeout> | undefined;
    private dlTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly ui: KnowPanelUi,
        private readonly v: QuizView
    ) {}

    destroy(): void {
        this.alive = false;
        if (this.rmTimer) clearTimeout(this.rmTimer);
        this.rmTimer = undefined;
        if (this.dlTimer) clearTimeout(this.dlTimer);
        this.dlTimer = undefined;
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
        const hidden = new Set(await knowHiddenOf(bank));
        const info = await KernelDoc.infoOf([...new Set([...rootsMap.values(), ...registered])]);
        const titles = new Map([...info].map(([k, v]) => [k, v.title]));
        let docs = groupKnowByDoc(refs, rootsMap, await bank.knowledgeIndex(), titles);
        if (registered.length > 0) {
            const imp = await importedKnowDocs(registered, titles);
            for (const [k, v] of imp.info) info.set(k, v); // 展开行自带标题/hPath，供树化分支
            docs = mergeKnowDocs(docs, imp.docs, imp.manualAll, new Set(registered));
        }
        if (!this.alive) return; // 骨架已被重建，本次结果作废
        // 软隐藏过滤：knowHidden 集合里的 docId 整行从面板摘掉（思源文档不动）
        this.ui.docs = hidden.size > 0 ? docs.filter((d) => !hidden.has(d.docId)) : docs;
        this.ui.info = info;
        // 分支默认全展开（知识树浅、文档即叶子）；小节容器不进集合=默认收起
        this.ui.openPaths = new Set(collectBranchPaths(buildKnowTree(docs, info)));
        this.ui.phase = "ready";
        // 后台小节漂移检测（自托管三期）：比对内容哈希基线出 stale 徽标，
        // 基线自推进（一次性提示）；面板打开时新鲜，重开不重复报
        const kh = knowHash();
        const docIds = this.ui.docs.map((d) => d.docId);
        if (kh && docIds.length > 0) {
            void kh.diffDocs(docIds).then((stale) => {
                if (this.alive) this.ui.staleSecs = stale;
            });
        }
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

    /* ── 小节节点行动作（docs/knowledge-tree.md □3/□4） ── */

    /** 「刷此知识点」：物化活视图专题（确定性 id，qids 读取时实时刷新）
     *  直接切题库模式开刷——题库后续补题/转换回流同节点，轮次历史连续。 */
    drillNode(s: KnowSectionTreeView): void {
        const bank = this.bank();
        if (!bank) return;
        void ensureLiveCollection(bank, s, subKeysOf(s)).then(async (row): Promise<void> => {
            await bank.flush();
            await this.v
                .colFlowOf()
                .refresh()
                .then((): void => this.v.colFlowOf().refreshSide());
            this.v.colFlowOf().switchTo(row.id);
            this.v.switchWorkspace("drill");
        });
    }

    /** 「针对此节点生成」：收集弹窗预勾该节点子树（0 题节点合成行），
     *  生成模式/数量沿用弹窗既有控件。 */
    genNode(s: KnowSectionTreeView): void {
        const entriesOf = (n: KnowSectionTreeView): { key: string; title: string }[] => [
            { key: `kp:${n.id}`, title: n.title },
            ...n.children.flatMap(entriesOf),
        ];
        this.v.colFlowOf().openDialog(entriesOf(s));
    }

    open(docId: string): void {
        window.open(`siyuan://blocks/${docId}`);
    }

    /** 头部「导入」：文档选择浮层（多选，锚定按钮）。导入即关联——
     *  登记后自动跑零 AI 文本关联（knowledge 标签 ↔ 新根小节标题归一
     *  匹配），命中的题挂上引用，面板重载即可见计数。 */
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
                        .then(async () => {
                            const lex = await lexiconOfRoots(ids);
                            if (lex.size > 0) await linkBankByText(bank, lex, {});
                            // 导入即基线：小节内容哈希起点（stale 检测的比对基准）
                            const kh = knowHash();
                            if (kh) {
                                for (const rid of ids) {
                                    const docs = await expandKnowDocs(rid);
                                    await kh.baselineDocs(
                                        rid,
                                        docs.map((d) => d.docId)
                                    );
                                }
                            }
                        })
                        .then(() => this.load());
                },
            });
        })();
    }

    /** 头部「批量关联」：全部登记根 × 全库题，文本优先、可选 AI 兜底。 */
    batchLink(): void {
        const bank = this.bank();
        if (!bank) return;
        void openBatchLinkDialog({
            t: this.v.t,
            bank,
            modelId: this.v.aiModelId(),
            onDone: () => void this.load(),
        });
    }

    /* ── AI 建知识树（docs/knowledge-tree.md □1）：归纳章节 → 落盘
     *  `{章节}·知识树` 独立文档 → 自动登记进 knowRoots。运行中再点=
     *  中止；转换写窗口不开（createDocWithMd 与转换 append 并发互吞）。 ── */

    private outlineCtrl: AbortController | undefined;

    outline(d: KnowDocView): void {
        const bank = this.bank();
        if (!bank) return;
        if (this.ui.outlining === d.docId) {
            this.outlineCtrl?.abort(); // 再点=中止（catch 复位状态）
            return;
        }
        if (this.ui.outlining) return; // 同时只跑一份
        // 转换运行中不开第二条内核写流（createByMd/remove 与转换 append 并发互吞）
        if (convertRunActive()) {
            this.ui.outlineErr = this.v.t("convertBusy");
            return;
        }
        this.ui.outlineErr = undefined;
        this.ui.outlining = d.docId;
        const ctrl = new AbortController();
        this.outlineCtrl = ctrl;
        void generateKnowledgeOutline(d.docId, this.v.aiModelId(), ctrl.signal)
            .then(async (r): Promise<void> => {
                // 树文档自动登记（登记后词表/路由/关联全链路即包含树节点）
                const cur = await knowRootsOf(bank);
                if (!cur.includes(r.docId)) await setKnowRoots(bank, [...cur, r.docId]);
                await bank.flush();
                if (this.outlineCtrl === ctrl) this.outlineCtrl = undefined;
                this.ui.outlining = undefined;
                await this.load();
            })
            .catch((e: unknown): void => {
                if (this.outlineCtrl === ctrl) this.outlineCtrl = undefined;
                this.ui.outlining = undefined;
                this.ui.outlineErr = ctrl.signal.aborted
                    ? undefined
                    : `${this.v.t("knowOutlineFail")}${String((e as Error)?.message ?? e)}`;
            });
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
        // 同步复位「删除」armed：load 顶部清场避免状态机漂移
        if (this.dlTimer) clearTimeout(this.dlTimer);
        this.dlTimer = undefined;
        this.ui.dlArmed = undefined;
    }

    /** 退册整个登记子树。 */
    private async removeRoot(docId: string): Promise<void> {
        const bank = this.bank();
        if (!bank) return;
        await removeKnowRoot(bank, docId);
        await bank.flush();
        await this.load();
    }

    /* ── 「删除」两击确认（所有知识文档行可用；只清面板不动思源） ── */

    armDelete(docId: string): void {
        if (this.ui.dlArmed === docId) {
            this.disarm();
            void this.deleteDoc(docId);
            return;
        }
        // 不影响「移除」armed——两动独立，撤销 delete 仅清 dlArmed
        if (this.dlTimer) clearTimeout(this.dlTimer);
        this.dlTimer = undefined;
        this.ui.dlArmed = undefined;
        this.ui.dlArmed = docId;
        this.dlTimer = setTimeout((): void => {
            this.ui.dlArmed = undefined;
            this.dlTimer = undefined;
        }, 3000);
    }

    /** 「只清面板」删除（2026-08-31 改）：思源文档不进回收站——加进
     *  bank.knowHidden 软隐藏集合；登记根顺手退册 knowRoots 防死链。
     *  同一 doc 幂等。题库 kpRef 仍指原块，下次 BankReconcile 自动对账。 */
    private async deleteDoc(docId: string): Promise<void> {
        const bank = this.bank();
        if (!bank) return;
        await hideKnowDoc(bank, docId);
        if (this.ui.docs.some((d) => d.docId === docId && d.registered)) {
            await removeKnowRoot(bank, docId);
        }
        await bank.flush();
        await this.load();
    }
}

/** 全部分支路径（装载时 openPaths 初值=分支全开）。 */
function collectBranchPaths(nodes: KnowTreeNode[]): string[] {
    return nodes.flatMap((n) => [n.path, ...collectBranchPaths(n.children)]);
}
