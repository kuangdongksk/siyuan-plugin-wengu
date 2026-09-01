import { agentChatOnce } from "../../ai/client";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { extractBatchQuestions } from "../../convert/service/ConvertService";
import { sectionKramdown } from "../../convert/service/KnowRef";
import type { QuestionBank } from "../data/QuestionBank";
import { recordsByKeys } from "../data/BankRegen";

/**
 * 单题生成核（薄弱加练与知识点补题共用）：变式=以该点入库题（错得
 * 最多的优先）为模板改数字/换条件；概念=依知识点小节出概念/辨析题。
 * 每题生成后 AI 自检（独立重做校验答案），不过检丢弃返回空串。
 */

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
    const track = { kind: "regen", title: `出题 · ${point.title}` };
    const kpId = point.key.startsWith("kp:") ? point.key.slice(3) : "";
    const section = mode === "concept" && kpId ? await sectionKramdown(kpId) : "";
    let template = "";
    if (mode === "variant") {
        const records = await recordsByKeys(bank, [point.key]);
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
            ? variantPrompt(template, statLine)
            : `你是考研刷题的概念辨析出题助手。依据知识点小节出一道概念/辨析题（单选或判断）。
要求：只考概念辨析（不考计算）；干扰项来自常见误解；正确答案与解析自洽。
只输出一个题目超级块的 kramdown（{{{row … }}} + 容器属性行 custom-plugin-wengu-q="1" 和 custom-plugin-wengu-type），格式之外不要输出任何文字。

【知识点：${point.title}${statLine}】
${section}`;
    return genWithVerify(prompt, modelId, track);
}

/** 按题变式（V1，docs/variant-and-doctree.md §一）：以指定题自己为模板
 *  出变式（整卷/仅错题变式重练用），prompt 与自检和知识点变式同款。 */
export async function generateVariantOf(templateKramdown: string, modelId: string): Promise<string> {
    if (!templateKramdown) return "";
    return genWithVerify(variantPrompt(templateKramdown, ""), modelId, { kind: "regen", title: "变式重练" });
}

function variantPrompt(template: string, statLine: string): string {
    return `你是考研刷题的变式出题助手。以原题为模板，改数字/换条件/反向提问出一道同知识点的变式题。
要求：结构、题型与原题一致；新数据必须凑巧（答案干净可验算）；正确答案与解析自洽完整。
只输出一个题目超级块的 kramdown（{{{row … }}} + 容器属性行 custom-plugin-wengu-q="1" 和 custom-plugin-wengu-type），格式之外不要输出任何文字。

【原题${statLine}】
${template}`;
}

/** 发 prompt 出题 + AI 自检（独立重做校验答案，不过检丢弃返回空串）。
 *  独立会话通道（20260830）：出题/自检天然并发，不再过共享串行队列；
 *  track 登记进 AI 会话面板（自检标「自检」后缀区分）。 */
async function genWithVerify(prompt: string, modelId: string, track: { kind: string; title: string }): Promise<string> {
    const reply = await agentChatOnce(prompt, modelId, AI_TIMEOUT.long, undefined, track);
    const qs = extractBatchQuestions(reply).filter((x) => x.includes('part="stem"'));
    if (qs.length === 0) return "";
    const kd = qs[0];
    const check = await agentChatOnce(
        `你是解题验算助手。独立解下面的题，再与题内给出的答案比对。只输出一行：
VERIFY: yes 或 no（答案与解析自洽为 yes；算不平/矛盾为 no）

${kd}`,
        modelId,
        AI_TIMEOUT.mid,
        undefined,
        { kind: track.kind, title: `${track.title} · 自检` }
    );
    if (!/VERIFY\s*[:：]\s*(yes|是)/i.test(check)) return "";
    return kd;
}
