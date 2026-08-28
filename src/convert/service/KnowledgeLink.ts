import { agentChat, agentChatConcurrent } from "../../ai/client";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { KernelQuery } from "../../siyuan/query";

/**
 * 知识点反链（从 ConvertBatch 拆出的独立关注点）：
 * 转换前按用户给的知识点根文档（书架/书）建两级索引（章 → h1~h6 小节，
 * 全部走 SQL 拿块 id，不导出正文）；每批生成前先路由出本批涉及的小节，
 * 让 AI 用 K 别名标注（避免抄错长块 id），生成后把别名映射回真实块 id、
 * 在解析引述块尾注入 `((id "标题"))` 块引用——知识点文档的反链面板
 * 即可看到相关题目，题目卡里点击可跳转（Protyle 原生渲染块引用）。
 *
 * 真机数据（20260823，/MinerU 书架）：61 个实质章节 304 万字，章中位
 * 4.7 万字——正文挂载不可行，本模块只做标题级路由与引用注入。
 * 任何路由失败都降级为「该批不加链接」，不阻断转换主流程。
 */

/** 知识点小节（h1~h6 标题块）。 */
export interface KnowSection {
    /** 标题块 id（块引用目标）。 */
    id: string;
    /** 小节标题。 */
    title: string;
    /** 展示路径：书架/书/章节/小节。 */
    path: string;
}

/** 知识点章节（一个叶子文档）。 */
export interface KnowChapter {
    /** 章节文档 id（无小节结构的章直接引用文档根块）。 */
    docId: string;
    title: string;
    /** 展示路径：书架/书/章节。 */
    path: string;
    sections: KnowSection[];
}

/** 两级索引：路由①在章集合上选，路由②在选中章的小节集合上选。 */
export interface KnowledgeIndex {
    chapters: KnowChapter[];
}

/** 路由调用通道（与生成同通道：串行走 agent/chat，并发走 chatGPT）。 */
export interface KnowRouteDeps {
    call(message: string): Promise<string>;
}

/** SQL 查询（工厂 rowsMap：code!==0 抛错由调用方降级）。 */
const sql = KernelQuery.rowsMap;

/** rowsMap 行（KernelQuery 工厂的 Map 行别名）。 */
type KnowRow = Map<string, string>;

/** 根块行 + 其全部后代文档行（同笔记本递归 path LIKE，含书/章中间层）。
 *  根非文档/已删/SQL 失败返回 null，调用方各自降级。 */
async function knowDocRows(rootId: string): Promise<{ root: KnowRow; rows: KnowRow[] } | null> {
    let root: KnowRow | undefined;
    try {
        root = (
            await sql(`SELECT id, box, path, content, hpath FROM blocks WHERE id = '${rootId}' AND type = 'd' LIMIT 1`)
        )[0];
    } catch (_) {
        return null;
    }
    if (!root?.get("box")) return null;
    const dir = root.get("path").replace(/\.sy$/, "");
    const rows = await KernelQuery.rowsMapAll(
        `SELECT id, path, content, hpath FROM blocks WHERE type = 'd' AND box = '${root.get(
            "box"
        )}' AND path LIKE '${dir}/%.sy' ORDER BY hpath`
    );
    return { root, rows };
}

/** 批量拉文档的 h1~h6 标题块（按 root_id 分组、sort 保序）。 */
async function headingsByRoot(docIds: string[]): Promise<Map<string, { id: string; content: string }[]>> {
    const byRoot = new Map<string, { id: string; content: string }[]>();
    if (docIds.length === 0) return byRoot;
    const ids = docIds.map((x) => `'${x}'`).join(",");
    for (const h of await KernelQuery.rowsMapAll(
        `SELECT root_id, id, content FROM blocks WHERE type = 'h' AND subtype IN ('h1','h2','h3','h4','h5','h6') AND root_id IN (${ids}) ORDER BY root_id, sort`
    )) {
        const k = h.get("root_id");
        const arr = byRoot.get(k) ?? [];
        arr.push({ id: h.get("id"), content: h.get("content") });
        byRoot.set(k, arr);
    }
    return byRoot;
}

/**
 * 建知识点索引。rootIds 是用户填的知识点根文档（书架那层或直接一本
 * 书/一章）：取其下所有叶子文档为章节（书名空壳层自动排除），根自身
 * 无叶子后代时（用户直接指到章节）把根当唯一章节。无小节结构的章节
 * 引用文档根块本身。
 */
export async function buildKnowledgeIndex(rootIds: string[]): Promise<KnowledgeIndex> {
    const chapters: KnowChapter[] = [];
    for (const rid of rootIds) {
        const hit = await knowDocRows(rid);
        if (!hit) continue;
        // 叶子 = 没有任何文档以它为父目录（书名空壳层自动出局）
        const parentDirs = new Set(
            hit.rows.map((r) => {
                const p = r.get("path");
                return p.slice(0, p.lastIndexOf("/"));
            })
        );
        let leaves = hit.rows.filter((r) => !parentDirs.has(r.get("path").replace(/\.sy$/, "")));
        if (leaves.length === 0) leaves = [hit.root];
        const byRoot = await headingsByRoot(leaves.map((r) => r.get("id")));
        for (const leaf of leaves) {
            const hp = leaf.get("hpath");
            const secs = (byRoot.get(leaf.get("id")) ?? []).map((h) => ({
                id: h.id,
                title: h.content,
                path: `${hp}/${h.content}`,
            }));
            chapters.push({
                docId: leaf.get("id"),
                title: leaf.get("content") || hp,
                path: hp,
                sections: secs,
            });
        }
    }
    return { chapters };
}

/** 知识文档树条目（知识面板展示用：一个文档一行，带自己的小节）。 */
export interface KnowDocEntry {
    docId: string;
    title: string;
    hPath: string;
    sections: { id: string; title: string }[];
}

/**
 * 递归展开登记根的知识文档树（知识面板「导入文档」20260828 用）：根
 * 自身 + 全部后代文档（含书/章中间层）各一条，每条带自己的 h1~h6 小节
 * ——与 buildKnowledgeIndex 的分工：路由索引只要叶子章节，这里保留
 * 完整层级供面板按原生文档树观感逐文档展示。根查无/SQL 失败返回空
 * 数组（调用方按标题兜底区分「已删跳过」与「保留空节登记行」）。
 */
export async function expandKnowDocs(rootId: string): Promise<KnowDocEntry[]> {
    const hit = await knowDocRows(rootId);
    if (!hit) return [];
    const docs = [hit.root, ...hit.rows];
    const byRoot = await headingsByRoot(docs.map((d) => d.get("id")));
    return docs.map((d) => ({
        docId: d.get("id"),
        title: d.get("content") || d.get("hpath") || d.get("id"),
        hPath: d.get("hpath") ?? "",
        sections: (byRoot.get(d.get("id")) ?? []).map((h) => ({ id: h.id, title: h.content })),
    }));
}

/** 从路由回复里抽数字（JSON 或裸列表都行），保序去重并限界 [1,max]。 */
function parseNums(reply: string, max: number): number[] {
    const out: number[] = [];
    for (const m of reply.matchAll(/\d+/g)) {
        const n = Number(m[0]);
        if (n >= 1 && n <= max && !out.includes(n)) out.push(n);
    }
    return out;
}

/** 小节清单的字符预算（路由②输入里清单部分的上限，保 30s 超时安全区）。 */
const SECTION_INDEX_CHARS = 2200;
/** 单批最多命中章 / 供生成标注的小节数。 */
const MAX_HIT_CHAPTERS = 4;
const MAX_SECTIONS = 10;

/**
 * 两级路由：①章清单（全部章标题，几百字）→ 命中章；②小节清单（命中
 * 章的 h1~h6 标题）→ 小节。返回 K 别名 → 小节的映射（供生成 prompt 与
 * 后处理共享）。任何一步失败返回空映射（该批不加链接）。
 */
export async function routeKnowledge(
    chunk: string,
    index: KnowledgeIndex,
    deps: KnowRouteDeps
): Promise<Map<string, KnowSection>> {
    const out = new Map<string, KnowSection>();
    try {
        if (index.chapters.length === 0) return out;
        let hit = index.chapters;
        if (index.chapters.length > 1) {
            const list = index.chapters.map((c, i) => `${i + 1}|${c.path}`).join("\n");
            const reply = await deps.call(
                `你是思源笔记的知识点路由器。下面是题目原文和章节清单（编号|路径）。
判断这批题目考查的内容涉及哪些章节，只输出 JSON，格式之外不要输出任何文字：
{"chapters":[编号,编号]}
规则：只输出清单里存在的编号，最多 ${MAX_HIT_CHAPTERS} 个，按相关度降序；没有合适的输出 {"chapters":[]}。

章节清单：
${list}

题目原文：
${chunk}`
            );
            const nums = parseNums(reply, index.chapters.length).slice(0, MAX_HIT_CHAPTERS);
            hit = nums.map((n) => index.chapters[n - 1]);
            if (hit.length === 0) return out;
        }
        // 汇总命中章的小节（按字符预算截断；无小节的章引用文档根本身）
        const picked: KnowSection[] = [];
        let chars = 0;
        for (const ch of hit) {
            if (ch.sections.length === 0) {
                picked.push({ id: ch.docId, title: ch.title, path: ch.path });
                continue;
            }
            for (const s of ch.sections) {
                if (chars + s.path.length > SECTION_INDEX_CHARS) continue;
                chars += s.path.length;
                picked.push(s);
            }
        }
        if (picked.length === 0) return out;
        const list2 = picked.map((s, i) => `${i + 1}|${s.path}`).join("\n");
        const reply2 = await deps.call(
            `你是思源笔记的知识点路由器。下面是题目原文和知识点小节清单（编号|路径）。
判断这批题目考查的具体知识点对应哪些小节，只输出 JSON，格式之外不要输出任何文字：
{"sections":[编号,编号]}
规则：只输出清单里存在的编号，最多 ${MAX_SECTIONS} 个，按相关度降序；没有合适的输出 {"sections":[]}。

知识点小节清单：
${list2}

题目原文：
${chunk}`
        );
        for (const n of parseNums(reply2, picked.length).slice(0, MAX_SECTIONS)) {
            const s = picked[n - 1];
            if (s) out.set(`K${out.size + 1}`, s);
        }
    } catch (_) {
        // 路由失败降级：本批不加知识点链接
    }
    return out;
}

/** 生成 prompt 的第 12 条规则（仅在路由出小节时追加）。 */
export function knowRule(): string {
    return `
12. 知识点标注：文末「知识点清单」列出本批内容可能涉及的知识点（K 编号）。每道题按考查内容在容器属性行末尾追加 custom-plugin-wengu-know="K1,K3"（1~3 个最相关编号，逗号分隔；只能用清单里的编号，不得编造；没有合适的不加该属性）。`;
}

/** 生成 prompt 文末的知识点清单（K 别号 → 展示路径）。 */
export function knowListBlock(map: Map<string, KnowSection>): string {
    const lines = [...map.entries()].map(([k, s]) => `${k}|${s.path}`);
    return `

知识点清单（供第 12 条规则标注用）：
${lines.join("\n")}`;
}

/** 路由+生成一体的批调用（ConvertBatch 的 worker 直接用）：先路由出
 *  小节（失败/为空降级为普通生成），再带着 K 清单调生成通道。 */
async function knowAwareCall(
    chunkText: string,
    index: KnowledgeIndex | undefined,
    deps: KnowRouteDeps & { generate(prompt: string): Promise<string> },
    buildPromptFn: (source: string, knowRuleBlock: string, knowList: string) => string
): Promise<{ reply: string; byAlias?: Map<string, KnowSection> }> {
    let rule = "";
    let list = "";
    let byAlias: Map<string, KnowSection> | undefined;
    if (index) {
        const routed = await routeKnowledge(chunkText, index, deps);
        if (routed.size > 0) {
            rule = knowRule();
            list = knowListBlock(routed);
            byAlias = routed;
        }
    }
    const reply = await deps.generate(buildPromptFn(chunkText, rule, list));
    return { reply, byAlias };
}

/** 组装「路由+生成」批调用：通道与生成本职一致（并发走 chatGPT 直答，
 *  串行走 agent/chat 可选模型；路由输出一行 JSON 用 quick 档），ConvertBatch
 *  只提供 prompt 组装与信号。 */
export function makeKnowAwareAi(opts: {
    modelId: string;
    parallel: number;
    signal: AbortSignal;
    knowIndex: KnowledgeIndex | undefined;
    buildPrompt: (source: string, knowRuleBlock: string, knowList: string) => string;
}): (chunkText: string) => Promise<{ reply: string; byAlias?: Map<string, KnowSection> }> {
    const call = (message: string): Promise<string> =>
        opts.parallel > 1
            ? agentChatConcurrent(message, AI_TIMEOUT.quick, opts.signal)
            : agentChat(message, opts.modelId, AI_TIMEOUT.quick, opts.signal);
    const generate = (prompt: string): Promise<string> =>
        opts.parallel > 1
            ? agentChatConcurrent(prompt, AI_TIMEOUT.batch, opts.signal)
            : agentChat(prompt, opts.modelId, AI_TIMEOUT.long, opts.signal);
    return (chunkText) => knowAwareCall(chunkText, opts.knowIndex, { call, generate }, opts.buildPrompt);
}

/** 引用文本消毒：去引号/换行，限长（块引用静态锚文本）。 */
function refTitle(title: string): string {
    return title
        .replace(/["<>\n\r]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 50);
}

/** 生成「相关知识点」引用行（模块内唯一真相：转换注入/事后匹配共用，
 *  反链面板可见的同格式）。 */
function knowledgeRefLine(refs: { id: string; title: string }[]): string {
    return `> 相关知识点：${refs.map((h) => `((${h.id} "${refTitle(h.title)}"))`).join(" ")}`;
}

/** 剥掉题目 kramdown 里已有的「相关知识点」引用行（事后匹配重挂前先清旧，
 *  与 injectKnowledgeRefs 配对成「替换」语义；纯函数）。连行尾换行一起
 *  吞——只删内容留空行会让 SOLUTION_RE 失配，inject 走容器尾兜底再补
 *  一个 solution 块，原 IAL 悬空（20260828 审查：重跑匹配越跑越坏）。 */
export function stripKnowledgeRefs(kd: string): string {
    return kd.replace(/^[ \t]*>[ \t]*相关知识点：.*(?:\r?\n)?/gm, "").replace(/\n{3,}/g, "\n\n");
}

/** 把知识点引用行注入题目 kramdown 的解析块尾（无解析块补独立块）。
 *  重新生成/针对性生成用：AI 不写引用，确定性注入。 */
export function injectKnowledgeRefs(kd: string, refs: { id: string; title: string }[]): string {
    if (refs.length === 0) return kd;
    const line = knowledgeRefLine(refs);
    const sol = SOLUTION_RE.exec(kd);
    if (sol) {
        return kd.replace(SOLUTION_RE, (_m, quote: string, ial: string) => `\n${quote}\n${line}\n${ial}`);
    }
    const close = kd.lastIndexOf("}}}");
    if (close < 0) return kd;
    return kd.slice(0, close) + `${line}\n{: custom-plugin-wengu-part="solution"}\n\n` + kd.slice(close);
}

/** 取知识点小节的正文（标题块 id → 该标题下到下一个同级/更高级标题
 *  之前的块内容，SQL 按 sort 顺序拼接；供重新生成/针对性生成喂正文）。 */
export async function sectionKramdown(headingId: string, maxChars = 3000): Promise<string> {
    const head = (await sql(`SELECT root_id, subtype FROM blocks WHERE id = '${headingId}' AND type = 'h' LIMIT 1`))[0];
    if (!head) return "";
    const myLevel = Number(head.get("subtype")?.replace("h", "")) || 2;
    const rows = await KernelQuery.rowsMapAll(
        `SELECT id, subtype, type, content FROM blocks WHERE root_id = '${head.get("root_id")}' AND type IN ('h','p','l','b','c','t','i','s','m','html','embed') ORDER BY sort`
    );
    let started = false;
    const out: string[] = [];
    for (const r of rows) {
        const isHead = r.get("type") === "h";
        if (started && isHead) {
            const lv = Number(r.get("subtype")?.replace("h", "")) || 1;
            if (lv <= myLevel) break; // 同级或更高级标题：小节结束
        }
        if (r.get("id") === headingId) {
            started = true;
            continue;
        }
        if (started && out.join("\n").length + r.get("content").length > maxChars) break;
        if (started) out.push(r.get("content"));
    }
    return out.join("\n\n");
}

/** 解析引述块（多行 > 引用 + 紧随的 part="solution" IAL 行）。引用与
 *  IAL 之间容忍空行——历史上被 strip 留空行污染过的记录由此重新匹配，
 *  inject 重写为紧邻形态即自愈（20260828 审查）。 */
const SOLUTION_RE =
    /\n[ \t]*(>[^\n]*(?:\n[ \t]*>[^\n]*)*)\n(?:[ \t]*\n)*[ \t]*(\{:[^\n]*custom-plugin-wengu-part="solution"[^\n]*\})/;

/**
 * 生成后处理：把题目容器 IAL 上的 know 别名映射回真实块 id——在解析
 * 引述块尾注入「相关知识点：((id "标题")) …」（并入 solution 块，作答
 * 前随解析一起隐藏防剧透），并剥掉临时属性（落盘格式不变）。
 * 无解析块时补一个独立的 solution 引述块。返回注入成功的题数。
 */
export function applyKnowLinks(
    questions: string[],
    byAlias: Map<string, KnowSection>
): { out: string[]; linked: number } {
    const out = [...questions];
    let linked = 0;
    for (let i = 0; i < out.length; i++) {
        const attr = /\s*custom-plugin-wengu-know="([^"]*)"/.exec(out[i]);
        if (!attr) continue;
        const stripped = out[i].replace(/\s*custom-plugin-wengu-know="[^"]*"/, "");
        const seen = new Set<string>();
        const hits: KnowSection[] = [];
        for (const a of attr[1].split(/[\s,;，；]+/)) {
            const s = byAlias.get(a.trim());
            if (s && !seen.has(s.id)) {
                seen.add(s.id);
                hits.push(s);
            }
        }
        if (hits.length === 0) {
            out[i] = stripped;
            continue;
        }
        const line = knowledgeRefLine(hits);
        const sol = SOLUTION_RE.exec(stripped);
        if (sol) {
            // 追加为解析引述块的最后一行引用（IAL 行之前），保持同一 part 块
            out[i] = stripped.replace(SOLUTION_RE, (_m, quote: string, ial: string) => `\n${quote}\n${line}\n${ial}`);
        } else {
            // 无解析块：容器闭合 }}} 前补独立 solution 块
            const close = stripped.lastIndexOf("}}}");
            if (close < 0) {
                out[i] = stripped;
                continue;
            }
            out[i] =
                stripped.slice(0, close) +
                `${line}\n{: custom-plugin-wengu-part="solution"}\n\n` +
                stripped.slice(close);
        }
        linked++;
    }
    return { out, linked };
}
