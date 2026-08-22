import {
    agentChat,
    defaultAgentModelId,
} from "./AgentClient";
import {svgIcon} from "./FormHtml";
import {
    esc,
    fmt,
} from "./ui";
import WORD_BOOK from "./WordBook";
import {
    applyAiPlan,
    type WenguWordProgress,
} from "./WordStore";

/**
 * 误认词 AI 分析（WordStore 的 mistakes → 智能体 → 记忆提示 + 复习间隔）。
 *
 * 走 AgentClient 同一智能体端点；与 AiJudge 一样过串行队列——内核侧
 * 并发请求会互相吞响应（真机坑）。每批 ≤20 词，多批顺序执行。
 */

/** 单次分析调用的超时（毫秒）。 */
const ANALYZE_TIMEOUT_MS = 180_000;
/** 单批词数上限（提示词长度与返回稳定性折中）。 */
const BATCH_SIZE = 20;

/** 串行队列：同一时刻只放一个 AI 调用进内核。 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job);
    queue = run.then((): void => undefined, (): void => undefined);
    return run;
}

/** 待分析的误认词（词条信息 + 答错次数）。 */
export interface WordAiInput {
    index: number;
    w: string;
    m: string;
    count: number;
}

/** AI 分析结果：记忆提示 + 建议几天后复习。 */
export interface WordAiItem {
    index: number;
    tip: string;
    days: number;
}

/** 分析全部待分析误认词（无 note 的），多批串行。 */
export async function analyzeMistakes(inputs: WordAiInput[], modelId: string): Promise<WordAiItem[]> {
    const out: WordAiItem[] = [];
    for (let i = 0; i < inputs.length; i += BATCH_SIZE) {
        const batch = inputs.slice(i, i + BATCH_SIZE);
        const items = await enqueue(() =>
            agentChat(buildPrompt(batch), modelId, ANALYZE_TIMEOUT_MS)
                .then(reply => parseReply(reply, batch))
        );
        out.push(...items);
    }
    return out;
}

function buildPrompt(batch: WordAiInput[]): string {
    const list = batch.map((e, i) => `${i + 1}. ${e.w}（${e.m.split("\n")[0]}）— 答错 ${e.count} 次`).join("\n");
    return `你是考研单词复习教练。学生在背单词时反复答错下面这些词，请逐词给出记忆帮助和复习安排。
对每个词按顺序输出三行，除此之外不要输出任何文字：
W: 单词原样
T: 记忆提示（混淆点/词根词缀/联想，不超过 40 个字）
D: 建议几天后再次复习（1-30 的整数；答错次数越多、词越难则天数越短）
单词列表：
${list}`;
}

/** 从回复中解析 W/T/D 三行块，按词对回下标；未按格式的词跳过。 */
function parseReply(reply: string, batch: WordAiInput[]): WordAiItem[] {
    const out: WordAiItem[] = [];
    const re = /W\s*[:：]\s*(.+?)\s*\n+\s*T\s*[:：]\s*(.+?)\s*\n+\s*D\s*[:：]\s*(\d{1,2})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(reply)) !== null) {
        const word = m[1].trim().toLowerCase();
        const hit = batch.find(e => e.w.toLowerCase() === word);
        if (!hit) continue;
        out.push({index: hit.index, tip: m[2].trim(), days: parseInt(m[3], 10) || 3});
    }
    return out;
}

/* ── 视图接线
/** 误认词 AI 的视图胶水：pending 计数、按钮/消息渲染、一次分析的运行。 */
export class WordAiRunner {
    running = false;
    msg = "";

    constructor(private readonly t: (k: string) => string) {}

    pending(p: WenguWordProgress): WordAiInput[] {
        const out: WordAiInput[] = [];
        for (const key of Object.keys(p.mistakes)) {
            const m = p.mistakes[key];
            if (m.note) continue;
            const entry = WORD_BOOK.words[Number(key)];
            if (entry) out.push({index: Number(key), w: entry.w, m: entry.m, count: m.count});
        }
        return out;
    }

    buttonHtml(p: WenguWordProgress): string {
        const n = this.pending(p).length;
        const title = this.running ?
            this.t("wordAiRunning") :
            n > 0 ?
            fmt(this.t("wordAiPending"), {n: String(n)}) :
            this.t("wordAiNone");
        return `<button class="b3-button b3-button--icon${
            n === 0 && !this.running ? " fn__none" : ""
        }" data-act="aianalyze" title="${esc(title)}"${this.running ? " disabled" : ""}>${
            svgIcon("iconSparkles")
        }</button>`;
    }

    msgHtml(): string {
        if (!this.running && !this.msg) return "";
        const text = this.running ? this.t("wordAiRunning") : this.msg;
        const err = this.msg && !this.running && this.msg.startsWith("!") ? " wengu-word-ai-err" : "";
        return `<div class="wengu-word-aimsg${err}">${esc(text.replace(/^!/, ""))}</div>`;
    }

    /** 跑一次分析：写进度(onApplied 前已 save)、结果回填由调用方 repaint。 */
    async run(
        p: WenguWordProgress,
        save: () => Promise<unknown>,
        onApplied: () => void,
        repaint: () => void,
    ): Promise<void> {
        if (this.running) return;
        const pending = this.pending(p);
        if (pending.length === 0) {
            this.msg = this.t("wordAiNone");
            repaint();
            return;
        }
        this.running = true;
        this.msg = "";
        repaint();
        try {
            const items = await analyzeMistakes(pending, defaultAgentModelId());
            applyAiPlan(p, items);
            await save();
            this.msg = items.length > 0 ?
                fmt(this.t("wordAiDone"), {n: String(items.length)}) :
                this.t("wordAiFailed") + this.t("wordAiBadReply");
            onApplied();
        } catch (e) {
            this.msg = "!" + this.t("wordAiFailed") + String((e as Error)?.message ?? e).slice(0, 120);
        }
        this.running = false;
        repaint();
    }
}
