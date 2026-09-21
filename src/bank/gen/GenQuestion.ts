import { agentChatOnce, newAiGroupId, type AiAbort } from "../../ai/client";
import { aiTitle } from "../../ui/shared";
import { tKey } from "../../ui/Notify";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { conceptPrompt, variantPrompt, verifyPrompt } from "../../ai/prompts/gen";
import { hasStemPart, parseDrafts, renderUnit } from "../../convert/service/draft/QuestionDraft";
import { normalizeDraftOptionRefs, replaceDraftOptionRefs } from "../../convert/service/draft/OptionRefReplace";
import { unpackPackedOptions } from "../../convert/service/draft/OptionUnpack";
import { sectionKramdown } from "../../convert/service/knowledge/KnowRef";
import type { QuestionBank } from "../data/QuestionBank";
import { knowNodeText, knowTreesOf } from "../data/KnowTrees";
import { recordsByKeys } from "../data/BankRegen";
import { normalizeType } from "../../types";
import type { QuestionType } from "../../types";

/** 契约 kramdown 容器的题型（变式/重生成按题重出时取原题题型，
 *  让行协议只带该题型的部件约定；无 type 属性=undefined 全量兜底）。 */
function typeOfKd(kd: string): QuestionType | undefined {
    return normalizeType(/custom-plugin-wengu-type="([a-z]+)"/.exec(kd)?.[1]);
}

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
    const track = { kind: "regen", title: aiTitle(tKey, "aiTitleGen", { name: point.title }) };
    const kpId = point.key.startsWith("kp:") ? point.key.slice(3) : "";
    const section =
        mode === "concept" && kpId ? (await sectionKramdown(kpId)) || knowNodeText(await knowTreesOf(bank), kpId) : "";
    let template = "";
    let templateType: QuestionType | undefined;
    if (mode === "variant") {
        const records = await recordsByKeys(bank, [point.key]);
        const wrongMost =
            records.filter((r) => r.stats.wrongCount > 0).sort((a, b) => b.stats.wrongCount - a.stats.wrongCount)[0] ??
            records[0];
        template = wrongMost?.kramdown ?? "";
        if (!template) return ""; // 变式必须有真题模板
        templateType = normalizeType(wrongMost?.type); // record.type 权威（契约 type 属性同源）
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
            ? variantPrompt(template, statLine, templateType)
            : conceptPrompt(point.title, statLine, section);
    return genWithVerify(prompt, modelId, track, abort);
}

/** 按题变式（V1，docs/variant-and-doctree.md §一）：以指定题自己为模板
 *  出变式（整卷/仅错题变式重练用），prompt 与自检和知识点变式同款。 */
export async function generateVariantOf(templateKramdown: string, modelId: string, abort?: AiAbort): Promise<string> {
    if (!templateKramdown) return "";
    return genWithVerify(
        variantPrompt(templateKramdown, "", typeOfKd(templateKramdown)),
        modelId,
        { kind: "regen", title: aiTitle(tKey, "aiTitleVariant") },
        abort
    );
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
    // ⚠️ **不再洗牌**（Issue #131）：新造题的选项顺序由协议保证
    // （「正确项写最前」→ 渲染按序编字母 ⇒ 正确项恒为 A），
    // 消剧透改由**展示层**进卡 mount 前现洗（CardDisplayShuffle）——
    // 库与源文档同为死形态，落库哈希/自检基线因此稳定。
    //
    // ⚠️ **但「不洗牌」不等于「不接线」**（P1，20260915 审查）：本链产物
    // 经 `GenCore`/`VariantDrill` 的 `addGenerated` **直写题库**（不经
    // SetWriter），撤掉 `shuffleDraftOptions` 时一并带走的还有它原来的
    // 两道格式处理 —— 而 P1-2 把 `〔opt:X〕` 标记约定改成**缺省恒在**后，
    // 本链 prompt 已经要求 AI 写标记：不在这里替换，**裸标记原样落库并
    // 显示在题卡上**（与 regen 链同一个坑）。挤行同理：AI 把多选项塞进
    // 一个 `@@P opt` 时渲染只给首行编字母，不拆行就落库「只剩一个选项」。
    // 故按 SetWriter 同款两步接线（纯函数、返回新对象，不改调用方手里
    // 的 draft）：① 挤行拆行（不碰答案字母）→ ② 标记替换。
    // ③ 裸字母引用规范化（Issue #176）：同 SetWriter 三步链
    const fixed = normalizeDraftOptionRefs(replaceDraftOptionRefs(unpackPackedOptions(drafts[0])));
    const kd = renderUnit(fixed);
    const check = await agentChatOnce(verifyPrompt(kd), modelId, AI_TIMEOUT.mid, abort?.signal, {
        kind: track.kind,
        // ⚠️ 自检后缀是**语言相关写法**（中文「 · 自检」/ 英文「 · self-check」），
        // 不能在代码里拼 `${track.title} · 自检`——那会把中文后缀钉死给英文环境
        // （同规范 §8.6 对 `aiFlowSub` 的书名号口径）。
        title: aiTitle(tKey, "aiTitleSelfCheck", { name: track.title }),
        group,
        ...(abort ? { onSid: abort.onSid } : {}),
    });
    if (!/VERIFY\s*[:：]\s*(yes|是)/i.test(check)) return "";
    return kd;
}
