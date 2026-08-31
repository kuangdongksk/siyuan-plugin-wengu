import { Dialog } from "siyuan";
import type { ConvertProgressRecord } from "../service/ConvertBatch";
import { ConvertPanelCtl } from "../core/ConvertPanelCtl";
import ConvertPanelApp from "../components/ConvertPanelApp.svelte";
import { mountSvelteApp, type MountedSvelteApp } from "../../ui/mountApp";

/**
 * 转换管理面板编排（Svelte 化 20260830，内容在 comp/ConvertPanelApp，
 * 快照订阅与两击丢弃在 core/ConvertPanelCtl）：转换弹窗不再用「已有
 * 转换在进行中」一句报错打发——被拒时直接打开本面板。面板分两区：
 * ①进行中（ConvertRun 单例快照，订阅刷新）：进度行 + 终止，终止后
 * 待抉择时给「保留已生成/全部丢弃」（与页内转换条同款动作）；②未完成
 * 进度（prefs 记录，跨重启仍在）：逐条「继续生成」/「丢弃进度」
 * ——记录带 docId（非原位模式/原位已建临时文档）时**连同转换新建的
 * 部分习题文档一起删**；原位只存 kramdown 的记录没有新建文档，仅清
 * 内部数据。已确认语义，勿改成「只清书签不删文档」。
 */

/** 面板依赖（openWenguConvert 组装）。 */
export interface ConvertPanelDeps {
    t: (key: string) => string;
    /** 未完成进度记录（prefs 持久）。 */
    listProgress(): { srcDocId: string; rec: ConvertProgressRecord }[];
    /** 丢弃一条进度记录：清 prefs；rec 带 docId（转换新建的文档）时一并删除。 */
    discardProgress(srcDocId: string, rec: ConvertProgressRecord): void;
    /** 继续生成：打开转换弹窗并预填该源文档（resume 提示接管）。 */
    resumeProgress(srcDocId: string): void;
}

/** 单例（重复打开刷新旧面板）。 */
let panel: Dialog | undefined;
let panelApp: MountedSvelteApp | undefined;

export function openConvertPanel(deps: ConvertPanelDeps): void {
    closeConvertPanel();
    const ctl = new ConvertPanelCtl();
    const dialog = new Dialog({
        title: deps.t("convertPanelTitle"),
        width: "480px",
        content: "<div data-convert-panel-host></div>",
    });
    panel = dialog;
    const close = (): void => closeConvertPanel();
    const host = dialog.element.querySelector<HTMLElement>("[data-convert-panel-host]");
    if (host) panelApp = mountSvelteApp(ConvertPanelApp, host, { ctl, deps, onClose: close });
}

/** 关面板（单例指针一并复位，避免对已销毁 Dialog 重复 destroy）。 */
function closeConvertPanel(): void {
    panelApp?.unmount();
    panelApp = undefined;
    panel?.destroy();
    panel = undefined;
}
