import { questionHash } from "../../bank/data/BankParse";
import { chunkKramdown, CHUNK_CHARS } from "./ConvertService";

/**
 * 结构切块 + 源块指纹（增量哈希二期，docs/incremental-hash-plan.md §二）：
 * 偏移切块（chunkKramdown）在文档中间插一段会让后续所有块偏移错位、
 * 指纹全失效；结构切块按**稳定边界**（h1~h6 标题）切大块，每块带
 * 边界键（标题链）与内容指纹（questionHash 同款双 djb2），超阈值的大块
 * 再按空行二切（子块键挂父块名下）。重转换时对源文档重新切块比对指纹，
 * 三态分类：相同跳过（保原题与刷题统计）、新增生成、变更/消失逐块选。
 *
 * 本模块纯函数（切块/分类），内核 IO 在 ConvertIncrement。
 */

/** 结构块：稳定边界键 + 内容指纹 + 原文与偏移（续跑断点沿用 offset）。 */
export interface StructChunk {
    /** 边界键：标题链 H:a/b、无标题前导段 P0、超长子块 H:a/b#k。 */
    key: string;
    /** 内容指纹（questionHash 同款归一：剥 id/updated、空白折叠）。 */
    hash: string;
    text: string;
    /** 本块在源 kramdown 中的起始偏移（续跑断点）。 */
    offset: number;
}

/** 标题行（markdown/kramdown 通用形态）。 */
const HEAD_RE = /^[ \t]{0,3}(#{1,6})[ \t]+(\S.*)$/;

/** 键值消毒：剥引号/换行限长（块属性值不该含，容器 IAL 追加用）。 */
function safeKey(s: string): string {
    return s
        .replace(/["\n\r\\{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
}

/**
 * 结构切块（确定性纯函数）：标题行（h1~h6）为边界，一个标题区间一块
 * （键=祖先标题链）；首标题前的前导内容一块（键 P0）；超过 maxChars 的
 * 大块按空行二切（复用 chunkKramdown 的窗口原语，键=父键#k，k 为子块
 * 序）。同链标题重复出现追加 ~2/~3 消歧。块间连续覆盖全文（续跑 offset
 * 过滤不漏段）。
 */
export function structuralChunks(md: string, maxChars = CHUNK_CHARS): StructChunk[] {
    /** 先按标题行切成 [键, 区间文本, 区间起始偏移] 的段序列。 */
    type Section = { key: string; start: number; text: string };
    const sections: Section[] = [];
    const chain: { level: number; title: string }[] = [];
    const seen = new Map<string, number>();
    let start = 0;
    let key = "P0";
    const lines = md.split("\n");
    let pos = 0; // 当前行起始偏移
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = HEAD_RE.exec(line);
        if (m) {
            // 标题前的区间收段
            if (pos > start) sections.push({ key, start, text: md.slice(start, pos) });
            const level = m[1].length;
            const title = m[2].trim();
            while (chain.length > 0 && chain[chain.length - 1].level >= level) chain.pop();
            chain.push({ level, title });
            const base = `H:${safeKey(chain.map((c) => c.title).join("/"))}`;
            const n = (seen.get(base) ?? 0) + 1;
            seen.set(base, n);
            key = n > 1 ? `${base}~${n}` : base;
            start = pos;
        }
        pos += line.length + 1;
    }
    if (md.length > start) sections.push({ key, start, text: md.slice(start) });

    /** 段内切块：小段一块；超阈值按空行二切（子块键挂父块名下）。 */
    const out: StructChunk[] = [];
    for (const sec of sections) {
        const text = sec.text.trim();
        if (!text) continue;
        if (text.length <= maxChars) {
            out.push({ key: sec.key, hash: questionHash(text), text, offset: sec.start });
            continue;
        }
        const subs = chunkKramdown(sec.text, maxChars);
        for (let k = 0; k < subs.length; k++) {
            const t = subs[k].text.trim();
            if (t)
                out.push({
                    key: `${sec.key}#${k}`,
                    hash: questionHash(t),
                    text: t,
                    offset: sec.start + subs[k].offset,
                });
        }
    }
    return out;
}

/** 已落盘题集里的旧块分组（readSrcGroups 的产出，纯数据）。 */
export interface SrcGroup {
    /** 边界键（组内全部块共享；旧数据缺键时为空串——只按指纹匹配）。 */
    key: string;
    hash: string;
    /** 该源块产出的容器块 id（题目 + 材料块）。 */
    blocks: string[];
}

/** 增量分类结果（三态 + 供 UI 的逐块清单）。 */
export interface IncrementPlan {
    /** 指纹未变（含被挪动但内容一致）的块数——直接跳过。 */
    same: number;
    /** 源里新出现的块（键与指纹都未见）→ 默认生成。 */
    fresh: StructChunk[];
    /** 键还在、内容变了 → 逐块选：重生成或保留旧题。 */
    changed: { chunk: StructChunk; old: SrcGroup }[];
    /** 键与指纹都消失的旧组 → 逐块选：删旧题或保留。 */
    removed: SrcGroup[];
}

/**
 * 三态分类（纯函数，两阶段）：**先全局指纹匹配**——内容一致的块无论
 * 边界怎么挪都算「相同」（子块序号漂移、标题改名但内容不动，都零成本
 * 跳过；逐块贪心会让键先消费掉本该指纹解救的组，必须整轮先行）；
 * 剩余块再看**键**——键撞上旧组=「变更」配对，键也是新的=「新增」；
 * 两头都没匹配到的旧组=「消失」。
 */
export function classifyChunks(groups: SrcGroup[], chunks: StructChunk[]): IncrementPlan {
    const plan: IncrementPlan = { same: 0, fresh: [], changed: [], removed: [] };
    /** hash → 组（多组同指纹时任取其一，内容一致即等价）。 */
    const byHash = new Map<string, SrcGroup[]>();
    const byKey = new Map<string, SrcGroup[]>();
    for (const g of groups) {
        if (!g.hash) continue;
        const hs = byHash.get(g.hash) ?? [];
        hs.push(g);
        byHash.set(g.hash, hs);
        if (g.key) {
            const ks = byKey.get(g.key) ?? [];
            ks.push(g);
            byKey.set(g.key, ks);
        }
    }
    /** 从一张索引取用一组，两张同步摘除防重复匹配。 */
    const takeFrom = (m: Map<string, SrcGroup[]>, k: string): SrcGroup | undefined => {
        const arr = m.get(k);
        if (!arr || arr.length === 0) return undefined;
        const g = arr.shift()!;
        if (arr.length === 0) m.delete(k);
        for (const [hk, harr] of byHash) {
            const i = harr.indexOf(g);
            if (i >= 0) harr.splice(i, 1);
            if (!harr.length) byHash.delete(hk);
        }
        for (const [kk, karr] of byKey) {
            const i = karr.indexOf(g);
            if (i >= 0) karr.splice(i, 1);
            if (!karr.length) byKey.delete(kk);
        }
        return g;
    };
    // 阶段一：指纹全局匹配（同内容=同块，边界漂移无损解救）
    const pending: { chunk: StructChunk; hashHit: boolean }[] = [];
    for (const c of chunks) {
        if (takeFrom(byHash, c.hash)) {
            plan.same++;
            pending.push({ chunk: c, hashHit: true });
        } else pending.push({ chunk: c, hashHit: false });
    }
    // 阶段二：剩余块按键配对旧组（键同内容变=变更），配不上的=新增
    for (const { chunk, hashHit } of pending) {
        if (hashHit) continue;
        const old = chunk.key ? takeFrom(byKey, chunk.key) : undefined;
        if (old) plan.changed.push({ chunk, old });
        else plan.fresh.push(chunk);
    }
    for (const gs of [...byHash.values()]) plan.removed.push(...gs);
    return plan;
}

/** 纯标题块：去掉标题行与空白后无内容（「章标题下直接挂子标题」的
 *  层级结构常见，20260902 真机：一篇 159 批的题解文档有 9 批）——
 *  发批前跳过，省掉必然 CAN_CONVERT:no 的空调用与面板噪音。 */
export function isHeadingOnlyChunk(text: string): boolean {
    return !text.split(/\r?\n/).some((l) => l.trim() && !HEAD_RE.test(l));
}
