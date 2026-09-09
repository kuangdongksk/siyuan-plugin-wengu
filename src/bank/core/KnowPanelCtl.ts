import { Armed, errText } from "./../../ui/shared";
import type { QuizView } from "../../quiz";
import type { QuestionBank } from "../data/QuestionBank";
import { kpRootMap } from "../data/BankReconcile";
import { collectKpRefs } from "../data/BankRegen";
import { knowRootsOf, removeKnowRoot, setKnowRoots } from "../data/KnowRoots";
import { knowTreeByNode, knowTreesOf } from "../data/KnowTrees";
import { notifyError, notifyInfo } from "../../ui/Notify";
import { openRelatedDialog } from "../ui/RelatedDialog";
import { openMatchDialog } from "../ui/MatchDialog";
import { openBatchLinkDialog } from "../ui/BatchLinkDialog";
import { lexiconOfRoots, linkBankByText } from "../data/KnowLinkText";
import { knowHash } from "../data/KnowHash";
import { expandKnowDocs, type KnowDocEntry } from "../../convert/service/KnowledgeLink";
import { generateKnowledgeOutline, outlineSrcHash } from "../../convert/service/KnowOutline";
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
import { SvelteSet } from "svelte/reactivity";
import type { KnowPanelUi } from "./KnowPanelUi";

/**
 * 知识文档面板控制器（四件套之一）：装载聚合（kp 引用 → 根文档映射 →
 * 递归展开手动导入，详见 ui/KnowledgePanel 的纯函数层）、折叠/两击退册
 * 状态机、行内五动作（匹配/转习题/关联/打开/移除）。
 * 移除 = 仅退册整个登记子树（仅登记根行可用，思源文档不动，可重新
 * 导入登记）。旧「删除」按钮（软隐藏 bank.knowHidden）20260902 移除——
 * 与移除语义撞车且隐藏后无反悔出口。
 * 旧 paintTree 整树 innerHTML 重绘换成 ui 字段写入；卸载后 load 作废
 * （alive 标志，对应旧 root.isConnected 竞态守卫——装载期间骨架可能被
 * refreshSide 重建）。
 */
export class KnowPanelCtl {
    private alive = true;
    /** 「移除」两击确认（armed 与渲染同源，重拉后不漂移）。 */
    private rmArm = new Armed<string>((v) => (this.ui.rmArmed = v));
    /** 「重新索引/索引 N 篇」两击确认（total=批量补齐篇数提示）。 */
    private outlineArm = new Armed<{ docId: string; total: number }>((v) => {
        this.ui.outlineArmed = v?.docId;
        this.ui.outlineArmTotal = v?.total;
    });

    constructor(
        private readonly ui: KnowPanelUi,
        private readonly v: QuizView
    ) {}

    destroy(): void {
        this.alive = false;
        this.rmArm.disarm();
        this.outlineArm.disarm();
    }

    private bank(): QuestionBank | undefined {
        return this.v.bankStore();
    }

    /** 装载/重拉（刷新、导入、退册、归纳后都走这里）。 */
    async load(): Promise<void> {
        const bank = this.bank();
        if (!bank) {
            this.ui.phase = "nobank";
            return;
        }
        this.ui.phase = "loading";
        this.disarm();
        this.disarmOutline();
        const refs = await collectKpRefs(bank);
        const rootsMap = await kpRootMap(bank, [...refs.keys()]);
        const registered = await knowRootsOf(bank);
        const trees = await knowTreesOf(bank);
        const info = await KernelDoc.infoOf([...new Set([...rootsMap.values(), ...registered])]);
        const titles = new Map([...info].map(([k, v]) => [k, v.title]));
        let docs = groupKnowByDoc(refs, rootsMap, await bank.knowledgeIndex(), titles);
        if (registered.length > 0) {
            const imp = await importedKnowDocs(registered, titles, trees);
            for (const [k, v] of imp.info) info.set(k, v); // 展开行自带标题/hPath，供树化分支
            docs = mergeKnowDocs(docs, imp.docs, imp.manualAll, new Set(registered));
        }
        if (!this.alive) return; // 骨架已被重建，本次结果作废
        this.ui.docs = docs;
        this.ui.info = info;
        // 分支默认全展开（知识树浅、文档即叶子）；小节容器不进集合=默认收起
        this.ui.openPaths = new SvelteSet(collectBranchPaths(buildKnowTree(docs, info)));
        this.ui.phase = "ready";
        // 后台：内部知识树 staleness（源内容指纹比对，树行出「源已变更」
        // 徽标）+ 小节漂移检测（自托管三期：内容哈希基线，基线自推进）
        const staleTrees = new Set<string>();
        for (const [srcId, tree] of Object.entries(trees)) {
            const cur = await outlineSrcHash(srcId).catch((): string => "");
            if (cur && cur !== tree.srcHash) staleTrees.add(srcId);
        }
        if (this.alive) this.ui.staleTrees = staleTrees;
        const kh = knowHash();
        const docIds = this.ui.docs.map((d) => d.docId);
        if (kh && docIds.length > 0) {
            void kh.diffDocs(docIds).then((stale) => {
                if (this.alive) this.ui.staleSecs = stale;
            });
        }
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

    open(id: string): void {
        // 内部知识树节点无真实块——降级跳到源章节文档
        void (async (): Promise<void> => {
            try {
                const bank = this.bank();
                if (bank) {
                    const hit = knowTreeByNode(await knowTreesOf(bank), id);
                    if (hit) {
                        window.open(`siyuan://blocks/${hit.tree.srcId}`);
                        return;
                    }
                }
            } catch (e) {
                console.warn("[wengu] 知识树节点定位失败，降级直跳", e); // 查库失败不该吞掉跳转
            }
            window.open(`siyuan://blocks/${id}`);
        })();
    }

    /** 头部「导入」：文档选择浮层（多选，锚定按钮）。导入即关联——
     *  登记后自动跑零 AI 文本关联（knowledge 标签 ↔ 新根小节标题归一
     *  匹配），命中的题挂上引用，面板重载即可见计数。 */
    importRoots(anchor: HTMLElement): void {
        const bank = this.bank();
        if (!bank) return;
        void (async () => {
            try {
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
                                const trees = await knowTreesOf(bank);
                                const lex = await lexiconOfRoots(ids, trees);
                                if (lex.size > 0) {
                                    const r = await linkBankByText(bank, lex, {});
                                    if (r.hit > 0)
                                        notifyInfo({ key: "notifyAutoLinkDone", vars: { n: String(r.hit) } });
                                }
                                // 导入即基线：小节内容哈希起点（stale 检测的比对基准）
                                const kh = knowHash();
                                if (kh) {
                                    for (const rid of ids) {
                                        const docs = await expandKnowDocs(rid, trees);
                                        await kh.baselineDocs(
                                            rid,
                                            docs.map((d) => d.docId)
                                        );
                                    }
                                }
                            })
                            .then(() => this.load())
                            .catch((e: unknown): void => {
                                // 整链原为 unhandled rejection（面板连重载都不发生）
                                notifyError({
                                    key: "notifyAutoLinkFail",
                                    vars: { msg: errText(e) },
                                });
                                void this.load();
                            });
                    },
                });
            } catch (e) {
                // knowRootsOf 查库失败：原裸 IIFE 吞成 unhandled rejection，
                // 选择浮层静默不开（点击像没反应）
                notifyError({ key: "notifyAutoLinkFail", vars: { msg: errText(e) } });
            }
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

    /* ── AI 索引（原「建知识树」，docs/knowledge-tree.md □1；20260903 起
     *  不落文档）：归纳章节 → 大纲直写题库（bank.knowTrees）。按钮统一叫
     *  「索引」；单篇已有索引再点=重新索引，文件夹式文档（思源文档当目录
     *  用，自身无内容、子文档有货）= 批量补齐子树中还没有索引的文档（已
     *  索引的不动，重索单篇走行内），两者都两击确认（3s 复位）后才真跑；
     *  批量串行逐篇、空文档跳过、部分失败不打断；运行中再点=中止（批量
     *  中止整队）；全程零内核写（只剩 SQL 读+AI），与转换并发安全。 ── */

    private outlineCtrl: AbortController | undefined;

    outline(d: KnowDocView): void {
        const bank = this.bank();
        if (!bank) return;
        if (this.ui.outlining === d.docId) {
            this.outlineCtrl?.abort(); // 再点=中止（catch 复位状态）
            return;
        }
        if (this.ui.outlining) return; // 同时只跑一份（批量占同一坑位）
        void this.resolveOutline(d, bank);
    }

    /** 解析索引目标（单篇 / expandKnowDocs 展开子树补缺）→ 按需两击
     *  确认 → 串行执行。展开失败退单篇（与旧行为一致）。 */
    private async resolveOutline(d: KnowDocView, bank: QuestionBank): Promise<void> {
        const expanded = await expandKnowDocs(d.docId).catch((): KnowDocEntry[] => []);
        if (!this.alive || this.ui.outlining) return; // 解析期间面板已重建或已有任务开跑
        const trees = await knowTreesOf(bank);
        const ids = expanded.length > 0 ? expanded.map((e) => e.docId) : [d.docId];
        if (ids.length > 1) {
            const pending = ids.filter((id) => !trees[id]);
            if (pending.length === 0) {
                notifyInfo({ key: "notifyOutlineAllIndexed" });
                return;
            }
            if (this.ui.outlineArmed !== d.docId) {
                this.armOutline(d.docId, pending.length);
                return;
            }
            this.runOutline(d.docId, pending, bank);
            return;
        }
        if (trees[d.docId] && this.ui.outlineArmed !== d.docId) {
            this.armOutline(d.docId, 0); // 重新索引需二次确认：首击进 arm 态
            return;
        }
        this.runOutline(d.docId, [d.docId], bank);
    }

    /** 串行执行（anchor=占「索引中」坑位的行；单篇沿用逐篇通知口径）。 */
    private runOutline(anchorId: string, ids: string[], bank: QuestionBank): void {
        this.disarmOutline();
        this.ui.outlineErr = undefined;
        this.ui.outlining = anchorId;
        const ctrl = new AbortController();
        this.outlineCtrl = ctrl;
        const batch = ids.length > 1;
        void (async (): Promise<void> => {
            let ok = 0;
            let skip = 0;
            let fail = 0;
            let count = 0;
            let lastErr = "";
            for (const id of ids) {
                if (ctrl.signal.aborted) break;
                try {
                    const r = await generateKnowledgeOutline(id, this.v.aiModelId(), ctrl.signal, bank);
                    ok++;
                    count += r.count;
                } catch (e) {
                    if (ctrl.signal.aborted) break;
                    const msg = errText(e);
                    if (msg.includes("doc has no content"))
                        skip++; // 空文档（目录壳）
                    else {
                        fail++;
                        lastErr = msg;
                    }
                }
            }
            if (this.outlineCtrl === ctrl) this.outlineCtrl = undefined;
            this.ui.outlining = undefined;
            if (ctrl.signal.aborted) return; // 中止：静默复位（与单篇中止同口径）
            if (fail === ids.length) {
                // 全灭才算失败态（行内错误+通知）；部分失败走汇总不打断
                this.ui.outlineErr = `${this.v.t("knowOutlineFail")}${lastErr}`;
                notifyError({ key: "notifyOutlineFail", vars: { msg: lastErr } });
                return;
            }
            notifyInfo(
                batch
                    ? { key: "notifyOutlineBatchDone", vars: { n: String(ok), k: String(skip), m: String(fail) } }
                    : { key: "notifyOutlineDone", vars: { n: String(count) } }
            ); // AI 长任务，用户可能已离开
            await this.load();
        })();
    }

    /** 进「确认重新索引/确认索引 N 篇」arm 态（3s 自动复位）。 */
    private armOutline(docId: string, total: number): void {
        this.outlineArm.arm({ docId, total });
    }

    /* ── 「移除」两击确认（3s 复位；armed 与渲染同源，重拉后不漂移） ── */

    armRemove(docId: string): void {
        if (this.ui.rmArmed === docId) {
            this.disarm();
            void this.removeRoot(docId);
            return;
        }
        this.disarm();
        this.rmArm.arm(docId);
    }

    private disarm(): void {
        this.rmArm.disarm();
    }

    /** 复位「重新索引」两击确认（3s 到点/重拉/确认后调用）。 */
    private disarmOutline(): void {
        this.outlineArm.disarm();
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
