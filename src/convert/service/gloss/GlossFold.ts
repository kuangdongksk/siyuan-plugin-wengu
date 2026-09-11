import { DraftUnit } from "../draft/QuestionDraft";
import { extractRawEntries, isConfidentEntry, renderGlossBlock, splitGlossBlock, stripGlossMarks } from "./GlossEntry";
import type { GlossEntry } from "./GlossEntry";

/**
 * 转换侧的词条行保真后处理（Issue #30 第 1 条验收）：AI 只被要求「把词条
 * 行原样搬进材料尾部」，但抄写是概率事件——真正的保真由代码兜底：
 *
 *   1. **确定性预采集**：本批消费的源窗口里逐行认词条行（形态固定：
 *      `词 ^{记号} 音标 释义`，见 GlossEntry.extractRawEntries）；
 *   2. 材料正文尾部若 AI 已给词表行（`@@G` 或原卷形态）→ 以 AI 的为准
 *      （它能判断哪些词条属于哪篇材料），规整成 `@@G` 规范形态；
 *   3. 否则把本窗口采集到的词条**补进材料尾部**——但仅限「本批只有
 *      **一篇**材料」：多篇时源区间跨篇、词条归属无从判定，按序均分
 *      不可靠、全量补首篇会串篇，故不补（宁缺勿错）；
 *   4. 正文里漏网的 `^{...}` 残渣一律剥掉（验收第 3 条：任何渲染产物
 *      都不许出现字面 `^{补}`）——**数学/代码区间内的 `^{...}` 保留**
 *      （见 GlossEntry.stripGlossMarks）。
 */

/** 词条行归一：去掉词条行自身的 `^{...}`、裁掉空段。 */
function cleanEntry(e: GlossEntry): GlossEntry {
    return { word: stripGlossMarks(e.word).trim(), phonetic: e.phonetic.trim(), meaning: e.meaning.trim() };
}

/** 材料单元是否可挂词表（材料块；题目单元不挂）。 */
function isMaterial(d: DraftUnit): boolean {
    return d.material;
}

/** 取材料单元的 body 部件文本（无则空串）。 */
function bodyOf(d: DraftUnit): string {
    return d.parts
        .filter((p) => p.name === "body")
        .map((p) => p.text)
        .join("\n\n");
}

/** 覆写材料单元的 body 部件文本（保留其余部件顺序）。 */
function setBody(d: DraftUnit, text: string): void {
    const parts = d.parts.filter((p) => p.name !== "body");
    if (text) parts.unshift({ name: "body", text });
    d.parts = parts;
}

/**
 * 本批的源窗口里抽出的词条行是否要补进产物（返回补了几篇材料的词表）。
 * `windowText` 是**本批消费的源片段**（不是给 AI 看的整窗，见调用点）。
 */
export function foldGlossIntoDrafts(drafts: DraftUnit[], windowText: string): number {
    // ① 全文剥 `^{...}` 残渣（正文 + 词条行自身的记号一并清；词条行的
    //    记号语义由联通后的词表序号承担）
    for (const d of drafts) {
        for (const p of d.parts) p.text = stripGlossMarks(p.text);
    }
    const mats = drafts.filter(isMaterial);
    if (mats.length === 0) return 0;
    // ② AI 给的词表行一律规整成 `@@G` 规范形态（防它用别的写法漏进正文）。
    //    只对**本材料自己**的词表行判定——AI 每篇材料各给各的，逐篇认领。
    let folded = 0;
    const aiGiven = mats.some((m) => splitGlossBlock(bodyOf(m)).entries.length > 0);
    for (const m of mats) {
        const split = splitGlossBlock(bodyOf(m));
        if (split.entries.length > 0) {
            setBody(m, joinBody(split.body, renderGlossBlock(split.entries)));
            folded++;
        }
    }
    // ③ 确定性兜底补词表：**只在「本批恰好一篇材料」时补**。多篇材料时
    //    源区间是整批的（跨篇），词条行按篇归属无从判定——按序均分不可靠、
    //    全量补进第一篇会把 B 篇的词条挂到 A 篇（串篇），故宁缺勿错不补。
    //    此闸下 AI 给过词表也照样不补（避免同一词条在 AI 词表后再叠一份）。
    //    另加**置信判据**（isConfidentEntry）：只认带音标或词性标签的词条行，
    //    数学习题/笔记里 `a^{n} 表示 n 次幂` 这类与词条行形态无从区分的行
    //    因此不会变成伪词表（宁缺勿错）。
    if (mats.length === 1 && !aiGiven) {
        const entries = extractRawEntries(windowText)
            .map(cleanEntry)
            .filter((e) => e.word && isConfidentEntry(e));
        if (entries.length > 0) {
            const m = mats[0];
            const split = splitGlossBlock(bodyOf(m));
            setBody(m, joinBody(split.body, renderGlossBlock(entries)));
            folded++;
        }
    }
    return folded;
}

/** 正文 + 词表区（词表区另起一段，渲染时可识别为独立块）。 */
function joinBody(body: string, gloss: string): string {
    const b = body.trim();
    return gloss ? (b ? `${b}\n\n${gloss}` : gloss) : b;
}
