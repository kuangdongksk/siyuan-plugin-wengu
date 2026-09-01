import type { ConvertProgressRecord } from "../service/ConvertBatch";

/**
 * AI 转习题弹窗的响应态形状（四件套之一，模式见
 * docs/svelte-migration.md）。表单字段全进 ui（旧实现散在 DOM 控件里，
 * start 时逐个 querySelector 收集）；标题路径回显是异步解析产物，
 * 各自带竞态序号防晚到串位。
 */

export interface ConvertDialogUi {
    /* 表单字段 */
    docId: string;
    modelId: string;
    fillToChoice: boolean;
    bigToSteps: boolean;
    parallel: number;
    targetMode: "same" | "custom";
    targetId: string;
    knowRoots: string;
    /* 回显（getDocInfo 解析的标题路径；空=占位「选择…」） */
    docEcho: string;
    targetEcho: string;
    knowEcho: string;
    /* 动态状态 */
    /** 打开时已有转换在跑（「查看进行中的转换」按钮露出）。 */
    running: boolean;
    status: ConvertDlgStatus | undefined;
    /** 源文档的未完成转换进度（有则露「继续生成」）。 */
    resumeRec: ConvertProgressRecord | undefined;
}

export interface ConvertDlgStatus {
    html: string;
    kind: "ok" | "err" | "muted";
    /** 追加「部分进度已保留」尾注（stop 后的提示）。 */
    keptPartial?: boolean;
}

/** 初始态（$state 包装在 ConvertDialogApp 内完成；字段由 ctl.attach 覆写）。 */
export function initialConvertDialogUi(): ConvertDialogUi {
    return {
        docId: "",
        modelId: "",
        fillToChoice: false,
        bigToSteps: false,
        parallel: 1,
        targetMode: "same",
        targetId: "",
        knowRoots: "",
        docEcho: "",
        targetEcho: "",
        knowEcho: "",
        running: false,
        status: undefined,
        resumeRec: undefined,
    };
}
