import { DraftUnit } from "../draft/QuestionDraft";
import { extractRawEntries, renderGlossBlock, splitGlossBlock, stripGlossMarks } from "./GlossEntry";
import type { GlossEntry } from "./GlossEntry";

/**
 * 转换侧的词条行保真后处理（Issue #30 第 1 条验收）：AI 只被要求「把词条
 * 行原样搬进材料尾部」，但抄写是概率事件——真正的保真由代码兜底：
 *
 *   1. **确定性预采集**：本批消费的源窗口里逐行认词条行（形态固定：
 *      `词 ^{记号} 音标 释义`，见 GlossEntry.extractRawEntries）；
 *   2. 材料正文尾部若 AI 已给词表行（`@@G` 或原卷形态）→ 以 AI 的为准
 *      （它能判断哪些词条属于哪篇材料）；
 *   3. 否则把本窗口采集到的词条**补进材料尾部**（片内多篇材料时按序
 *      均分不可靠，故只在**只有一篇材料**时补，宁缺勿错）；
 *   4. 正文里漏网的 `^{...}` 残渣一律剥掉（验收第 3 条：任何渲染产物
 *      都不许出现字面 `^{补}`）。
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
    // ② AI 已在某材料尾部给了词表行 → 以它为准（全批认一次）
    const aiGiven = mats.some((m) => splitGlossBlock(bodyOf(m)).entries.length > 0);
    let folded = 0;
    for (const m of mats) {
        const split = splitGlossBlock(bodyOf(m));
        if (split.entries.length > 0) {
            // AI 给的词表行改写为 `@@G` 规范形态（防它用别的写法漏进正文）
            setBody(m, joinBody(split.body, renderGlossBlock(split.entries)));
            folded++;
            continue;
        }
        if (aiGiven) continue; // 别的材料已给词表，本材料不再补（防串篇）
        const entries = extractRawEntries(windowText)
            .map(cleanEntry)
            .filter((e) => e.word);
        if (entries.length === 0) continue;
        setBody(m, joinBody(split.body, renderGlossBlock(entries)));
        folded++;
    }
    return folded;
}

/** 正文 + 词表区（词表区另起一段，渲染时可识别为独立块）。 */
function joinBody(body: string, gloss: string): string {
    const b = body.trim();
    return gloss ? (b ? `${b}\n\n${gloss}` : gloss) : b;
}
