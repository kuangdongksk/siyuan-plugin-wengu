import { showMessage, type Plugin } from "siyuan";
import { addClue } from "./ClueFlow";
import type { QuizView } from "../index";

/**
 * 编辑器工具栏「标为线索」（3.8.3 addToolbarItem）：在**普通文档**
 * 编辑器里选中文字（如阅读材料原文/讲义时），官方工具栏点「标为
 * 线索」挂到温故活动视图的当前题（跨容器标注）。反馈三态（新标/
 * 已存在/前置失败）都带题干摘要，让用户确认标到了哪道题。温故页签
 * 内材料区是纯 HTML 渲染非 Protyle、官方工具栏不弹——页签内仍走
 * AnnoFlow 自造浮层，两入口并存、同一 addClue 收口。
 */

/** 工具栏按钮名（removeToolbarItem 同名回收；勿与内置工具栏名冲突）。 */
const TOOLBAR_NAME = "wengu-clue";

/** 选段长度上限（与 AnnoFlow 浮层 positionBar 同口径——线索要的是定位句不是整段）。 */
const CLUE_MAX_LEN = 120;

/** 题干摘要长度。 */
const STEM_EXCERPT = 16;

/** 工具栏回调（addToolbarItem 注册；选区无文字时工具栏本身不出）。 */
export function toolbarMarkClue(t: (k: string) => string, view: () => QuizView | undefined): void {
    const text = document.getSelection()?.toString().trim() ?? "";
    if (!text) return;
    if (text.length > CLUE_MAX_LEN) {
        showMessage(t("clueTooLong"));
        return;
    }
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
    const r = addClue(v, text);
    if (r.ok && r.dup) {
        showMessage(t("clueDup"));
    } else if (r.ok) {
        showMessage(
            t("clueMarked")
                .replace("{stem}", stemExcerpt(q.stemMd ?? ""))
                .replace("{n}", String(r.total))
        );
    }
}

/** 注册进插件实例（onload 调；返回注销函数供 onunload，防重载叠影）。
 *  老前端（<3.8.3）无此 API，特性检测跳过。 */
export function registerClueToolbar(
    plugin: Plugin,
    t: (k: string) => string,
    view: () => QuizView | undefined
): (() => void) | undefined {
    if (typeof plugin.addToolbarItem !== "function") return undefined;
    plugin.addToolbarItem({
        name: TOOLBAR_NAME,
        icon: "iconWenguClue",
        tip: t("clueToolbarTip"),
        hotkey: "⌘⇧L",
        click: () => toolbarMarkClue(t, view),
    });
    return () => {
        if (typeof plugin.removeToolbarItem === "function") plugin.removeToolbarItem(TOOLBAR_NAME);
    };
}

/** 题干可读摘要：剥 markdown/公式记号取前 16 字（toast 里确认标到哪题）。 */
function stemExcerpt(stem: string): string {
    const s = stem
        .replace(/\$\$?[^$]*\$\$?/g, "⟨式⟩") // 公式整体占位，别让 LaTeX 残字混进摘要
        .replace(/[#*`>_~\[\]()]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    return s.length > STEM_EXCERPT ? `${s.slice(0, STEM_EXCERPT)}…` : s;
}
