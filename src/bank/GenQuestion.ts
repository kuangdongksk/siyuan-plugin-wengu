import { agentChat } from "../convert/AgentClient";
import { extractBatchQuestions } from "../convert/ConvertService";
import { sectionKramdown } from "../convert/KnowledgeLink";
import type { QuestionBank } from "./QuestionBank";

/**
 * 单题生成核（薄弱加练与知识点补题共用）：变式=以该点入库题（错得
 * 最多的优先）为模板改数字/换条件；概念=依知识点小节出概念/辨析题。
 * 每题生成后 AI 自检（独立重做校验答案），不过检丢弃返回空串。
 */

const GEN_TIMEOUT_MS = 300_000;

/** 生成点：薄弱行或知识点索引行，薄弱字段缺省时 prompt 相应行省略。 */
export interface GenPoint {
    /** 聚合键（kp: 块 id / kn: / ch:）。 */
    key: string;
    title: string;
    wrong?: number;
    topCause?: string;
    aiNote?: string;
}

/** 生成一题并自检；失败/不过检返回空串。 */
export async function generateQuestion(
    bank: QuestionBank,
    point: GenPoint,
    mode: "variant" | "concept",
    modelId: string
): Promise<string> {
    const kpId = point.key.startsWith("kp:") ? point.key.slice(3) : "";
    const section = mode === "concept" && kpId ? await sectionKramdown(kpId) : "";
    let template = "";
    if (mode === "variant") {
        const records = await bank.recordsByKeys([point.key]);
        const wrongMost =
            records.filter((r) => r.stats.wrongCount > 0).sort((a, b) => b.stats.wrongCount - a.stats.wrongCount)[0] ??
            records[0];
        template = wrongMost?.kramdown ?? "";
        if (!template) return ""; // 变式必须有真题模板
    }
    const statLine = (() => {
        const bits: string[] = [];
        if (point.wrong !== undefined) bits.push(`做错 ${point.wrong} 次`);
        if (point.topCause) bits.push(`主要错因：${point.topCause}`);
        if (point.aiNote) bits.push(`AI 批注：${point.aiNote}`);
        return bits.length > 0 ? `（${bits.join("；")}）` : "";
    })();
    const prompt =
        mode === "variant"
            ? `你是考研刷题的变式出题助手。以原题为模板，改数字/换条件/反向提问出一道同知识点的变式题。
要求：结构、题型与原题一致；新数据必须凑巧（答案干净可验算）；正确答案与解析自洽完整。
只输出一个题目超级块的 kramdown（{{{row … }}} + 容器属性行 custom-plugin-wengu-q="1" 和 custom-plugin-wengu-type），格式之外不要输出任何文字。

【原题${statLine}】
${template}`
            : `你是考研刷题的概念辨析出题助手。依据知识点小节出一道概念/辨析题（单选或判断）。
要求：只考概念辨析（不考计算）；干扰项来自常见误解；正确答案与解析自洽。
只输出一个题目超级块的 kramdown（{{{row … }}} + 容器属性行 custom-plugin-wengu-q="1" 和 custom-plugin-wengu-type），格式之外不要输出任何文字。

【知识点：${point.title}${statLine}】
${section}`;
    const reply = await agentChat(prompt, modelId, GEN_TIMEOUT_MS);
    const qs = extractBatchQuestions(reply).filter((x) => x.includes('part="stem"'));
    if (qs.length === 0) return "";
    const kd = qs[0];
    // 自检：AI 重做校验答案（不过检丢弃——数学计算题的保险丝）
    const check = await agentChat(
        `你是解题验算助手。独立解下面的题，再与题内给出的答案比对。只输出一行：
VERIFY: yes 或 no（答案与解析自洽为 yes；算不平/矛盾为 no）

${kd}`,
        modelId,
        180_000
    );
    if (!/VERIFY\s*[:：]\s*(yes|是)/i.test(check)) return "";
    return kd;
}
