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
import type { KnowChapter, KnowledgeIndex, KnowSection } from "./KnowledgeLink";

/**
 * 两级路由执行（20260910 自 KnowledgeLink 拆出压 500 行红线）：AI 回复
 * 编号解析、小节清单构造（剥公共前缀 + 字符预算）、单题/批量两级漏斗、
 * 失败归类，以及路由+生成一体的批调用通道（makeKnowAwareAi，ConvertBatch
 * 的 worker 直接用）。索引构建（章→小节 SQL 索引、知识面板展开）在
 * KnowledgeLink.ts——任何路由失败都降级为「该批不加链接」，不阻断主流程。
 */

/** 路由调用通道（与生成同通道：串行走 agent/chat 独立会话）。 */
export interface KnowRouteDeps {
    call(message: string): Promise<string>;
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
