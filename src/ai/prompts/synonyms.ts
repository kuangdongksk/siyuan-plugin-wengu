import { TAG_MAX_CHARS } from "./common";

/**
 * 知识点同义词判定族 prompt（20260910，Issue #3）：文本精确层未命中的
 * 「题目 knowledge 标签 × 知识文档小节标题」词对按批送 AI 判同义
 * （「洛必达」↔「L'Hôpital 法则」↔「洛必达法则」）。
 *
 * **与 route.ts 同源的清单协议**（20260910 审查修复）：一批共用**一份
 * 编号小节清单**，AI 逐行回「标签编号|小节编号」。旧版给每对词只塞 4 条
 * 候选，跨语言对（「洛必达」↔「L'Hôpital 法则」）的正确项根本不在清单里，
 * AI 只能答「-」，而判否会被落表固化——该对词就此判死。清单共用后 AI
 * 始终看得到全部（预算内）小节标题，规范词仍是清单侧原文，不许造词。
 */

/** 同义判定单批词对上限（与 ROUTE_BATCH_SIZE=15 同量级：短输出、
 *  一次调用多判几对；批越大模型漏判概率越高）。 */
export const SYN_BATCH_SIZE = 15;

/** 共用清单的字符预算（比 route 的 SECTION_INDEX_CHARS=4500 更宽）：
 *  清单里装下的小节标题越多，跨语言对越可能命中，且**清单一旦被截断，
 *  该批的「不同义」判定就不落表**（正确项可能正落在被截掉的部分）——
 *  预算给足可让常见规模的词表（数百条标题）完整入清单，判否才能落表、
 *  同对词第二次才真的零 AI。只有病态大的词表才走截断保守分支。 */
export const SYN_LIST_CHARS = 6000;

/** 规范写法长度上限（防 AI 跑飞写进超长句）。与自由标签同源（Issue #143
 *  P3-6：原为 30，与 parseFreeTags 的 24 漂移）——同一份术语长度口径，
 *  收口到 {@link TAG_MAX_CHARS}，本别名保留给既有调用点。 */
export const SYN_MAX_CHARS = TAG_MAX_CHARS;

/** 解析出的「明确不同义」哨兵（唯一该落表记否的判定）。 */
export const SYN_DENY = "-";

/** 批量同义判定 prompt：一批共用的编号小节清单 + 编号标签行。输出行
 *  协议（非 JSON，容错优先——同仓「坏一题不坏一批」的口径）：
 *  `标签编号|小节编号` 或 `标签编号|-`。 */
export function synJudgePrompt(pairs: { label: string }[], list2: string, listTitle: string): string {
    const lines = pairs.map((p, i) => `${i + 1}|${p.label}`).join("\n");
    return `你是知识点的术语对齐助手。下面是${listTitle}（编号|写法）与一批题目知识点标签（编号|标签）。
判断每个标签是否与清单里某一项指同一个知识点（含跨语言/简称全称/换写法，如「洛必达」与「L'Hôpital 法则」）。
逐行输出，格式之外不要输出任何文字：
标签编号|小节编号
规则：同义时**只写清单里那一项的编号**（不得自造写法、不得写清单外的编号）；不同义时写 -；不确定也写 -。
标签编号必须与给出的一致，一行一个，按 1,2,3... 顺序输出，不要合并、不要解释。

${listTitle}：
${list2}

标签：
${lines}`;
}

/** 解析同义判定回复（纯函数）：`编号|判定` 行 → 标签编号 → 判定。
 *  三种值语义：
 *  - {@link SYN_DENY}：明确不同义（落表记否的唯一来源）；
 *  - 空串：**说不清**（AI 写了「同义/是/yes」却没给编号，或空白）——
 *    调用方按「未判定」处理，不落表，下次重问；
 *  - 其它：原样写法（编号或标题，调用方按清单解析；解析不到也按未判定
 *    处理——宁漏勿错，且防一次错判被永久固化）。
 *  缺行=未判定（调用方不落表）。 */
export function parseSynReply(reply: string): Map<number, string> {
    const out = new Map<number, string>();
    for (const m of reply.matchAll(/^\s*(\d+)\s*[|｜:：]\s*(.+?)\s*$/gm)) {
        const n = Number(m[1]);
        if (!Number.isFinite(n) || n < 1 || out.has(n)) continue;
        const raw = m[2]
            .trim()
            .replace(/[。；;]+$/, "")
            .trim();
        if (!raw || raw === "-" || raw === "－" || /^(不同义|否|不是|no|none|n\/a)$/i.test(raw)) {
            out.set(n, raw ? SYN_DENY : "");
            continue;
        }
        if (/^(同义|相同|是|一样|同一个知识点|yes|same)$/i.test(raw)) {
            out.set(n, "");
            continue;
        }
        out.set(n, raw.slice(0, SYN_MAX_CHARS));
    }
    return out;
}
