import type { BankData, BankSet } from "../../../bank/data/QuestionBank";

/**
 * 逐段自推进题集的「源级哈希 + 分段边界表」（Issue #74）——纯逻辑面。
 *
 * 20260910 起转换全部走逐段自推进：批边界由 AI 的 `@@TO` 决定、不可复现，
 * 记录源键 `A:<偏移>` 因此跳过增量三态分类，重导只能整卷重转（**源没改
 * 也重烧整卷**）。本模块补上两件确定性凭据：
 *
 * - `srcContentHash`：整篇源 kramdown 的内容哈希（喂给 AI 的同一条字符串，
 *   即转换入口剥掉块 id IAL 行后的那条）；
 * - `segs`：每**已落库批**一条 `{s, e, h}`——段与段首尾相接、连续覆盖
 *   `[0, 已落库游标]`，`s`/`e` 与既有 `A:<偏移>` 键、断点游标**同一单位**
 *   （剥 IAL 后 kramdown 的 UTF-16 字符偏移）。
 *
 * 消费面是重导判定（`planReimportBySegs`）：全部命中→可能整篇哈希因区间
 * 之外的变化而不同→从末段继续；第 k 段失配→删 `srcKey` 偏移 `>= segs[k].s`
 * 的记录、从该处续转（复用 resume 机制）。
 *
 * 存储守则：两个字段都是 optional、只加不改名、不 bump version；题集无
 * `segs`（存量/旧记录）时全部回退现状行为，零迁移。
 */

/** 一段（首尾相接，见文件头）。 */
export interface SetSeg {
    /** 段在源 kramdown 里的起始偏移（含）。 */
    s: number;
    /** 段结束偏移（不含）：**实际已落库的游标**（非片尾，见 advanceSegs）。 */
    e: number;
    /** 该段源文本的内容哈希（`hashContent(src.slice(s, e))`）。 */
    h: string;
}

/** 本模块需要的题集视图（BankSet 满足之；纯函数不碰 bank 实例）。 */
export interface SegSetView {
    srcContentHash?: string;
    segs?: SetSeg[];
}

/** `A:<偏移>` 源键的偏移（非该形态返回 undefined——`H:` 结构键走增量
 *  三态分类，不归本模块管）。 */
export function cursorOffsetOfKey(srcKey: string | undefined): number | undefined {
    if (!srcKey) return undefined;
    const m = /^A:(\d+)$/.exec(srcKey);
    return m ? Number(m[1]) : undefined;
}

/**
 * 内容哈希（确定性，无随机性）：双种子 DJB2 归一后拼 64 位，与
 * `BankParse.questionHash` 同构（同族算法，不是同一口径——指纹冻结清单
 * 里那条是**题目 kramdown** 的哈希，本条是**源文本**的哈希，各算各的）。
 *
 * 归一取**逐字符**：段边界落在换行/空格之间时 `slice` 结果会带边界差异，
 * 空白折叠可以让「同一段原文」的哈希跨批稳定（宁漏勿错的反面：归一过宽
 * 会把真变更当没变——这里只折叠空白，内容字符一个不丢）。
 */
export function hashContent(text: string): string {
    const norm = text.replace(/\s+/g, " ").trim();
    let h1 = 5381;
    let h2 = 52711;
    for (let i = 0; i < norm.length; i++) {
        const c = norm.charCodeAt(i);
        h1 = ((h1 << 5) + h1 + c) | 0;
        h2 = ((h2 << 5) + h2 + c) | 0;
    }
    return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}`;
}

/**
 * 追加一段（每批 flush 后的检查点）。三条硬性质：
 * - **首尾相接**：`s` 取上一段的 `e`（段表非空时），不信任调用方传的段首
 *   ——片序闸门保证落库恒为连续前缀，但片内 `cursor` 与上一段 `e` 之间的
 *   空隙若被覆盖进去，那段源文本就**从哈希比对里消失**（漏变更比误重转
 *   更坏）；续跑时同样以既有末段为准，断点游标与段表永远一致；
 * - **严格前进**：`e <= s` 的段不落（AI 的 `@@TO` 兜底推进恒前进，但异常
 *   路径可能给出零步长窗口；落了会让「第 k 段」判定把空段当失配段）；
 * - **覆盖式追加**：新段 `s` 落在既有段内部（同游标重复 flush）时裁掉与
 *   之重叠的旧段再追加，段表始终互不重叠。
 *
 * 返回新表（纯函数，不改入参）。
 */
export function advanceSegs(segs: SetSeg[] | undefined, segStart: number, cursor: number, src: string): SetSeg[] {
    const out = (segs ?? []).map((x) => ({ ...x }));
    const from = out.length > 0 ? out[out.length - 1].e : segStart;
    const to = Math.max(cursor, from);
    if (to <= from) return out;
    while (out.length > 0 && out[out.length - 1].s >= from) out.pop();
    out.push({ s: from, e: to, h: hashContent(src.slice(from, to)) });
    return out;
}

/** 重导决策（`kind` 是唯一的动作判据，见 planReimportBySegs）。 */
export type ReimportDecision =
    /** 无记录 + 整篇哈希命中：零动作（「源文档未变更」）。 */
    | { kind: "unchanged" }
    /** 无记录 + `segs` 在：从 `from` 起重转，删 `srcKey` 偏移 >= `from` 的记录。 */
    | { kind: "partial"; from: number; deleteFrom: number; keptSegs: number }
    /** 无记录 + 无 `segs`（存量/旧记录）：现状行为（整卷重转）。 */
    | { kind: "full" };

/**
 * 重导判定（**纯决策，不含「有续跑记录」那条**——优先级 1 在调用侧
 * `DocOps` 里先于本函数落定：有续跑记录=上次没跑完，照旧断点续写同一
 * 题集，不做未变更短路，也不做段比对）。
 *
 * 无记录时的三段判定：
 * 1. `srcContentHash` 命中且等于当前源哈希 → `unchanged`（连长度都一致时
 *    的整篇短路也走这条：同一个哈希函数，长度不同必然不同哈希）；
 * 2. 哈希不同（或无哈希字段）+ `segs` 在 → 逐段比对取**第一条失配段**；
 *    - 有失配段 k：删 `srcKey` 偏移 `>= segs[k].s` 的记录，从该处续转；
 *    - 全段命中（变更在已转区外，如文末追加）：从末段 `e` 起续转，**一段
 *      不删**；
 *    - ⚠️ **源长度短于段表末段**（源被删短）时末段必然失配，落在上面那条
 *      「第 k 段」分支里，天然正确；段表本身不裁（续转以游标为准）。
 * 3. 无 `segs` → `full`（现状：清旧题集整卷重转）。
 */
export function planReimportBySegs(src: string, set: SegSetView | undefined): ReimportDecision {
    const segs = set?.segs ?? [];
    // 无段表=存量/旧记录（无凭据可逐段比对）→ 现状行为整卷重转。整篇哈希
    // 命中短路放在它之后：**没有段表的题集不认整篇哈希**——凭据缺失就
    // 宁多烧不漏转，且「有哈希无段表」的形态本身不该出现（两者同点写入）
    if (segs.length === 0) return { kind: "full" };
    const whole = hashContent(src);
    if (set?.srcContentHash && set.srcContentHash === whole) return { kind: "unchanged" };
    for (let k = 0; k < segs.length; k++) {
        const seg = segs[k];
        if (hashContent(src.slice(seg.s, seg.e)) !== seg.h) {
            // 失配段之前的记录原样保留（含这些段的题单序与作答统计），从该段
            // 起重转——删除阈值取**该段起点**，严格 >= 才能删掉「起于该段的
            // 那几条」（上一段末尾落库的题 srcKey < s，不在误删范围）
            return { kind: "partial", from: seg.s, deleteFrom: seg.s, keptSegs: k };
        }
    }
    const tail = segs[segs.length - 1].e;
    return { kind: "partial", from: tail, deleteFrom: tail, keptSegs: segs.length };
}

/** 决策的删除集：题集内 `srcKey` 偏移 >= `from` 的 qid（组题/材料归属都
 *  按记录自身的 srcKey 判，与材料链无关——材料正文不动，孤儿材料无消费
 *  面）。`H:` 结构键不在此列（偏移无从比较，且逐段题集里不会混结构键）。 */
export function qidsFromOffset(data: BankData, setId: string, from: number): string[] {
    const set = data.sets?.[setId];
    if (!set) return [];
    const out: string[] = [];
    for (const qid of set.qids) {
        const off = cursorOffsetOfKey(data.records[qid]?.srcKey);
        if (off !== undefined && off >= from) out.push(qid);
    }
    return out;
}

/** 题集的重导凭据视图（调用侧取值用；缺字段即 undefined）。 */
export function segViewOf(set: BankSet | undefined): SegSetView | undefined {
    return set ? { srcContentHash: set.srcContentHash, segs: set.segs } : undefined;
}
