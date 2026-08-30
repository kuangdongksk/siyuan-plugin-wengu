import type { WenguDoc } from "../../types";
import { mountSvelteApp, type MountedSvelteApp } from "../../ui/mountApp";
import type { TreeListNode } from "../../ui/TreeListTypes";
import { buildSideTree, type SideTreeNode } from "../render/SideTree";
import { fmt, mmss } from "../../ui/shared";
import SideTreeApp from "../component/SideTreeApp.svelte";

/**
 * 刷题侧栏树的挂载编排（TreeList 共享化 20260830）：整壳 innerHTML
 * 重建的架构下挂载点无法常驻——renderQuizShellFor 头部 detach、壳落
 * 后 mountSideTreeFor 重挂；applySideFilter 重灌侧栏体后经
 * remountSideTree 复用本次壳的回调重挂（搜索平铺无挂载点=只卸不挂）。
 * 折叠不再走 DOM 委托重绘：SideTreeApp 内部改展开集合，经
 * onPersistOpen 回写 prefs.sideTreeOpen。
 */

export interface SideTreeViewAccess {
    readonly el: HTMLElement;
    docs(): WenguDoc[];
    docId(): string;
    t(key: string): string;
    activeCollection(): string;
    sideTreeOpen(): string[];
    selectDoc(docId: string): void;
    setSideTreeOpen(open: string[]): void;
}

/** SideTreeApp 实例导出（挂载侧唯一入口）。 */
interface SideTreeExports {
    update(rows: TreeListNode[], metas: Map<string, string>, active: string, activeCol: string, open: string[]): void;
}

/** 文档行元信息串（题数 · 已刷 · 累计用时；与旧渲染逐字一致）。 */
function docMeta(d: WenguDoc, t: (key: string) => string): string {
    return [
        fmt(t("exerciseCount"), { n: String(d.total) }),
        d.attempted > 0 ? fmt(t("drilledCount"), { a: String(d.attempted) }) : "",
        d.totalTime > 0 ? mmss(d.totalTime) : "",
    ]
        .filter(Boolean)
        .join(" · ");
}

function toRows(nodes: SideTreeNode[], t: (key: string) => string, metas: Map<string, string>): TreeListNode[] {
    return nodes.map((n): TreeListNode => {
        const children = toRows(n.children, t, metas);
        if (!n.doc) return { key: n.path, name: n.name, tip: n.path, kind: "branch", children };
        metas.set(n.doc.id, docMeta(n.doc, t));
        return {
            key: n.path,
            name: n.doc.title || n.doc.id,
            tip: n.doc.hPath,
            kind: "doc",
            id: n.doc.id,
            children,
        };
    });
}

let app: MountedSvelteApp<SideTreeExports> | null = null;
/** 本次壳的行回调（mountSideTreeFor 登记，detachSideTree 清空）。 */
let hooks: { onOpen(id: string): void; onPersistOpen(open: string[]): void } | null = null;

function unmountApp(): void {
    app?.unmount();
    app = null;
}

/** 重挂（applySideFilter 重灌侧栏体后调；无挂载点=搜索态，只卸不挂）。 */
export function remountSideTree(
    el: HTMLElement,
    docs: WenguDoc[],
    docId: string,
    activeCollection: string,
    sideTreeOpen: string[],
    t: (key: string) => string
): void {
    const host = el.querySelector<HTMLElement>("[data-side-tree]");
    unmountApp();
    if (!host || !hooks) return;
    const metas = new Map<string, string>();
    const rows = toRows(buildSideTree(docs), t, metas);
    const mounted = mountSvelteApp(SideTreeApp, host, {
        onOpen: hooks.onOpen,
        onPersistOpen: hooks.onPersistOpen,
    });
    // *.svelte 的环境声明不带实例导出类型，这里收口一次
    app = { app: mounted.app as SideTreeExports, unmount: mounted.unmount };
    app.app.update(rows, metas, docId, activeCollection, sideTreeOpen);
}

/** 壳落定后登记回调并首挂（QuizShell 调，适配 QuizView）。 */
export function mountSideTreeFor(v: SideTreeViewAccess): void {
    hooks = { onOpen: (id) => v.selectDoc(id), onPersistOpen: (open) => v.setSideTreeOpen(open) };
    remountSideTree(v.el, v.docs(), v.docId(), v.activeCollection(), v.sideTreeOpen(), v.t);
}

/** 整壳重建前的卸载（同 detachBankPanels 位；回调一并作废）。 */
export function detachSideTree(): void {
    unmountApp();
    hooks = null;
}
