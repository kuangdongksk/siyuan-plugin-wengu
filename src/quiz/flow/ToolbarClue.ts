import { showMessage } from "siyuan";
import { addClue } from "./ClueFlow";
import type { QuizView } from "../index";

/**
 * 编辑器工具栏「标为线索」（3.8.3 addToolbarItem）：在**普通文档**
 * 编辑器里选中文字（如阅读材料原文/讲义时），官方工具栏点「标为
 * 线索」挂到温故活动视图的当前题（跨容器标注）。温故页签内材料区
 * 是纯 HTML 渲染非 Protyle、官方工具栏不弹——页签内仍走 AnnoFlow
 * 自造浮层，两入口并存、同一 addClue 收口。
 */

/** 工具栏回调（addToolbarItem 注册；选区无文字时工具栏本身不出）。 */
export function toolbarMarkClue(t: (k: string) => string, view: () => QuizView | undefined): void {
    const text = document.getSelection()?.toString().trim() ?? "";
    if (!text) return;
    const v = view();
    const q = v?.currentQuestion();
    if (!v || !v.currentSession() || !q) {
        showMessage(t("clueNoSession"));
        return;
    }
    if (!q.group) {
        showMessage(t("clueOnlyGroup"));
        return;
    }
    if (addClue(v, text)) showMessage(t("clueMarked"));
}

/** 注册进插件实例（onload 调；返回注销函数供 onunload，防重载叠影）。 */
export function registerClueToolbar(
    plugin: { addToolbarItem?: (item: { name: string; icon: string; tip: string; click: () => void }) => void },
    t: (k: string) => string,
    view: () => QuizView | undefined
): (() => void) | undefined {
    if (typeof plugin.addToolbarItem !== "function") return undefined; // 老前端（<3.8.3）特性检测
    plugin.addToolbarItem({
        name: "wengu-clue",
        icon: "iconInfo",
        tip: t("clueMark"),
        click: () => toolbarMarkClue(t, view),
    });
    return () => {
        (plugin as { removeToolbarItem?: (name: string) => void }).removeToolbarItem?.("wengu-clue");
    };
}
