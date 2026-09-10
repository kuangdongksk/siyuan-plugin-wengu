import { agentChatOnce, newAiGroupId, type AiAbort } from "../../ai/client";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { conceptPrompt, variantPrompt, verifyPrompt } from "../../ai/prompts/gen";
import { hasStemPart, parseDrafts, renderUnit } from "../../convert/service/QuestionDraft";
import { shuffleDraftOptions } from "../../convert/service/OptionShuffle";
import { sectionKramdown } from "../../convert/service/KnowRef";
import type { QuestionBank } from "../data/QuestionBank";
import { knowNodeText, knowTreesOf } from "../data/KnowTrees";
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

/** 生成一题并自检；失败/不过检返回空串。abort 供后台流接线：signal
 *  断流、onSid 挂 AI 会话面板的「停止」（20260905 去阻塞改造）。 */
export async function generateQuestion(
    bank: QuestionBank,
    point: GenPoint,
    mode: "variant" | "concept",
    modelId: string,
    abort?: AiAbort
): Promise<string> {
    const track = { kind: "regen", title: `出题 · ${point.title}` };
    const kpId = point.key.startsWith("kp:") ? point.key.slice(3) : "";
    const section =
        mode === "concept" && kpId ? (await sectionKramdown(kpId)) || knowNodeText(await knowTreesOf(bank), kpId) : "";
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
        mode === "variant" ? variantPrompt(template, statLine) : conceptPrompt(point.title, statLine, section);
    return genWithVerify(prompt, modelId, track, abort);
}

/** 按题变式（V1，docs/variant-and-doctree.md §一）：以指定题自己为模板
 *  出变式（整卷/仅错题变式重练用），prompt 与自检和知识点变式同款。 */
export async function generateVariantOf(templateKramdown: string, modelId: string, abort?: AiAbort): Promise<string> {
    if (!templateKramdown) return "";
    return genWithVerify(variantPrompt(templateKramdown, ""), modelId, { kind: "regen", title: "变式重练" }, abort);
}

/** 发 prompt 出题 + AI 自检（独立重做校验答案，不过检丢弃返回空串）。
 *  独立会话通道（20260830）：出题/自检天然并发，不再过共享串行队列；
 *  track 登记进 AI 会话面板（自检标「自检」后缀区分）；两发挂同组
 *  （20260902 树状分组：一次出题动作=面板一棵子树）。 */
async function genWithVerify(
    prompt: string,
    modelId: string,
    track: { kind: string; title: string },
    abort?: AiAbort
): Promise<string> {
    const group = { id: newAiGroupId(), title: track.title };
    const reply = await agentChatOnce(prompt, modelId, AI_TIMEOUT.long, abort?.signal, {
        ...track,
        group,
        ...(abort ? { onSid: abort.onSid } : {}),
    });
    const drafts = parseDrafts(reply).filter(hasStemPart);
    if (drafts.length === 0) return "";
    shuffleDraftOptions(drafts[0]);
    const kd = renderUnit(drafts[0]);
    const check = await agentChatOnce(verifyPrompt(kd), modelId, AI_TIMEOUT.mid, abort?.signal, {
        kind: track.kind,
        title: `${track.title} · 自检`,
        group,
        ...(abort ? { onSid: abort.onSid } : {}),
    });
    if (!/VERIFY\s*[:：]\s*(yes|是)/i.test(check)) return "";
    return kd;
}
