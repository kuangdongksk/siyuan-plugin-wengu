import { Dialog } from "siyuan";
import type { ConvertProgressRecord } from "../service/ConvertBatch";
import type { ConvertRunCfg } from "../service/ConvertRun";
import { ConvertDialogCtl } from "../core/ConvertDialogCtl";
import ConvertDialogApp from "../components/ConvertDialogApp.svelte";
import { mountSvelteApp, type MountedSvelteApp } from "../../ui/mountApp";

/**
 * AI 转习题对话框编排（Svelte 化 20260830，表单内容在
 * comp/ConvertDialogApp，状态收集与联动在 core/ConvertDialogCtl）：
 * 选模型 + 源文档（更多选项：转换开关/并发批数/生成位置/知识点根）。
 * 弹窗只收集参数——点「开始转换」即关窗，批次循环交给 ConvertRun
 * 单例运行器：温故页签渐进呈现做题界面，页内转换条展示进度并支持
 * 停止/保留进度/全部丢弃；有保留进度时弹窗内出现「继续生成」入口。
 * 已有转换在跑时不再一句报错打发：弹窗提示 + 底部「查看进行中的转换」
 * 直达转换管理面板。
 */

/** 对话框依赖的宿主能力（QuizView 提供）。 */
export interface ConvertDialogDeps {
    t: (key: string) => string;
    /** 文档 id 输入框默认值（顶栏带来的活动文档）。 */
    activeDocId: string;
    /** 模型预选值（prefs 上次临时用 > 设置默认 > 空串=默认）。 */
    initialModelId: string;
    /** 填空转选择预选值（prefs 上次 > 设置默认）。 */
    initialFillToChoice: boolean;
    /** 大题拆多步预选值（prefs 上次 > 设置默认）。 */
    initialBigToSteps: boolean;
    /** 并发批数预选值（设置默认，1=串行）。 */
    initialParallel: number;
    /** 知识点根文档预选（prefs 上次，多个 id 空格分隔的原始串）。 */
    initialKnowRoots: string;
    /** 用户本次的选择（记入 prefs；knowRoots 为原始输入串）。 */
    saveChoice(modelId: string, fillToChoice: boolean, bigToSteps: boolean, knowRoots: string): void;
    /** 读取某源文档的未完成转换进度（无则 undefined）。 */
    getProgress(srcDocId: string): ConvertProgressRecord | undefined;
    /** 转换状态变化（禁用/恢复目录底部的转换按钮；PDF 导入流程也用）。 */
    setConverting(v: boolean): void;
    /** 启动转换运行器（false=已有转换在跑）。 */
    startRun(cfg: ConvertRunCfg): boolean;
    /** 是否已有转换在跑（弹窗打开时的面板入口提示）。 */
    isRunning(): boolean;
    /** 打开转换管理面板（被拒/点「查看进行中的转换」时）。 */
    openPanel(): void;
}

export function openConvertDialog(deps: ConvertDialogDeps): void {
    const ctl = new ConvertDialogCtl();
    let app: MountedSvelteApp | undefined;
    const dialog = new Dialog({
        title: deps.t("convertBtn"),
        width: "560px",
        content: "<div data-convert-dlg-host></div>",
    });
    const close = (): void => {
        app?.unmount();
        app = undefined;
        dialog.destroy();
    };
    const host = dialog.element.querySelector<HTMLElement>("[data-convert-dlg-host]");
    if (host) app = mountSvelteApp(ConvertDialogApp, host, { ctl, deps, onClose: close });
}
