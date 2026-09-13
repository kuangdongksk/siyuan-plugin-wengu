import type { ConvertProgressRecord } from "../service/run/ConvertBatch";
import type { SubDocRef } from "../service/source/SubDocs";

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
    /** 并发片流水线数（分片并行：片间并行、片内仍由 AI 自推进；1=串行）。
     *  弹窗照常露出该选择（ConvertDialogApp），初值取设置面板的
     *  convertParallel，随 start 传入转换运行器。 */
    parallel: number;
    knowRoots: string;
    /** 「连同子文档」勾选（默认关）：勾上=把子文档一起串行转（每篇各自
     *  成题集）；未勾选时若源是**空文档且有子文档**（文件夹式文档），
     *  弹窗自动提示「将转换 N 个子文档」并展开（见 batchHint）。 */
    includeSub: boolean;
    /** 「重转已转换过的篇」勾选（默认关，Issue #62）：仅**队列模式**显示
     *  （勾了「连同子文档」或源为空壳文件夹时）。不勾时重发队列会跳过
     *  「无续跑记录但题库已有该源文档题集」的篇（零 AI）。 */
    reconvertDone: boolean;
    /* 回显（getDocInfo 解析的标题路径；空=占位「选择…」） */
    docEcho: string;
    knowEcho: string;
    /* 动态状态 */
    /** 打开时已有转换在跑（「查看进行中的转换」按钮露出）。 */
    running: boolean;
    status: ConvertDlgStatus | undefined;
    /** 源文档的未完成转换进度（有则露「继续生成」）。 */
    resumeRec: ConvertProgressRecord | undefined;
    /** 源文档的子文档清单（planSubDocs 异步探查产物；空数组=无子文档）。 */
    subDocs: SubDocRef[];
    /** 源自身是否空壳（文件夹式文档判据）。 */
    docEmpty: boolean;
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
        knowRoots: "",
        includeSub: false,
        reconvertDone: false,
        docEcho: "",
        knowEcho: "",
        running: false,
        status: undefined,
        resumeRec: undefined,
        subDocs: [],
        docEmpty: false,
    };
}
