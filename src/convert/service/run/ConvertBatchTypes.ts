import { QuestionType } from "../../../types";

/**
 * 转换编排的**常量与纯函数层**（20260915 自 `ConvertBatch` 拆出压 500 行
 * 红线，纯 move 语义、零行为变更）：并发上限 / 目标片数系数、插图自检、
 * 源判空加固、已读百分比、片级闸门、题型 i18n 键。
 *
 * 拆出的第二个理由：这几项都是**可直测的纯逻辑**（`isBlankSource` 已有
 * 单测锁），与编排层的 AI/IO 链分开后不必再随主流程一起读。
 * 主流程（`convertDocBatched`）从这里 import，消费点与拆出前逐字一致。
 */

/** 同时最多跑几条片流水线（= 同时最多几个在途 AI 调用）。 */
export const MAX_CONCURRENCY = 4;

/** 目标片数 = 并发度 × 该系数：片数略多于流水线数，让 worker 池消化片长
 *  不均（多出的片排队，避免某片超长变成尾巴）。 */
export const SHARDS_PER_WORKER = 2;

/** 插图自检：源文档的图片行没被带进生成结果的条数（0=无缺，真机
 *  案例：AI 读不了图、把带图题整题跳过）。 */
export function countMissingImages(srcMd: string, outMd: string): number {
    const srcImgs = new Set(srcMd.match(/!\[\]\([^)\s]+\)/g) ?? []);
    const outImgs = new Set(outMd.match(/!\[\]\([^)\s]+\)/g) ?? []);
    let n = 0;
    for (const img of srcImgs) {
        if (!outImgs.has(img)) n++;
    }
    return n;
}

/**
 * 源 kramdown 是否「空得只剩残渣」（Issue #42）：逐行剥掉 IAL 属性行与
 * 围栏标记行后，看还剩不剩实质性字符。
 *
 * ⚠️ **这不是空壳文档的判据主力**（复审实测校正，别当根因写）：
 * `getBlockKramdown` 回的文档根 IAL 一定带 `id="…"`，上面那条剥 id 的
 * 正则已经吃掉了它，`!kramdown.trim()` 早已把这批空壳挡住。本函数真正
 * 多挡的是**不带 id 的属性行**（`{: title="…"}` 这类分叉模板残渣）与
 * **空代码围栏**——它们同样会白烧一次 AI 调用。属加固，不是修复根因。
 *
 * 只做「有没有正文」的二值判定，**不改 kramdown 本体**——AI 出题用的是
 * 未改动的 `kramdown`，剥行只是判空的一次性视图。
 *
 * 导出仅为单测（转换主流程唯一消费点就在本文件）。
 */
export function isBlankSource(md: string): boolean {
    for (const line of md.split("\n")) {
        const t = line
            .replace(/^\s*(?:>\s*)?\{:[^}\n]*\}\s*$/, "") // 整行 IAL（含引用前缀）
            .replace(/^\s*```.*$/, "") // 围栏开合标记（无正文的空代码块）
            .trim();
        if (t) return false;
    }
    return true;
}

/** 已读百分比（逐段模式的「批总数」事前未知，用原文消费比例做进度）。 */
export function percentOf(cursor: number, total: number): number {
    if (total <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round((cursor / total) * 100)));
}

/** 片级闸门：片 i 的落库要等片 i-1 落库完成（见文件头注释第 3 点）。 */
export function gate(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

/** 题型 i18n 键（完成消息展示首批报出的题型并集）。 */
export const TYPE_I18N: Record<QuestionType, string> = {
    [QuestionType.Single]: "typeSingle",
    [QuestionType.Multiple]: "typeMultiple",
    [QuestionType.Judge]: "typeJudge",
    [QuestionType.Fill]: "typeFill",
    [QuestionType.Brief]: "typeBrief",
    [QuestionType.Steps]: "typeSteps",
    [QuestionType.Cloze]: "typeCloze",
    [QuestionType.Match]: "typeMatch",
    [QuestionType.Essay]: "typeEssay",
    [QuestionType.Trans]: "typeTrans",
};
