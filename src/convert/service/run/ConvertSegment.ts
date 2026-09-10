import { errText } from "../../../ui/shared";
import type { StepContext } from "../../../ai/prompts/convert";
import { questionHash } from "../../../bank/data/BankParse";
import type { QuestionType } from "../../../types";
import { parseVerdict } from "../core/ConvertService";
import { parseTypes } from "../draft/ConvertDetect";
import { shuffleDraftOptions } from "../draft/OptionShuffle";
import { parseDrafts } from "../draft/QuestionDraft";
import type { DraftUnit } from "../draft/QuestionDraft";
import type { KnowSection } from "../knowledge/KnowledgeLink";
import { advanceCursor, parseToDirective, stepWindow, stripToDirective } from "../source/CursorWindow";
import type { NormIndex } from "../source/CursorWindow";
import type { Shard } from "../source/ShardPlan";
import { isHeadingOnlyChunk } from "../source/SrcChunk";

/**
 * 片执行器（20260910 起转换并行化的第二层，与 ShardPlan 配套）：在**一个
 * 分片内**跑自推进循环——取窗口 → AI 出题 → 解析 `@@TO` → 推进游标，直到
 * 游标触到片尾。
 *
 * 分两层是为了把「任务并行单元」与「批边界」拆开：
 * - 分片（ShardPlan，确定性、切在标题行）决定**谁能并行**；
 * - 片内的批边界仍由 AI 的 `@@TO` 决定——切题与答案分离的问题不会因为
 *   并行回来。
 *
 * 片执行器**不落库、不报进度**：产物经 `deps.submit` 交给编排层
 * （ConvertBatch），由它按片序闸门写入。原因见 SetWriter：题单顺序与
 * 材料链（`lastMaterialId`）都是顺序敏感的，乱序落库会让「小题引用文中
 * 紧邻其前的材料」跨片错位。
 *
 * 片主体区恒为 [seg.start, seg.end)，窗口不越片尾（切点只在题目边界上取，
 * 见 ShardPlan——片与片互不重叠，「题目不被拦腰切断」的性质与串行时代
 * 完全一致）。
 */
export interface SegmentBatch {
    drafts: DraftUnit[];
    byAlias?: Map<string, KnowSection>;
    /** 源键（记录字段，重导入据此识别逐段生成题集）。 */
    srcKey: string;
    /** 本批消费源区间的指纹。 */
    srcHash: string;
    /** 本批消费的源区间 [start, end)（续跑断点与已读百分比）。 */
    start: number;
    end: number;
    /** 本片内第几批（从 1 起，展示用）。 */
    batchNo: number;
}

/** 片执行依赖（编排层提供）。 */
export interface SegmentDeps {
    /** 源 kramdown 全文：窗口切片与 @@TO 定位都在**全文偏移**上做。 */
    kramdown: string;
    /** 归一化索引（长文档只建一次，跨片共享）。 */
    normIndex: NormIndex;
    /** 生成通道工厂：step 动态求值（首批带判定、报出题型后喂后续批次）。 */
    makeCall(
        step: () => StepContext | undefined
    ): (text: string) => Promise<{ reply: string; byAlias?: Map<string, KnowSection> }>;
    /** 某片首批报出的题型（编排层归类并集，供后开批次用）。 */
    reportTypes(types: QuestionType[]): void;
    /** 交付一批产物：编排层按片序闸门落库，返回落库题数。 */
    submit(batch: SegmentBatch): Promise<number>;
    /** 内部信号（用户终止或任一失败都会置位）。 */
    signal: AbortSignal;
    /** 翻译（超时文案）。 */
    t: (k: string) => string;
    /** 单片模式：首批判定「不能出题」且本窗口已到文档末时立即收口。 */
    single: boolean;
}

/** 片执行结果（编排层聚合统计）。 */
export interface SegmentResult {
    /** 本片处理（含纯标题跳过以外的）批数。 */
    batches: number;
    /** AI 返回可解析题目数为 0 的批数。 */
    emptyBatches: number;
    /** @@TO 缺失/定位失败的批数（兜底推进，可能漏窗口末尾残题）。 */
    anchorMiss: number;
    /** 片末游标（正常跑完 = 片尾）。 */
    cursor: number;
    /** 本片落库题数。 */
    count: number;
    /** 首批判定「不能出题」的原因（空串=未拒绝）。 */
    refused: string;
    /** 失败原因（AI 或落库；空串=正常）。 */
    error: string;
}

/** 跑一个分片（见文件头注释）。任一失败即带 error 返回，由编排层统一收口。 */
export async function runSegment(seg: Shard, deps: SegmentDeps): Promise<SegmentResult> {
    const res: SegmentResult = {
        batches: 0,
        emptyBatches: 0,
        anchorMiss: 0,
        cursor: seg.start,
        count: 0,
        refused: "",
        error: "",
    };
    let cursor = seg.start;
    let stepCtx: StepContext | undefined;
    const callAi = deps.makeCall(() => stepCtx);
    while (!deps.signal.aborted && cursor < seg.end) {
        const win = stepWindow(deps.kramdown, cursor, undefined, seg.end);
        if (win.end <= cursor) break; // 已到片尾（防御）
        // 纯标题窗口（章标题直挂子标题）零内容：不发 AI（发了也只是
        // CAN_CONVERT:no 白耗一次调用），直接推进游标
        if (isHeadingOnlyChunk(win.text)) {
            cursor = win.end;
            res.cursor = cursor;
            continue;
        }
        res.batches++;
        stepCtx = { batch: res.batches, first: res.batches === 1 };
        let gen: { reply: string; byAlias?: Map<string, KnowSection> };
        try {
            gen = await callAi(win.text);
        } catch (e) {
            if (deps.signal.aborted) return res; // 用户终止/他片失败：由编排层收口
            const err = e as Error;
            res.error =
                err?.name === "TimeoutError" || err?.name === "AbortError"
                    ? deps.t("convertTimeout")
                    : String(err?.message ?? e);
            return res;
        }
        // 首批顺带判定（能否出题 + 题型先验），后续批次复用题型
        const verdict = res.batches === 1 ? parseVerdict(gen.reply) : undefined;
        if (verdict) {
            const types = parseTypes(gen.reply);
            if (types.length > 0) deps.reportTypes(types);
            if (!verdict.can) res.refused = verdict.reason;
        }
        const to = parseToDirective(gen.reply);
        const drafts = parseDrafts(stripToDirective(gen.reply));
        if (drafts.length === 0) res.emptyBatches++;
        drafts.forEach(shuffleDraftOptions);
        // 单窗口文档首批即判「不能出题」：直接收口（长文档首段可能只是
        // 封面/目录，不据此拒绝整卷——那由编排层的零产物分支处理）
        if (deps.single && verdict && !verdict.can && drafts.length === 0 && win.end >= deps.kramdown.length) {
            return res;
        }
        const next = advanceCursor(deps.kramdown, cursor, win, to, deps.normIndex);
        if (!next.located) res.anchorMiss++;
        // 游标不越片尾（AI 读到重叠区后可能报出重叠区内的位置）；恒前进防死循环
        const end = Math.max(cursor + 1, Math.min(next.cursor, seg.end));
        if (drafts.length > 0) {
            try {
                res.count += await deps.submit({
                    drafts,
                    byAlias: gen.byAlias,
                    // 源键与指纹随记录落库（批区间口径：键=区间起点偏移、
                    // 指纹=区间原文哈希）——逐段边界由 AI 决定，重导入走整卷重转
                    srcKey: `A:${cursor}`,
                    srcHash: questionHash(deps.kramdown.slice(cursor, end)),
                    start: cursor,
                    end,
                    batchNo: res.batches,
                });
            } catch (e) {
                if (deps.signal.aborted) return res;
                res.error = errText(e);
                return res;
            }
        }
        cursor = end;
        res.cursor = cursor;
    }
    res.cursor = cursor;
    return res;
}
