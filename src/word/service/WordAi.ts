import { agentChat } from "../../ai/client";
import { defaultAgentModelId } from "../../ai/models";
import { enqueueAi } from "../../ai/queue";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { fmt } from "../../ui/shared";
import { wordLib } from "./WordLib";
import { addPair } from "./WordConfusables";
import { applyAiReview, keyIndex, keyOf, type WenguTimingRec, type WenguWordProgress } from "../core/WordStore";

/**
 * AI 复盘（docs/word-timing.md）：误认词手动分析 + 组完成自动触发
 * 共用一条管线。走 ai/client 同一智能体端点、过共享串行队列 enqueueAi
 * ——无 sessionID 的 agentChat 在内核侧共用 "" 会话锁，并发互吞响应
 * （真机坑）。每批 ≤20 词，多批顺序执行。
 * 运行态（running/msg）由 WordView.syncAi 镜像进响应态供按钮/消息渲染。
 *
 * 回复协议（锚定规则，不凭空给天数）：
 *   W: 单词 / L: up|keep|down（Leitner 档位动作）/ C: 混淆对象
 *   （可选，拼错成真词或自述推断）/ T: 辨析提示（仅误认词，≤60 字）。
 */

/** 单批词数上限（提示词长度与返回稳定性折中）。 */
const BATCH_SIZE = 20;

/** 待分析词的完整作答画像（手动误认分析只需前半，组复盘带全量）。 */
export interface WordAiInput {
    index: number;
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
    const m = p.mistakes[keyOf(idx)];
    return {
        index: idx,
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

/** 分析一批词并落盘（档位动作 + 配对 + 辨析），返回生效条数。 */
async function analyzeBatch(
    inputs: WordAiInput[],
    p: WenguWordProgress,
    save: () => Promise<unknown>
): Promise<number> {
    const reply = await enqueueAi(() => agentChat(buildPrompt(inputs), defaultAgentModelId(), AI_TIMEOUT.mid));
    const byWord = new Map(inputs.map((e) => [e.w.toLowerCase(), e]));
    const items: { index: number; act: "up" | "keep" | "down"; tip?: string; confused?: string }[] = [];
    for (const it of parseReply(reply)) {
        const hit = byWord.get(it.word.trim().toLowerCase());
        if (!hit) continue;
        items.push({ index: hit.index, act: it.act, tip: it.tip, confused: it.confused });
        if (it.confused) addPair(p, hit.index, it.confused, "ai");
    }
    applyAiReview(p, items);
    await save();
    return items.length;
}

/** 多批串行分析（手动/组触发共用）。 */
async function analyzeAll(inputs: WordAiInput[], p: WenguWordProgress, save: () => Promise<unknown>): Promise<number> {
    let done = 0;
    for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
        done += await analyzeBatch(inputs.slice(i, i + BATCH_SIZE), p, save);
    }
    return done;
}

function buildPrompt(inputs: WordAiInput[]): string {
    const list = inputs
        .map((e, i) => {
            const parts = [`${i + 1}. ${e.w}（${e.m.split("\n")[0]}）`];
            if (e.correct !== undefined) parts.push(e.correct ? "答对" : "答错");
            if (e.count > 0) parts.push(`累计答错 ${e.count} 次`);
            if (e.mode && e.ms !== undefined) {
                parts.push(`${e.mode} 有效用时 ${(e.ms / 1000).toFixed(1)} 秒${e.over ? "（超时）" : ""}`);
            }
            if (e.typed) parts.push(`拼成了「${e.typed}」`);
            if (e.confused) parts.push(`学生自述认成了：${e.confused}`);
            return parts.join("，");
        })
        .join("\n");
    return `你是考研单词复习教练。下面是学生的作答数据，请逐词判断掌握程度并安排复习。
判定规则（严格执行）：
- 秒答且答对 → L: up
- 答对但用时偏长或超时 → L: keep（不升档）
- 答错、超时、或把该词认成了别的词 → L: down
- 学生拼成了另一个真词、或自述认成了某词（可能是模糊描述，推断成最可能的英文单词）→ C: 写出那个词
输出格式：每个词一组行，组间空行，除此之外不要输出任何文字：
W: 单词原样
L: up、keep 或 down
C: 混淆对象单词（仅存在时输出）
T: 辨析提示（仅 C 词输出：那个词的中文意思 + 一句话区别，不超过 60 个字）
单词列表：
${list}`;
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

    constructor(private readonly t: (k: string) => string) {}

    /** 手动分析的待办（误认本中无 note 的词，限当前书）。 */
    pending(p: WenguWordProgress): WordAiInput[] {
        const out: WordAiInput[] = [];
        for (const key of Object.keys(p.mistakes)) {
            const m = p.mistakes[key];
            if (m.note) continue;
            const i = keyIndex(key);
            const entry = i === undefined ? undefined : wordLib().curBook().words[i];
            if (entry) {
                out.push({ index: i, w: entry.w, m: entry.m, count: m.count, confused: m.confused });
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
            const n = await analyzeAll(pending, p, save);
            this.msg =
                n > 0 ? fmt(this.t("wordAiDone"), { n: String(n) }) : this.t("wordAiFailed") + this.t("wordAiBadReply");
            onApplied();
        } catch (e) {
            this.msg = "!" + this.t("wordAiFailed") + String((e as Error)?.message ?? e).slice(0, 120);
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
            await analyzeAll(inputs, p, save);
            onDirty();
        } catch (e) {
            this.msg = "!" + this.t("wordAiFailed") + String((e as Error)?.message ?? e).slice(0, 120);
        }
    }
}
