import { errText } from "./../../ui/shared";
import { agentChatOnce } from "../../ai/client";
import { isJevEnabled, type JevSettingsLike } from "../../ai/jev/enabled";
import { defaultAgentModelId } from "../../ai/models";
import { wordReviewPrompt } from "../../ai/prompts/misc";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { aiTitle, fmt } from "../../ui/shared";
import { tKey } from "../../ui/Notify";
import { wordLib } from "./WordLib";
import { addPair } from "./WordConfusables";
import { judgeWordReview, type JudgeFn, type WordAiJevItem } from "./WordAiJev";
import { applyAiReview, keyIndex, keyOf, type WenguTimingRec, type WenguWordProgress } from "../core/WordStore";

/**
 * AI 复盘（docs/word-timing.md）：误认词手动分析 + 组完成自动触发
 * 共用一条管线。走 ai/client 的 agentChatOnce 一次性独立会话（独立
 * sessionID 天然并发），与判分/转换互不阻塞。每批 ≤20 词，多批顺序执行。
 * 运行态（running/msg）由 WordView.syncAi 镜像进响应态供按钮/消息渲染。
 *
 * 回复协议（锚定规则，不凭空给天数）：
 *   W: 单词 / L: up|keep|down（Leitner 档位动作）/ C: 混淆对象
 *   （可选，拼错成真词或自述推断）/ T: 辨析提示（仅误认词，≤60 字）。
 *
 * **判档供给方可插拔**（Issue #185，规划稿 §三 B3）：配置了 Jev key
 * （`isJevEnabled`）时「选哪一档」改由 `WordAiJev` 的 Jev 判定供给，
 * 生成式通道只在没 key 时接手——`applyAiReview` 的 FSRS 公式与落盘动作
 * 一行不动。Jev 路**不产 `C:` 易混推断/`T:` 辨析**（那是可试档 C1 的事），
 * 判定抛错时**整批回落生成式通道**（与「无 key」同一条路径，口径钉死在
 * 此，别改成静默跳过）。判定结果不落盘，现算现用（纪律 3）。
 */

/** 单批词数上限（提示词长度与返回稳定性折中）。 */
const BATCH_SIZE = 20;

/** 待分析词的完整作答画像（手动误认分析只需前半，组复盘带全量）。 */
export interface WordAiInput {
    index: number;
    /** 归一化词头（构建时刻冻结）：AI 往返是长事务，落盘点一律用它定位，
     *  不吃活下标——否则期间切书，keyOf 会按新书把档位/易混对写到
     *  无关词上（20260828 审查）。 */
    key: string;
    w: string;
    m: string;
    /** 累计答错次数。 */
    count: number;
    /** 用户自述「认成了什么」（AI 负责推断成英文词）。 */
    confused?: string;
    /** 本轮是否答对（组复盘）。 */
    correct?: boolean;
    /** 本轮题型与有效停留毫秒（组复盘）。 */
    mode?: string;
    ms?: number;
    /** 停留超时（走神/不确定，按「忘记」信号）。 */
    over?: 0 | 1;
    /** spell 错拼原文（可能是另一个真词 → C 行判定原料）。 */
    typed?: string;
}

/** 解析结果（word → index 由调用侧对回）。 */
interface ParsedItem {
    word: string;
    act: "up" | "keep" | "down";
    confused?: string;
    tip?: string;
}

/** 从一卡的作答现场构建组画像条目（WordView 收尾时调用）。 */
export function wordAiInput(
    p: WenguWordProgress,
    idx: number,
    grade: string,
    correct: boolean | undefined,
    timing: WenguTimingRec | undefined,
    typed: string | undefined,
    confessed: string | undefined
): WordAiInput {
    const entry = wordLib().curBook().words[idx];
    const key = keyOf(idx);
    const m = p.mistakes[key];
    return {
        index: idx,
        key,
        w: entry.w,
        m: entry.m,
        count: m?.count ?? 0,
        confused: confessed || m?.confused,
        correct: correct ?? grade !== "no",
        mode: timing?.mode,
        ms: timing?.ms,
        over: timing?.over,
        typed,
    };
}

/** Jev 判档的注入面（单测 mock；生产走默认 transport）。 */
export interface WordAiJevDeps {
    /** 设置读取器（**取用时读**活引用：设置装载会整对象替换）。 */
    settings?: () => JevSettingsLike | undefined;
    /** judgeJev 注入（单测用 mock，缺省走内核 forwardProxy）。 */
    judge?: JudgeFn;
}

/** 一批词走生成式通道（现状路径）：W/L/C/T 行协议 → 解析 → 落盘。 */
async function analyzeBatchChat(
    inputs: WordAiInput[],
    p: WenguWordProgress,
    save: () => Promise<unknown>
): Promise<number> {
    // 一次性独立会话：独立 sessionID 天然并发——单词复盘与判分/转换
    // 互不阻塞（20260829 起走 agentChatOnce；20260830 全仓统一此通道）
    const reply = await agentChatOnce(wordReviewPrompt(inputs), defaultAgentModelId(), AI_TIMEOUT.mid, undefined, {
        kind: "word",
        title: aiTitle(tKey, "aiTitleWordReview", { n: String(inputs.length) }),
    });
    const byWord = new Map(inputs.map((e) => [e.w.toLowerCase(), e]));
    const items: { key: string; act: "up" | "keep" | "down"; tip?: string; confused?: string }[] = [];
    for (const it of parseReply(reply)) {
        const hit = byWord.get(it.word.trim().toLowerCase());
        if (!hit) continue;
        items.push({ key: hit.key, act: it.act, tip: it.tip, confused: it.confused });
        if (it.confused) addPair(p, hit.key, it.confused, "ai");
    }
    applyAiReview(p, items);
    await save();
    return items.length;
}

/** 一批词走 Jev 判档：判定即用，不产 C/T 行、不落判定（Issue #185 需求 4/5）。
 *
 * ⚠️ **回落只包「判定」这一步**（#185 审查）：`null` = 判定失败（auth/网络/
 * 协议），此时进度**尚未被本批改动**，调用方回落生成式是干净的。判定成功
 * 后的 `applyAiReview` / `save` 一律照现状口径上抛，**不吞也不重放**——
 * 若把它们也包进 try，则「判定成功、落盘抛错」会被误判成判定失败再走一遍
 * 生成式通道，同一批词**二次挪档**（up 连乘 1.4²）且用户无感。
 */
async function analyzeBatchJev(
    inputs: WordAiInput[],
    p: WenguWordProgress,
    save: () => Promise<unknown>,
    apiKey: string,
    judge?: JudgeFn
): Promise<number | null> {
    let items: WordAiJevItem[];
    try {
        items = await judgeWordReview(inputs, apiKey, judge);
    } catch (_) {
        return null; // 判定失败：进度零改动，回落生成式通道（口径钉死在此）
    }
    applyAiReview(p, items);
    await save();
    return items.length;
}

/** 一批词的判档供给方选择（纯函数，单测锁定）：有 key 走 Jev、否则生成式。 */
function batchAnalyzer(
    deps: WordAiJevDeps
): (inputs: WordAiInput[], p: WenguWordProgress, save: () => Promise<unknown>) => Promise<number> {
    return async (inputs, p, save) => {
        const settings = deps.settings?.();
        if (isJevEnabled(settings)) {
            const n = await analyzeBatchJev(inputs, p, save, settings!.jevKey!.trim(), deps.judge);
            if (n !== null) return n;
            // 判定失败 → 现状路径原样接手；两条路都失败则异常上抛给 runner
        }
        return analyzeBatchChat(inputs, p, save);
    };
}

/** 多批串行分析（手动/组触发共用）。 */
async function analyzeAll(
    inputs: WordAiInput[],
    p: WenguWordProgress,
    save: () => Promise<unknown>,
    deps: WordAiJevDeps
): Promise<number> {
    const runBatch = batchAnalyzer(deps);
    let done = 0;
    for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
        done += await runBatch(inputs.slice(i, i + BATCH_SIZE), p, save);
    }
    return done;
}

/** 从回复中解析 W/L/C(/T) 块；无 L 行的块跳过。 */
export function parseReply(reply: string): ParsedItem[] {
    const out: ParsedItem[] = [];
    for (const block of reply.split(/(?=^\s*W\s*[:：])/m)) {
        const w = block.match(/^\s*W\s*[:：]\s*(.+)$/m);
        const l = block.match(/\bL\s*[:：]\s*(up|keep|down)\b/i);
        if (!w || !l) continue;
        out.push({
            word: w[1].trim(),
            act: l[1].toLowerCase() as ParsedItem["act"],
            confused: block.match(/\bC\s*[:：]\s*(.+)/)?.[1]?.trim(),
            tip: block.match(/\bT\s*[:：]\s*(.+)/)?.[1]?.trim(),
        });
    }
    return out;
}

/* ── 视图接线：状态位 + 运行（渲染镜像见 WordView.syncAi） ── */

/** AI 复盘的运行器：手动按钮 + 组完成自动触发。 */
export class WordAiRunner {
    running = false;
    /** 结果文案（"!" 前缀 = 失败，渲染层剥掉前缀标红）。 */
    msg = "";

    /** Jev 判档注入面（缺省全空 = 永远走生成式通道，单测/旧调用零感知）。 */
    private deps: WordAiJevDeps = {};

    constructor(private readonly t: (k: string) => string) {}

    /** 注入判档供给方依赖（WordView 装配时调用一次；settings 取用时读活引用）。 */
    setJevDeps(deps: WordAiJevDeps): void {
        this.deps = deps;
    }

    /** 手动分析的待办（误认本中无 note 的词，限当前书）。 */
    pending(p: WenguWordProgress): WordAiInput[] {
        const out: WordAiInput[] = [];
        for (const key of Object.keys(p.mistakes)) {
            const m = p.mistakes[key];
            if (m.note) continue;
            const i = keyIndex(key);
            const entry = i === undefined ? undefined : wordLib().curBook().words[i];
            if (entry) {
                out.push({ index: i, key, w: entry.w, m: entry.m, count: m.count, confused: m.confused });
            }
        }
        return out;
    }

    /** 手动跑一次分析（按钮路径）：写进度、状态变化经 syncHook 回调。 */
    async run(
        p: WenguWordProgress,
        save: () => Promise<unknown>,
        onApplied: () => void,
        syncHook: () => void
    ): Promise<void> {
        if (this.running) return;
        const pending = this.pending(p);
        if (pending.length === 0) {
            this.msg = this.t("wordAiNone");
            syncHook();
            return;
        }
        this.running = true;
        this.msg = "";
        syncHook();
        try {
            const n = await analyzeAll(pending, p, save, this.deps);
            this.msg =
                n > 0 ? fmt(this.t("wordAiDone"), { n: String(n) }) : this.t("wordAiFailed") + this.t("wordAiBadReply");
            onApplied();
        } catch (e) {
            this.msg = "!" + this.t("wordAiFailed") + errText(e).slice(0, 120);
        }
        this.running = false;
        syncHook();
    }

    /** 组完成自动触发（决策 6）：异步一步继续，不阻塞刷卡；
     * 失败静默记 msg（下次 syncAi 带出），onDirty 通知重排队列。 */
    async runGroup(
        inputs: WordAiInput[],
        p: WenguWordProgress,
        save: () => Promise<unknown>,
        onDirty: () => void
    ): Promise<void> {
        if (inputs.length === 0) return;
        try {
            await analyzeAll(inputs, p, save, this.deps);
            onDirty();
        } catch (e) {
            this.msg = "!" + this.t("wordAiFailed") + errText(e).slice(0, 120);
        }
    }
}
