import { agentChatOnce, type AiSessionGroup } from "../../../ai/client";
import { AI_TIMEOUT } from "../../../ai/timeouts";
import {
    batchChapterPrompt,
    batchSectionPrompt,
    chapterRoutePrompt,
    knowListBlock,
    knowRule,
    MAX_HIT_CHAPTERS,
    MAX_SECTIONS,
    sectionRoutePrompt,
} from "../../../ai/prompts/route";
import { KernelQuery } from "../../../siyuan/query";
import { KernelBlock } from "../../../siyuan/block";
import { stripChapterEcho } from "../../../bank/data/KnowTrees";
import type { KnowTreesMap } from "../../../bank/data/KnowTrees";

/**
 * 知识点反链（从 ConvertBatch 拆出的独立关注点）：
 * 转换前按用户给的知识点根文档（书架/书）建两级索引（章 → h1~h6 小节，
 * 全部走 SQL 拿块 id，不导出正文）；每批生成前先路由出本批涉及的小节，
 * 让 AI 用 K 别名标注（避免抄错长块 id）——别名映射回真实块 id、解析
 * 引述块尾注入 `((id "标题"))` 块引用的后处理在 KnowRef.ts（20260831
 * 拆出压 500 行红线）。知识点文档的反链面板即可看到相关题目，题目卡里
 * 点击可跳转（Protyle 原生渲染块引用）。
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
    /** 展示路径：文档标题路径 + 祖先标题链 + 本标题（buildSectionTree 建树后
     *  才有真层级——同文档不同 h1 下的同名小节不再撞车）。 */
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

/** 路由调用通道（与生成同通道：串行走 agent/chat 独立会话）。 */
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

/** 批量拉文档的 h1~h6 标题块（按 root_id 分组；subtype 供建树与祖先链
 *  ——20260831 前只取 content，层级信息在 SQL 阶段就丢了）。SQL 的
 *  ORDER BY sort 在导入语料上是任意序（块 sort 全退化），逐文档以
 *  KernelBlock.docOrder 回排成真文档序——buildSectionTree 的就近挂靠
 *  依赖标题按序到达，乱序会让子标题先于父标题沉到顶层（20260907
 *  真机：23/23 章节中雷，层级塌平）。 */
async function headingsByRoot(
    docIds: string[]
): Promise<Map<string, { id: string; content: string; level: number }[]>> {
    const byRoot = new Map<string, { id: string; content: string; level: number }[]>();
    if (docIds.length === 0) return byRoot;
    const ids = docIds.map((x) => `'${x}'`).join(",");
    for (const h of await KernelQuery.rowsMapAll(
        `SELECT root_id, id, content, subtype FROM blocks WHERE type = 'h' AND subtype IN ('h1','h2','h3','h4','h5','h6') AND root_id IN (${ids}) ORDER BY root_id, sort`
    )) {
        const k = h.get("root_id");
        const arr = byRoot.get(k) ?? [];
        arr.push({
            id: h.get("id"),
            content: h.get("content"),
            level: Number(h.get("subtype")?.replace("h", "")) || 1,
        });
        byRoot.set(k, arr);
    }
    for (const [docId, arr] of byRoot) {
        const order = await KernelBlock.docOrder(docId);
        const pos = (id: string): number => order.get(id) ?? Number.MAX_SAFE_INTEGER;
        arr.sort((a, b) => pos(a.id) - pos(b.id));
    }
    return byRoot;
}

/** 内部知识树命中文档 → 伪标题行（id=节点 id、level=节点层级）。树是
 *  对单薄章节的更好归纳，命中即**整体替换**该文档的 SQL 小节；未命中
 *  返回 undefined 走原路径。20260903 起树不落文档，面板/路由/词表经
 *  本并流点统一消费。chapterTitle 供头部章节名回声剔除（存量树与
 *  prompt 禁不住的新生成 alike——「1-行列式/行列式/…」双层嵌套），
 *  缺省不剔。 */
function treeHeads(
    trees: KnowTreesMap | undefined,
    docId: string,
    chapterTitle?: string
): { id: string; title: string; level: number }[] | undefined {
    const tree = trees?.[docId];
    if (!tree) return undefined;
    return stripChapterEcho(tree.nodes, chapterTitle ?? "").map((n) => ({
        id: n.id,
        title: n.title,
        level: n.level,
    }));
}

/**
 * 建知识点索引。rootIds 是用户填的知识点根文档（书架那层或直接一本
 * 书/一章）：取其下所有叶子文档为章节（书名空壳层自动排除），根自身
 * 无叶子后代时（用户直接指到章节）把根当唯一章节。无小节结构的章节
 * 引用文档根块本身。小节 path = 文档标题路径 + 祖先标题链（同级同名
 * 小节靠链区分，不再是假的两段拼接）。trees=内部知识树（命中章节的
 * 小节整体替换为树节点）。
 */
export async function buildKnowledgeIndex(rootIds: string[], trees?: KnowTreesMap): Promise<KnowledgeIndex> {
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
            const secs: KnowSection[] = [];
            const walk = (nodes: KnowSectionNode[], prefix: string): void => {
                for (const n of nodes) {
                    const path = `${prefix}/${n.title}`;
                    secs.push({ id: n.id, title: n.title, path });
                    walk(n.children, path);
                }
            };
            const heads =
                treeHeads(trees, leaf.get("id"), leaf.get("content") ?? "") ??
                (byRoot.get(leaf.get("id")) ?? []).map((h) => ({ id: h.id, title: h.content, level: h.level }));
            walk(buildSectionTree(heads), hp);
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
    /** 小节层级树（20260831 树化）：按 h1~h6 嵌套建的真树，知识面板
     *  按文档树观感逐层折叠展示。 */
    sectionTree: KnowSectionNode[];
}

/** 小节层级树节点：一个标题块 + 嵌套子标题（h1~h6 按级别挂父）。 */
export interface KnowSectionNode {
    id: string;
    title: string;
    children: KnowSectionNode[];
}

/**
 * 文档内标题平铺列表 → 层级树（纯函数）。思源标题块只存 subtype
 * （h1~h6）不存父子关系，嵌套按「更低级（数字更大）挂到前方最近的
 * 更高级标题下」的规则派生；跳级（h1 直下 h3）照常收编为子级——
 * 即与大纲/文档树的「就近挂靠」语义一致。
 */
export function buildSectionTree(heads: { id: string; title: string; level: number }[]): KnowSectionNode[] {
    const roots: KnowSectionNode[] = [];
    /** 各级别最近一个节点（栈式：新同级顶替、更深级清空）。 */
    const last: (KnowSectionNode | undefined)[] = [];
    for (const h of heads) {
        const node: KnowSectionNode = { id: h.id, title: h.title, children: [] };
        last[h.level] = node;
        for (let lv = h.level + 1; lv < last.length; lv++) last[lv] = undefined;
        // 父级 = 比本标题高级（数字小）的最近一个；没有则挂根层
        let parent: KnowSectionNode | undefined;
        for (let lv = h.level - 1; lv >= 1; lv--) {
            if (last[lv]) {
                parent = last[lv];
                break;
            }
        }
        (parent ? parent.children : roots).push(node);
    }
    return roots;
}

/**
 * 递归展开登记根的知识文档树（知识面板「导入文档」20260828 用）：根
 * 自身 + 全部后代文档（含书/章中间层）各一条，每条带自己的 h1~h6 小节
 * ——与 buildKnowledgeIndex 的分工：路由索引只要叶子章节，这里保留
 * 完整层级供面板按原生文档树观感逐文档展示（20260831 起小节再按标题
 * 级别建成 sectionTree 真树）。根查无/SQL 失败返回空数组（调用方按
 * 标题兜底区分「已删跳过」与「保留空节登记行」）。
 */
export async function expandKnowDocs(rootId: string, trees?: KnowTreesMap): Promise<KnowDocEntry[]> {
    const hit = await knowDocRows(rootId);
    if (!hit) return [];
    const docs = [hit.root, ...hit.rows];
    const byRoot = await headingsByRoot(docs.map((d) => d.get("id")));
    return docs.map((d) => {
        const heads =
            treeHeads(trees, d.get("id"), d.get("content") ?? "") ??
            (byRoot.get(d.get("id")) ?? []).map((h) => ({ id: h.id, title: h.content, level: h.level }));
        return {
            docId: d.get("id"),
            title: d.get("content") || d.get("hpath") || d.get("id"),
            hPath: d.get("hpath") ?? "",
            sections: heads.map((h) => ({ id: h.id, title: h.title })),
            sectionTree: buildSectionTree(heads),
        };
    });
}

/** 从路由回复里抽编号：优先解析约定 JSON（"chapters"/"sections" 数组），
 *  解析不出再按裸数字兜底。保序去重并限界 [1,max]。
 *  裸数字兜底会把多位编号拆散（"12" → 1、2 误判为 1、2 号章），故只在
 *  JSON 解析失败时启用，且只收以分隔符/首尾为边界的完整数字。 */
function parseNums(reply: string, max: number): number[] {
    const pick = (nums: number[]): number[] => {
        const out: number[] = [];
        for (const n of nums) {
            if (Number.isInteger(n) && n >= 1 && n <= max && !out.includes(n)) out.push(n);
        }
        return out;
    };
    const m = /"(?:chapters|sections)"\s*:\s*\[([\d\s,]*)\]/.exec(reply);
    if (m) {
        const nums = m[1]
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n));
        if (nums.length > 0) return pick(nums);
    }
    // 兜底：数字两侧必须是分隔边界（非标点/数字），避免拆散多位编号
    const out: number[] = [];
    for (const b of reply.matchAll(/(?<![\d.,])\d+(?![\d.,])/g)) {
        const n = Number(b[0]);
        if (n >= 1 && n <= max && !out.includes(n)) out.push(n);
    }
    return out;
}

/** 批量路由回复里抽逐题编号：解析 `{"chapters":[[1,2],[3]]}` /
 *  `{"sections":[[…],[…]]}`——外层数组第 i 个元素对应第 i 道题。按 count
 *  补零（AI 少输出时补空数组、多输出截断），每元素内保序去重限界 [1,max]。
 *  批量回复不走裸数字兜底（会把各题编号并成一个扁列表，归属全乱）。 */
function parseBatchNums(reply: string, max: number, count: number): number[][] {
    const pick = (nums: number[]): number[] => {
        const out: number[] = [];
        for (const n of nums) {
            if (Number.isInteger(n) && n >= 1 && n <= max && !out.includes(n)) out.push(n);
        }
        return out;
    };
    const out: number[][] = Array.from({ length: count }, (): number[] => []);
    const m = /"(?:chapters|sections)"\s*:\s*(\[[\s\S]*\])/.exec(reply);
    if (!m) return out;
    let idx = 0;
    for (const inner of m[1].matchAll(/\[([\d\s,]*)\]/g)) {
        if (idx >= count) break;
        const nums = inner[1]
            .split(",")
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n));
        out[idx] = pick(nums);
        idx++;
    }
    return out;
}

/** 小节清单的字符预算（路由②输入里清单部分的上限）。20260908 前为 2200
 *  保 30s 超时安全区，真机报障「路由没带全知识点」：知识树小节路径带完整
 *  文档前缀（均 ~28 字/条），高数单章 43 条截 1 条、线代 4 章并集 154 条
 *  只装 79 条（近半知识点 AI 根本看不到）。清单剥公共前缀后放宽到 4500
 *  ——超时按 SSE 空闲计（5000 字转换批先例），输入长度不再约束预算。 */
const SECTION_INDEX_CHARS = 4500;
/** 批量路由单批题数（20260909 三个弹窗省 AI 调用：一批一次调用替代逐题
 *  两级调用，清单只发一遍；与 TagDialog 自由生成 FREE_BATCH=15 同量级）。 */
export const ROUTE_BATCH_SIZE = 15;

/** 清单条目路径的最长公共目录前缀（段对齐不切半段）。返回值保证每条
 *  剥后仍剩非空：恰有条目等于前缀时回退一段，回退不了（前缀只剩首段）
 *  返回空串放弃剥——调用方零防御直接 slice。 */
export function commonDirPrefix(paths: string[]): string {
    if (paths.length === 0) return "";
    let pre = paths[0];
    for (const p of paths) {
        while (pre && !p.startsWith(pre)) {
            const cut = pre.lastIndexOf("/");
            pre = cut > 0 ? pre.slice(0, cut) : "";
        }
        if (!pre) return "";
    }
    if (pre && paths.some((p) => p === pre)) {
        const cut = pre.lastIndexOf("/");
        return cut > 0 ? pre.slice(0, cut) : "";
    }
    return pre;
}

/** 小节清单构造（路由②共用，单题/批量同源）：剥公共前缀（书/章路径对选
 *  编号零信息量，白烧字符预算）后按剩余长度装预算；截断从「跳过装不下的
 *  单条」升级为同步维护 kept——清单行号与 kept 下标一一对应，AI 回的编号
 *  按 kept 取小节。返回预算内保留的小节、编号清单文本、清单标题。 */
function buildSectionList(picked: KnowSection[]): {
    kept: KnowSection[];
    list2: string;
    listTitle: string;
} {
    const pre = commonDirPrefix(picked.map((s) => s.path));
    const rel = (p: string): string => (pre && p.startsWith(pre) ? p.slice(pre.length).replace(/^\//, "") : p);
    const kept: KnowSection[] = [];
    let chars = 0;
    for (const s of picked) {
        const r = rel(s.path);
        if (chars + r.length > SECTION_INDEX_CHARS) continue;
        chars += r.length;
        kept.push(s);
    }
    const list2 = kept.map((s, i) => `${i + 1}|${rel(s.path)}`).join("\n");
    const listTitle = pre ? `知识点小节清单（编号|路径，已省略公共前缀 ${pre}）` : "知识点小节清单";
    return { kept, list2, listTitle };
}

/** 路由失败上报（routeKnowledgeDiag 用）：stage 定位失败发生在哪一级。 */
export interface KnowRouteFail {
    stage: "chapter" | "section";
    error: Error;
}

/** 匹配失败归类（20260829 真机「0 命中无线索」补诊断）：把路由错误按
 *  关键词归到可行动的类别，hit=0 时给状态栏一句人话而非干瞪眼。 */
export type MatchFailKind = "model" | "timeout" | "network" | "other";

/** 错误归类（纯函数）：模型配置失效/超时/网络三分，其余归 other。 */
export function classifyMatchFail(msg: string): MatchFailKind {
    const m = msg.toLowerCase();
    if (/用户指南|进行配置|invalid model|model.*not|请先参考/.test(msg) || /model/.test(m)) return "model";
    if (/abort|timeout|timed?\s*out|超时/.test(m)) return "timeout";
    if (/fetch|network|econn|socket|failed to fetch|网络/.test(m)) return "network";
    return "other";
}

/**
 * 两级路由：①章清单（全部章标题，几百字）→ 命中章；②小节清单（命中
 * 章的 h1~h6 标题）→ 小节。返回 K 别名 → 小节的映射（供生成 prompt 与
 * 后处理共享）。任何一步失败返回空映射（该批不加链接）；onFail 透传时
 * 失败也会上报（诊断用，不改变降级语义）。
 */
export async function routeKnowledge(
    chunk: string,
    index: KnowledgeIndex,
    deps: KnowRouteDeps
): Promise<Map<string, KnowSection>> {
    return routeKnowledgeDiag(chunk, index, deps);
}

/** routeKnowledge 的诊断版：额外通过 onFail 上报每次 AI 调用失败（匹配
 *  批量跑完汇总失败原因用）。原接口保留给转换侧（不需要诊断）。 */
export async function routeKnowledgeDiag(
    chunk: string,
    index: KnowledgeIndex,
    deps: KnowRouteDeps,
    onFail?: (f: KnowRouteFail) => void
): Promise<Map<string, KnowSection>> {
    const out = new Map<string, KnowSection>();
    try {
        if (index.chapters.length === 0) return out;
        let hit = index.chapters;
        if (index.chapters.length > 1) {
            const list = index.chapters.map((c, i) => `${i + 1}|${c.path}`).join("\n");
            let reply: string;
            try {
                reply = await deps.call(chapterRoutePrompt(chunk, list));
            } catch (e) {
                onFail?.({ stage: "chapter", error: e as Error });
                return out;
            }
            const nums = parseNums(reply, index.chapters.length).slice(0, MAX_HIT_CHAPTERS);
            hit = nums.map((n) => index.chapters[n - 1]);
            if (hit.length === 0) return out;
        }
        // 汇总命中章的小节（无小节的章引用文档根本身）
        const picked: KnowSection[] = [];
        for (const ch of hit) {
            if (ch.sections.length === 0) {
                picked.push({ id: ch.docId, title: ch.title, path: ch.path });
                continue;
            }
            picked.push(...ch.sections);
        }
        if (picked.length === 0) return out;
        // 清单剥公共前缀（书/章路径对选编号零信息量，白烧字符预算）后按
        // 剩余长度装预算；截断从「跳过装不下的单条」升级为同步维护 kept
        // ——清单行号与 kept 下标一一对应，AI 回的编号按 kept 取小节。
        const { kept, list2, listTitle } = buildSectionList(picked);
        if (kept.length === 0) return out;
        let reply2: string;
        try {
            reply2 = await deps.call(sectionRoutePrompt(chunk, listTitle, list2));
        } catch (e) {
            onFail?.({ stage: "section", error: e as Error });
            return out;
        }
        for (const n of parseNums(reply2, kept.length).slice(0, MAX_SECTIONS)) {
            const s = kept[n - 1];
            if (s) out.set(`K${out.size + 1}`, s);
        }
    } catch (_) {
        // 路由失败降级：本批不加知识点链接
    }
    return out;
}

/**
 * 批量两级路由（20260909 三个弹窗省 AI 调用）：一次调用处理多道题——①章
 * 清单→逐题命中章；②命中章小节并集→逐题命中小节。返回逐题小节数组（与
 * chunks 下标对齐；零命中=空数组）。任一级调用失败调 onFail 并返回整批
 * 空数组（逐题降级未命中，不缓存）；单题零命中是合法结果（AI 明确判无），
 * 空数组照常缓存。
 */
export async function routeKnowledgeBatchDiag(
    chunks: string[],
    index: KnowledgeIndex,
    deps: KnowRouteDeps,
    onFail?: (f: KnowRouteFail) => void
): Promise<KnowSection[][]> {
    const n = chunks.length;
    const results: KnowSection[][] = Array.from({ length: n }, (): KnowSection[] => []);
    if (n === 0 || index.chapters.length === 0) return results;

    // ① 章级批量：章集合 >1 才需要选（=1 时全题命中该章，零调用）。
    let perQChapters: KnowChapter[][] = Array.from({ length: n }, () => index.chapters);
    if (index.chapters.length > 1) {
        const list = index.chapters.map((c, i) => `${i + 1}|${c.path}`).join("\n");
        let reply: string;
        try {
            reply = await deps.call(batchChapterPrompt(chunks, list));
        } catch (e) {
            onFail?.({ stage: "chapter", error: e as Error });
            return results;
        }
        const numsPerQ = parseBatchNums(reply, index.chapters.length, n);
        perQChapters = numsPerQ.map((nums) => nums.map((num) => index.chapters[num - 1]));
    }

    // ② 汇总所有题命中章的小节并集（按 id 去重），生成共享清单。
    const seen = new Set<string>();
    const picked: KnowSection[] = [];
    for (const chs of perQChapters) {
        for (const ch of chs) {
            if (ch.sections.length === 0) {
                if (!seen.has(ch.docId)) {
                    seen.add(ch.docId);
                    picked.push({ id: ch.docId, title: ch.title, path: ch.path });
                }
                continue;
            }
            for (const s of ch.sections) {
                if (seen.has(s.id)) continue;
                seen.add(s.id);
                picked.push(s);
            }
        }
    }
    if (picked.length === 0) return results;
    const { kept, list2, listTitle } = buildSectionList(picked);
    if (kept.length === 0) return results;

    // ③ 小节级批量：共享清单 + 逐题编号题目，一次调用回逐题命中小节。
    let reply2: string;
    try {
        reply2 = await deps.call(batchSectionPrompt(chunks, listTitle, list2));
    } catch (e) {
        onFail?.({ stage: "section", error: e as Error });
        return results;
    }
    const secNumsPerQ = parseBatchNums(reply2, kept.length, n);
    for (let i = 0; i < n; i++) {
        for (const num of secNumsPerQ[i].slice(0, MAX_SECTIONS)) {
            const s = kept[num - 1];
            if (s) results[i].push(s);
        }
    }
    return results;
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

/** 组装「路由+生成」批调用：两条链路统一走独立会话（agentChatOnce，
 *  可按次指定模型、天然并发——20260830 前并行分支走 chatGPT 直答会
 *  忽略用户选的模型，已弃用）；并发度由 ConvertBatch 的 worker 池
 *  控制，ConvertBatch 只提供 prompt 组装与信号。 */
export function makeKnowAwareAi(opts: {
    modelId: string;
    signal: AbortSignal;
    knowIndex: KnowledgeIndex | undefined;
    /** 会话登记标题前缀（目标文档标题；AI 会话面板识别批次归属用）。 */
    label?: string;
    /** 动作分组（AI 会话面板树归并）：路由+生成与同批检测挂同一组。 */
    group?: AiSessionGroup;
    buildPrompt: (source: string, knowRuleBlock: string, knowListBlock: string) => string;
}): (chunkText: string) => Promise<{ reply: string; byAlias?: Map<string, KnowSection> }> {
    const call = (message: string): Promise<string> =>
        agentChatOnce(message, opts.modelId, AI_TIMEOUT.quick, opts.signal, {
            kind: "route",
            title: opts.label ? `路由 · ${opts.label}` : undefined,
            group: opts.group,
        });
    const generate = (prompt: string): Promise<string> =>
        agentChatOnce(prompt, opts.modelId, AI_TIMEOUT.batch, opts.signal, {
            kind: "convert",
            title: opts.label ? `转换 · ${opts.label}` : undefined,
            group: opts.group,
        });
    return (chunkText) => knowAwareCall(chunkText, opts.knowIndex, { call, generate }, opts.buildPrompt);
}
