/**
 * 转换编排的数据形态层（20260915 自 `ConvertBatch` 拆出，纯 move 语义、
 * 零行为变更）：交付计划 `SubmitPlan`（plan/apply 两层之间的契约）+ 四个
 * 跨模块载荷（进度回调 / 保留进度记录 / 批式结果 / 续跑入参）。
 *
 * 拆出的理由：这些形状不只服务编排层——`ConvertRun`/`ConvertRunState`/
 * `ConvertBatchQueue`/面板与弹窗都消费它们，独立成文后「批号/题数口径」
 * 的读写两端一眼可对（audit #109 的家族惯例）。
 */
import type { QuestionPreview } from "../draft/ConvertDetect";
import type { WenguMaterial, WenguQuestion } from "../../../types";

/** 一批落库的交付计划（`planSubmit` 的纯计算产物，`applySubmit` 消费）：
 *  写库参数与累加量在这里定下，执行层只照做——「批号/题数口径」因此不必
 *  跑内核就能测（audit #109 的 pair plan/apply 惯例）。
 *  字段：open=是否走 writer.openSet（题集不存在/首批学科未补写）；
 *  nq=本批题数（非材料 draft）；nextCursor=本批末尾已落库游标；retitle=
 *  AI 会话面板改名文案（无 sid 时 undefined=不改名）。 */
export interface SubmitPlan {
    open: boolean;
    nq: number;
    nextCursor: number;
    retitle?: string;
}

/** 转换进度回调（页内转换条/转换管理面板展示）。 */
export interface ConvertProgress {
    /** generating=逐段生成中；writing=收尾落盘中（detect 已随独立检测退役）。 */
    phase: "detect" | "generating" | "writing";
    /** 已落库批数（逐段模式=已落库的窗口数；batch=i 表示第 i 批刚落库）。 */
    batch: number;
    /** 总批数——批数由 AI 决定、事前未知，恒 0（展示走 readPct）。 */
    total: number;
    /** 已生成题数（累积）。 */
    count: number;
    /** 刚完成那批生成的题数（首批前为 0）。 */
    lastBatch: number;
    /** 已读原文百分比（并行下 = 各片进度之和，不落库也计入）。 */
    readPct?: number;
    /** 前置检测到的现成题数（判定已合并进首批生成，恒不提供）。 */
    detected?: number;
    /** 检测有分段计数失败，总数是下限（显示 N+）。 */
    detectedTruncated?: boolean;
    /** 刚完成那批的题目预览（渐进展示）。 */
    newStems?: QuestionPreview[];
    /** 本转换的题集 id（首批落库起有值；页签据此渐进呈现）。 */
    setId?: string;
    title?: string;
    /** 已落库题目的累积解析视图（渐进预览直用，无内核 IO）。 */
    questions?: WenguQuestion[];
    /** 已落库材料的累积视图（材料组预览）。 */
    materials?: WenguMaterial[];
}

/** 终止/失败保留的进度记录（prefs 持久化，重开思源后可继续生成）：
 *  已生成部分是题库里的真实记录（每批已 flush），记录只欠断点游标。
 *  分片并行下落库恒为按源顺序的连续前缀，断点因此仍是单游标。 */
export interface ConvertProgressRecord {
    /** 保留的（部分）题集 id。 */
    setId?: string;
    title: string;
    /** 已生成覆盖到的源文档字符偏移（=续跑游标）。 */
    offset: number;
    /** 已完成批数 / 总批数（展示用；逐段模式两者都是**实际 AI 调用批数**，
     *  含零产物批、不含纯标题跳过窗口——与 SegmentResult.batches 同口径）。 */
    batches: number;
    total: number;
    /** 已生成题数。 */
    count: number;
    /** 批量转换（Issue #37）维度：本记录属于一个串行队列时才有值——索引
     *  0 起、总篇数、队列标题（=根文档标题，面板总行展示「第 x/N 篇 ·
     *  队列名」）、`rootId`（队列根文档 id，面板「继续生成」据此恢复
     *  **整个队列**，Issue #62）。**只加不改名**：单篇转换的记录不带此键、
     *  存量队列记录不带 rootId（「继续生成」退化为单篇续跑），装载侧照旧
     *  （数据演进守则：optional + 无 backfill，不 bump version）。 */
    batch?: { index: number; total: number; groupTitle?: string; rootId?: string };
}

/** 批式转换结果：done=全部完成；aborted=用户终止（已落库部分待抉择）。 */
export interface BatchedResult {
    status: "done" | "aborted" | "failed";
    message: string;
    /** 本转换的题集 id（有落库产物时）。 */
    setId?: string;
    title?: string;
    count: number;
    /** 已完成批数 / 总批数（口径=**实际 AI 调用批数**，含零产物批、不含
     *  纯标题跳过窗口；与进度回调 ConvertProgress.batch「已落库批数」是两个
     *  不同口径，见收口处注释）。 */
    batches: number;
    total: number;
    /** 已生成覆盖到的源文档字符偏移（继续生成的断点）。 */
    doneOffset: number;
    /** 本次运行写入的题目 id（「全部丢弃」按它回收）。 */
    writtenQids: string[];
}

/** 继续生成的入参：上次终止保留的进度（题集已在题库里，接续写入）。 */
export interface ResumeInfo {
    /** 已生成覆盖到的源文档偏移（续跑游标）。 */
    offset: number;
    /** 上次保留的（部分）题集 id。 */
    setId?: string;
}
