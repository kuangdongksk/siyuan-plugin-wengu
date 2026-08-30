import { Dialog } from "siyuan";
import type { ConvertProgressRecord } from "../service/ConvertBatch";
import type { ConvertRunCfg } from "../service/ConvertRun";
import { ConvertDialogCtl } from "../core/ConvertDialogCtl";
import ConvertDialogApp from "../component/ConvertDialogApp.svelte";
import { mountSvelteApp, type MountedSvelteApp } from "../../ui/mountApp";

/**
 * AI 转习题对话框编排（Svelte 化 20260830，表单内容在
 * comp/ConvertDialogApp，状态收集与联动在 core/ConvertDialogCtl）：
 * 选模型 + 转换开关 + 并发批数 + 文档 id + 转换方式（默认原位替换，
 * 可切另存）+ 从 PDF 导入。弹窗只收集参数——点「开始转换」即关窗，
 * 批次循环交给 ConvertRun 单例运行器：温故页签渐进呈现做题界面，页内
 * 转换条展示进度并支持停止/保留进度/全部丢弃；有保留进度时弹窗内出现
 * 「继续生成」入口。已有转换在跑时不再一句报错打发：弹窗提示 + 底部
 * 「查看进行中的转换」直达转换管理面板。
 */

/** 对话框依赖的宿主能力（QuizView 提供）。 */
export interface ConvertDialogDeps {
    t: (key: string) => string;
    /** 文档 id 输入框默认值（顶栏带来的活动文档）。 */
    activeDocId: string;
    /** MinerU API token（设置页配置，空=未配置）。 */
    mineruToken: string;
    /** 模型预选值（prefs 上次临时用 > 设置默认 > 空串=默认）。 */
    initialModelId: string;
    /** 填空转选择预选值（prefs 上次 > 设置默认）。 */
    initialFillToChoice: boolean;
    /** 大题拆多步预选值（prefs 上次 > 设置默认）。 */
    initialBigToSteps: boolean;
    /** 并发批数预选值（设置默认，1=串行）。 */
    initialParallel: number;
    /** 生成位置预选：same=原文档同目录；custom=指定父文档下面。 */
    initialTargetMode: "same" | "custom";
    /** 指定父文档 id 预选（生成位置=custom 时用）。 */
    initialTargetId: string;
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
    // 导入 busy 期间接管右上角 X：先中止 MinerU 再关窗——原 X 直接
    // destroy，导入变后台孤儿（状态写在分离 DOM 上不可见、转换按钮锁
    // 到轮询自然结束最长 20 分钟，20260828 二轮审查）
    dialog.element.querySelector(".b3-dialog__close")?.addEventListener(
        "click",
        (ev) => {
            if (!ctl.isBusy()) return; // 非 busy 走原生关闭
            ev.stopPropagation();
            ctl.stopImport(); // pollResult 每轮检查点接住，流程即刻收口
            close();
        },
        true // capture：抢在 Dialog 自带关闭处理之前
    );
}
