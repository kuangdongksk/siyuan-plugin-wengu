/**
 * 知识点同义词判定族 prompt（20260910，Issue #3）：文本精确层未命中的
 * 「题目 knowledge 标签 × 知识文档小节标题」词对按批送 AI 判同义
 * （「洛必达」↔「L'Hôpital 法则」↔「洛必达法则」）。
 *
 * 协议风格与 route.ts 的批量四联一致（编号行 + 编号结果数组），一批
 * 一次调用；判定只认清单里出现的编号，AI 不得造新词——规范词是清单
 * 侧原文，写回同义表后继续走 `KnowledgeNorm` 归一链。
 */

/** 同义判定单批词对上限（与 ROUTE_BATCH_SIZE=15 同量级：短输出、
 *  一次调用多判几对；批越大模型漏判概率越高）。 */
export const SYN_BATCH_SIZE = 15;

/** 规范词长度上限（防 AI 跑飞写进超长句，同 parseFreeTags 的 24 字意）。 */
export const SYN_MAX_CHARS = 30;

/** 批量同义判定 prompt：每行一对「编号|标签 || 候选写法清单」，清单是
 *  词表白名单的子集，AI **只能逐字抄写清单里的一项**（不许造词）。
 *  输出行协议（非 JSON，容错优先——同仓「坏一题不坏一批」的口径）：
 *  `编号|规范写法` 或 `编号|-`。 */
export function synJudgePrompt(pairs: { label: string; titles: string }[]): string {
    const lines = pairs.map((p, i) => `${i + 1}|${p.label}    ||    ${p.titles}`).join("\n");
    return `你是知识点的术语对齐助手。下面每行是一对候选（编号|题目知识点标签 || 可能的规范写法清单）。
判断标签是否与清单里某一项指同一个知识点（含跨语言/简称全称/换写法，如「洛必达」与「L'Hôpital 法则」）。
逐行输出，格式之外不要输出任何文字：
编号|判定
判定规则：同义时**逐字抄写**清单里那一项的写法（不得改写、不得自造新词）；不同义或清单里没有同义的写 -。
编号必须与给出的一致，一行一对，按编号 1,2,3... 顺序输出，不要合并、不要解释。

候选：
${lines}`;
}

/** 解析同义判定回复（纯函数）：`编号|判定` 行 → 编号 → 规范词（'' =
 *  明确不同义，undefined 缺行由调用方按未判定处理）。判定写「同义/
 *  是/yes」时记空串——调用方以清单侧标题作为规范词（词表受控，不让
 *  AI 造词）。 */
export function parseSynReply(reply: string): Map<number, string> {
    const out = new Map<number, string>();
    for (const m of reply.matchAll(/^\s*(\d+)\s*[|｜:：]\s*(.+?)\s*$/gm)) {
        const n = Number(m[1]);
        if (!Number.isFinite(n) || n < 1 || out.has(n)) continue;
        const raw = m[2]
            .trim()
            .replace(/[。；;]+$/, "")
            .trim();
        if (!raw || raw === "-" || raw === "－") {
            out.set(n, "");
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
