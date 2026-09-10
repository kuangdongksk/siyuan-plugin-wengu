/**
 * 分片规划（20260910 起转换并行化的第一层，见 AGENTS.md convert 域）：
 * 逐段自推进的批边界由 AI 的 @@TO 决定，下一批起点依赖本批产出——链条
 * 是硬的，只能串行。破法是把两种粒度拆开：
 *
 * - **分片 = 任务并行单元**（本模块，确定性、可复现）——片间互不依赖，
 *   可并发跑；
 * - **批边界 = 片内由 AI 决定的事**（ConvertSegment 的 @@TO 循环）——
 *   切片不改变「题目不会被拦腰切断」的性质。
 *
 * **切点候选分级**（20260910 二期）：源文档格式千奇百怪——可能是规范
 * markdown（`## 习题3`）、旧版落文档产物（`{{{row` 超级块，IAL 行已在
 * 转换入口剥掉）、粘贴的网页（HTML 标签）、OCR/PDF 转出的纯文本（题号
 * 行）。于是候选按可靠性分级，选点时**质量优先、距离次之**：同一理想
 * 位置附近先取更高级的切点，该级在搜索半径内没有候选才降级。
 *
 * | 级别 | 判据 | 是否落在题边界 |
 * |---|---|---|
 * | heading | `#`~`######` 标题行、`<h1>`~`<h6>` | 几乎总是 |
 * | marker | 超级块 `{{{`、分割线 `---`、HTML 块级标签 | 块边界 |
 * | qnum | `第N题`、`习题N`、`(N)`、`N.`、`【…】` | 多半是 |
 *
 * **弱边界不参与分片**（空行、任意行首）：切点若不在题目边界上，片尾
 * 那道题会被硬切成两半——前片按「末尾没写完」约定跳过、后片只看到后半
 * 截，结果是**漏题**，且无任何兜底手段（硬切点由代码定，与 AI 的 @@TO
 * 无关，无法事后校正）。因此宁可少分片（拿不到可靠切点就退化为单片 =
 * 改造前的串行行为），也不切错。代价是「无标题无题号、只有段落」的文档
 * 拿不到加速；这类文档连题目边界都无从判别，串行本就不是瓶颈所在。
 *
 * 本模块纯函数（无内核 IO、无 AI）。
 */

/** 切点种类（可靠性由高到低：heading > marker > qnum）。`start` 是片首
 *  标注，不参与选点。 */
export type CutKind = "start" | "heading" | "marker" | "qnum";

/** 切点质量权重：差一级约等于让出**半个理想片长**的距离代价（标题在半个
 *  片长内的优势不容置疑，两倍片长外的标题则不如近处的题号行）。 */
const KIND_SCORE: Record<CutKind, number> = { start: 0, heading: 1.5, marker: 1, qnum: 0.5 };

/** 相邻切点的最小间距（与理想片长的 1/4 取大）——防止候选密集处切出碎片，
 *  同时不阻止短文档按目标片数均分。 */
const MIN_SHARD_CHARS = 200;

/** markdown 标题行（与 SrcChunk 同款判据）。 */
const HEAD_RE = /^[ \t]{0,3}#{1,6}[ \t]+\S/;
/** HTML 标题行（粘贴网页/公众号文章的常见形态）。 */
const HTML_HEAD_RE = /^[ \t]*<h[1-6][\s>/]/i;
/** 超级块行（旧版落文档产物的题目起点；IAL 行已在转换入口剥掉）。 */
const SUPER_RE = /^[ \t]*\{\{\{/;
/** 分割线（题与题之间的常见分隔；不匹配表格分隔行 `|---|`）。 */
const HR_RE = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** HTML 块级标签行。 */
const HTML_BLOCK_RE =
    /^[ \t]*<\/?(?:div|section|article|aside|header|footer|main|table|details|figure|hr|blockquote|ul|ol|dl|center)\b/i;
/** 题号行（纯文本 / OCR 稿的题目边界）。 */
const QNUM_RE =
    /^[ \t]*(?:第\s*[0-9一二三四五六七八九十百]+\s*[章节讲题练部篇课卷]|习题\s*[0-9一二三四五六七八九十]*|[（(]\s*\d+\s*[）)]|\d+\s*[、.．)）]|【[^】\n]{1,12}】|[①-⑳])/;

/** 一个切点候选（offset=所在行**行首**在源文档里的偏移）。 */
export interface CutPoint {
    offset: number;
    kind: CutKind;
    /** heading 候选携带标题文本（片段展示/诊断用）。 */
    title?: string;
}

/** 一片：源文档区间 [start, end)，片间**连续覆盖**全文（无重叠）。 */
export interface Shard {
    start: number;
    end: number;
    /** 片首所在位置的标题文本（展示/诊断用；无标题文档为空串）。 */
    title: string;
    /** 片首所用切点的种类（`start`=文档/续跑起点，未用切点）。 */
    kind: CutKind;
}

/**
 * 扫描切点候选（升序，同一行只归最高级别）。行首偏移与 `md` 的 UTF-16
 * 下标同口径，可直接当 `slice` 断点用。
 */
export function cutCandidates(md: string, from = 0): CutPoint[] {
    const out: CutPoint[] = [];
    let pos = 0;
    for (const line of md.split("\n")) {
        if (pos >= from) {
            const head = HEAD_RE.exec(line);
            if (head) {
                out.push({ offset: pos, kind: "heading", title: line.replace(/^[ \t]{0,3}#{1,6}[ \t]+/, "").trim() });
            } else if (HTML_HEAD_RE.test(line)) {
                out.push({ offset: pos, kind: "heading", title: line.replace(/<[^>]*>/g, "").trim() });
            } else if (SUPER_RE.test(line) || HR_RE.test(line) || HTML_BLOCK_RE.test(line)) {
                out.push({ offset: pos, kind: "marker" });
            } else if (QNUM_RE.test(line)) {
                out.push({ offset: pos, kind: "qnum" });
            }
        }
        pos += line.length + 1;
    }
    return out;
}

/** 标题行清单（升序，含偏移与标题文本；heading 级候选的过滤视图）。 */
export function headingLines(md: string): { offset: number; title: string }[] {
    return cutCandidates(md)
        .filter((c) => c.kind === "heading")
        .map((c) => ({ offset: c.offset, title: c.title ?? "" }));
}

/** 片首标题：偏移不晚于 start 的最后一个标题（片首落在章标题行上时即该标题）。 */
function titleAt(cands: CutPoint[], start: number): string {
    let t = "";
    for (const c of cands) {
        if (c.offset > start) break;
        if (c.kind === "heading") t = c.title ?? "";
    }
    return t;
}

/**
 * 就近选点：对 [minOffset, maxOffset] 内的候选按 `质量分 - 归一化距离`
 * 打分取最优——质量优先于距离，但距离差到一个量级时让步（见 KIND_SCORE）。
 * 剩下的候选皆非可靠级别时返回 undefined（该处不切，宁可少分片也不切在
 * 题中间，见文件头注释）。
 */
function pickCut(
    cands: CutPoint[],
    wanted: number,
    span: number,
    minOffset: number,
    maxOffset: number
): CutPoint | undefined {
    if (minOffset > maxOffset) return undefined;
    let best: CutPoint | undefined;
    let bestS = Number.NEGATIVE_INFINITY;
    for (const c of cands) {
        if (c.offset < minOffset || c.offset > maxOffset) continue;
        const s = KIND_SCORE[c.kind] - Math.abs(c.offset - wanted) / span;
        if (s > bestS) {
            best = c;
            bestS = s;
        }
    }
    return best;
}

/**
 * 超长片二次细分：贪心选点是**局部**最优——某个理想位置附近只有很远的
 * 高级切点、近处只有低一级切点时，质量优先会把切点推远，留下一块超长片
 * （实测：某卷 8 片里出现一片 2 倍长，等于并行度白丢一半）。这里对超过
 * 1.35 倍理想片长的片，在**片内部**再补一刀（同一套择优规则），补不动
 * （片内没有可靠切点）就跳过它继续看别的片。
 */
function refineShards(
    cands: CutPoint[],
    shards: Shard[],
    span: number,
    minGap: number,
    titleOf: (o: number) => string
): Shard[] {
    const out = [...shards];
    const limit = span * 1.35;
    for (let round = 0; round < 8; round++) {
        let cutDone = false;
        for (let i = 0; i < out.length; i++) {
            const s = out[i];
            if (s.end - s.start <= limit) continue;
            const mid = (s.start + s.end) / 2;
            const cut = pickCut(cands, mid, span, s.start + minGap, s.end - minGap);
            if (!cut) continue; // 片内无可用的可靠切点：放弃这片，继续看下一片
            out.splice(
                i,
                1,
                { ...s, end: cut.offset },
                { start: cut.offset, end: s.end, title: titleOf(cut.offset), kind: cut.kind }
            );
            cutDone = true;
            break; // 索引已变，重新从头扫
        }
        if (!cutDone) break;
    }
    return out;
}

/**
 * 规划分片：目标不超过 target 片（受可靠切点可用性限制，不足时自动减少；
 * 拿不到可靠切点的文档退化为单片）。from = 续跑起点——只规划 [from, 末尾)
 * 的剩余部分，第一片自 from 起（断点落在片中间时天然接续）。
 */
export function planShards(md: string, target = 1, from = 0): Shard[] {
    const total = md.length;
    const start = Math.max(0, Math.min(from, total));
    if (total <= start) return [];
    const cands = cutCandidates(md, start);
    const cap = Math.max(1, Math.floor(target));
    const titleOf = (o: number): string => titleAt(cands, o);
    const single: Shard[] = [{ start, end: total, title: titleOf(start), kind: "start" }];
    if (cap <= 1) return single;
    const span = (total - start) / cap;
    const minGap = Math.max(MIN_SHARD_CHARS, Math.floor(span * 0.25));
    // 末尾 5% 不设切点，避免最后一片空得只剩标题
    const tailGuard = Math.max(1, Math.floor(total * 0.05));
    const cuts: CutPoint[] = [];
    let last = start;
    for (let k = 1; k < cap; k++) {
        const wanted = last + (total - last) / (cap - k + 1);
        const cut = pickCut(cands, wanted, span, last + minGap, total - tailGuard);
        if (!cut) break;
        cuts.push(cut);
        last = cut.offset;
    }
    if (cuts.length === 0) return single; // 无可靠切点：退化为单片（= 串行）
    const out: Shard[] = [];
    let s = start;
    let kind: CutKind = "start";
    for (const c of cuts) {
        out.push({ start: s, end: c.offset, title: titleOf(s), kind });
        s = c.offset;
        kind = c.kind;
    }
    out.push({ start: s, end: total, title: titleOf(s), kind });
    return refineShards(
        cands,
        out.filter((x) => x.end > x.start),
        span,
        minGap,
        titleOf
    );
}
