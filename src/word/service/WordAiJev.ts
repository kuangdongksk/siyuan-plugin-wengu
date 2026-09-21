import { judgeJev, type JevAnswer, type JevQuestion } from "../../ai/jev/client";
import type { JevTransportFn } from "../../ai/jev/transport";
import { choiceLowConfidence, noulVerdict } from "../../ai/jev/policy";
import type { JevTrack } from "../../ai/jev/track";
import { aiTitle } from "../../ui/shared";
import { tKey } from "../../ui/Notify";
import type { WordAiInput } from "./WordAi";

/**
 * Jev 判档供给方（Issue #185，规划稿 §三 B3）：把「选哪一档」这个口
 * 从生成式通道换成 Jev 判定——`applyAiReview` 的 FSRS 公式与落盘动作
 * **一行不动**，本模块只产 `{key, act}` 供其消费。
 *
 * 口径（规划稿 §二）：一次请求问完（一批评词，不逐词发）；
 * 低置信与判定失败**一律回落现状**——低置信的词干脆不给条目
 * （`applyAiReview` 对缺条目无动作 = 稳定度维持不动，比生成式通道
 * 解析失败整批放弃更细腻）；整批抛错由调用方回落生成式通道。
 *
 * 本模块**不产 `C:` 易混推断**（那是可试档 C1 的事，见 Issue #185 需求 4）。
 */

/** 判档结果条目（与 `applyAiReview` 入参同形，落盘侧零改动）。 */
export interface WordAiJevItem {
    key: string;
    act: "up" | "keep" | "down";
}

/** 档位动作（落盘侧只有这三档，见 `applyAiReview`）。 */
export const JEV_ACTS = ["up", "keep", "down"] as const;

/** 档位动作类型。 */
export type JevAct = (typeof JEV_ACTS)[number];

/**
 * 档位描述：把「什么情形算哪一档」写死（规划稿 §三 B3「档位描述写死具体
 * 情形」）。文案与 `wordReviewPrompt` 的判定规则同口径，改一处要同步另一处。
 *
 * ⚠️ **描述必须随 options 一起下发**：基建 `client.ts` 的 choice 组装是
 * `criteria[opt] = opt`（选项原文当描述，线格式已按生产实证收口、本单
 * **不许动**），参数只有「选项字符串」一个口——故这里**直接把描述当选项**
 * 下发，回取时按描述反查档位（`actOfOption`）。选项原文即判定依据，
 * 模型答什么我们就能对回什么，不依赖它认得 `up` 这种内部代号。
 */
export const JEV_ACT_CRITERIA: Record<JevAct, string> = {
    up: "掌握牢固：秒答且答对，可以拉长复习间隔（升档）",
    keep: "掌握不牢：答对但用时偏长或超时，间隔维持不动（保持）",
    down: "需要重来：答错、超时，或把该词认成了别的词，缩短间隔（降档）",
};

/** 选项原文（下发用）→ 档位；对不上返回 undefined（协议外答案不作数）。 */
export function actOfOption(option: string): JevAct | undefined {
    const hit = JEV_ACTS.find((a) => JEV_ACT_CRITERIA[a] === option);
    return hit;
}

/** 下发选项清单（按 JEV_ACTS 位序，与描述一一对应）。 */
export function actOptions(): string[] {
    return JEV_ACTS.map((a) => JEV_ACT_CRITERIA[a]);
}

/** 逐词画像 → 判定材料的一行（含档位判据所需的全部信号）。 */
function inputLine(e: WordAiInput, i: number): string {
    const parts = [`${i + 1}. ${e.w}（${e.m.split("\n")[0]}）`];
    if (e.correct !== undefined) parts.push(e.correct ? "答对" : "答错");
    if (e.count > 0) parts.push(`累计答错 ${e.count} 次`);
    if (e.mode && e.ms !== undefined) {
        parts.push(`${e.mode} 有效用时 ${(e.ms / 1000).toFixed(1)} 秒${e.over ? "（超时）" : ""}`);
    }
    if (e.typed) parts.push(`拼成了「${e.typed}」`);
    if (e.confused) parts.push(`学生自述认成了：${e.confused}`);
    return parts.join("，");
}

/**
 * 组装 judgeJev 的 `state` 判定材料：**逐词一行**，位序与 `inputs` 严格一致
 * （问题按位取名 `q0..qN`，`parseAnswers` 已按位回取）。
 * 每词 2 问：`choice` 选档 + `noul` 探「是没记住还是手滑」。
 */
export function buildWordReviewState(inputs: WordAiInput[]): string {
    return [
        "下面是学生背单词的作答数据，每行一个词。请逐词判断该词的掌握程度，并安排复习档位。",
        ...inputs.map(inputLine),
    ].join("\n");
}

/** 判定问题清单：逐词 choice（选档）+ noul（没记住 vs 手滑），位序 2i / 2i+1。
 *
 * ⚠️ 词号取**输入下标**（`i + 1`），别用 `qs.length / 2 + 1` 现算——后者在
 * noul 那一问里 `qs.length` 已是奇数，问出来是「第 1.5 个词」（#185 审查）。
 * 词号须与 `state` 材料行号（`1. alpha`）逐一对齐，否则模型对不上词。
 */
export function buildWordReviewQuestions(inputs: WordAiInput[]): JevQuestion[] {
    const qs: JevQuestion[] = [];
    inputs.forEach((e, i) => {
        const label = `第 ${i + 1} 个词「${e.w}」`;
        qs.push({
            kind: "choice",
            question: `${label}该走哪个复习档位？（${e.m.split("\n")[0]}）`,
            options: actOptions(),
        });
        qs.push({
            kind: "noul",
            question: `${label}这次答错是「没记住」而不是「手滑/手误」吗？`,
        });
    });
    return qs;
}

/**
 * 答案批次 → 判档条目（纯函数，单测直击）：
 *  - choice 低置信（`choiceLowConfidence`）→ **跳过该词**（稳定度不动）；
 *  - choice 选中项不在三档内 → 跳过（协议外的答案不当档位用）；
 *  - noul 明确「是」（≥0.8）→ 就是没记住，**保持 choice 给的动作**；
 *  - noul 明确「否」（≤0.2）→ 是手滑：**不降档**（`down` 修正为 `keep`）；
 *  - noul 不确定 → 维持 choice 的结果（不因一次拿不准改变档位）。
 *
 * `keep` 条目照样产出：`applyAiReview` 对 keep 是空动作，语义即「不动」。
 */
export function gradeFromAnswers(inputs: WordAiInput[], answers: JevAnswer[]): WordAiJevItem[] {
    const out: WordAiJevItem[] = [];
    inputs.forEach((e, i) => {
        const ca = answers[i * 2];
        const na = answers[i * 2 + 1];
        if (!ca || ca.kind !== "choice") return;
        if (choiceLowConfidence(ca.confidence)) return;
        const picked = actOfOption(ca.choice);
        if (!picked) return;
        let act: JevAct = picked;
        // 手滑修正：仅对「降档」生效——答对的长间隔档不因 noul 翻案
        if (act === "down" && na && na.kind === "noul" && noulVerdict(na.noul) === "no") act = "keep";
        out.push({ key: e.key, act });
    });
    return out;
}

/** judgeJev 的可注入面（单测 mock，不碰真网络）。 */
export type JudgeFn = (opts: {
    state: string;
    questions: JevQuestion[];
    apiKey: string;
    transport?: JevTransportFn;
    sleep?: (ms: number) => Promise<void>;
    /** 会话登记（Issue #201）：判定落「AI 会话」面板的标题/分组。 */
    track?: JevTrack;
}) => Promise<JevAnswer[]>;

/** 判定登记的标题（Issue #201）：`Jev 判档 · N 词`（与生成式侧
 *  `aiTitleWordReview` 同款的「动作名 · 规模」形态，便于两通道对照）。 */
export function wordReviewTrack(n: number): JevTrack {
    return { title: aiTitle(tKey, "aiTitleJevWord", { n: String(n) }) };
}

/**
 * Jev 判档主入口：一批词一次请求 → 判档条目。
 * 抛错（auth/网络/协议）由调用方接住并**整批回落生成式通道**。
 */
export async function judgeWordReview(
    inputs: WordAiInput[],
    apiKey: string,
    judge: JudgeFn = judgeJev
): Promise<WordAiJevItem[]> {
    if (inputs.length === 0) return [];
    const answers = await judge({
        state: buildWordReviewState(inputs),
        questions: buildWordReviewQuestions(inputs),
        apiKey,
        // 登记（Issue #201）：一批一次判定 → 一条记录（判定的重来办法是
        // 攒够又一批再跑一次，没有记录级重试，见 core/SessionDetail）
        track: wordReviewTrack(inputs.length),
    });
    return gradeFromAnswers(inputs, answers);
}
