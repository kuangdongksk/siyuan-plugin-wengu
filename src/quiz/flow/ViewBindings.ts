import { Menu } from "siyuan";
import { bindCardActions } from "../../bank/ui/RegenDialog";
import { livingSourceOf } from "../service/DocOps";
import { bindAnnotationLayer, type AnnoCallbacks } from "./AnnoFlow";
import { addClue, bindClueJudge } from "./ClueFlow";
import type { QuizView } from "../index";
import type { QuestionBank } from "../../bank/data/QuestionBank";

/**
 * 视图通用事件绑定（从 QuizView 拆出）：构造器一次性事件委托
 * （块引用跳转/题卡「重新生成」/标注层/「AI 复核线索」）+ 目录文档
 * 右键菜单。头部按钮/目录搜索/文档项点击 6-5 起随侧栏与头部 Svelte
 * 化退役——那些事件经 SidePanelApp/QuizHeadApp 的 onAct 回调直调
 * QuizView.sideAct，不再走 DOM 逐钮绑定；右键菜单（错题复习/重新
 * 导入/删除/变式）仍需 DOM 委托（组件右键语义弱于原生 contextmenu，
 * 且带 async livingSourceOf 门控），保留在本文件。
 */

/** 构造器一次性事件委托（自 QuizView 拆出压 500 行红线）：块引用跳转
 *  + 题卡「重新生成」+ 标注层（线索/生词）与「AI 复核线索」委托。
 *  返回标注层解绑函数（destroy 时调）。bank 是视图私有存储，经参传入。 */
export function bindViewFrameFor(
    v: QuizView,
    bank: QuestionBank | undefined,
    wordStore: AnnoCallbacks["wordStore"] | undefined,
    reload: () => void
): () => void {
    bindCardActions(v.el, {
        t: v.t,
        find: (qid) => v.list.find((x) => x.id === qid),
        bank,
        modelId: v.aiModelId,
        reload,
    });
    const cleanup = bindAnnotationLayer(v.el, {
        t: v.t,
        onMarkClue: (text) => addClue(v, text),
        wordStore,
    });
    bindClueJudge(v);
    bindDocContextMenu(v);
    return cleanup;
}

/** 目录文档右键菜单（错题复习/重新导入/删除此题集/变式重练）：
 *  事件委托挂视图根（侧栏随整壳重建，委托不失效）。重新导入需
 *  livingSourceOf 查库门控（有一次 SQL 往返，菜单迟一拍开）。
 *  平铺搜索行带 data-docid；树行=TreeList 的 data-id。 */
function bindDocContextMenu(v: QuizView): void {
    v.el.addEventListener("contextmenu", (ev) => {
        const node = (ev.target as HTMLElement).closest<HTMLElement>("[data-docid], [data-id]");
        // 树行（TreeList 的 data-id）只认侧栏内的——题卡的 data-qid
        // 等其他 data-id 不触发目录菜单（closest 命中即停，须先确认
        // 命中节点在侧栏主体里）
        const inSide = (ev.target as HTMLElement).closest("[data-side-body]");
        if (!node || !inSide) return;
        const docId = node.dataset.docid ?? node.dataset.id;
        if (!docId) return;
        const pos = ev as MouseEvent;
        ev.preventDefault();
        ev.stopPropagation();
        void (async () => {
            const menu = new Menu("wengu-doc-menu");
            menu.addItem({
                icon: "iconInfo",
                label: v.t("reviewMenuLabel"),
                click: () => v.enterReviewMode({ docId }),
            });
            if (await livingSourceOf(docId)) {
                menu.addItem({
                    icon: "iconRefresh",
                    label: v.t("reimportMenuLabel"),
                    click: () => v.reimportDocOf(docId),
                });
            }
            menu.addItem({
                icon: "iconTrashcan",
                label: v.t("removeSetMenuLabel"),
                click: () => v.removeSetOf(docId),
            });
            menu.addItem({
                icon: "iconSparkles",
                label: v.t("variantDrillMenuLabel"),
                click: () => v.variantDrillOf(docId),
            });
            menu.open({ x: pos.clientX, y: pos.clientY });
        })();
    });
}
