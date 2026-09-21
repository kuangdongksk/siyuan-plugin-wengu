/**
 * 切片预筛「值不值得出题」（Issue #186，规划稿 A2）：在**花钱的生成式出题
 * 调用之前**，用便宜的类型化判定先问一句「这段有可出题的知识内容吗」。
 *
 * 现状问题（规划稿 §三 A2）：切块后唯一被跳过的是纯标题块；引言、导读、
 * 章末小结、纯代码示例全都会烧一次生成式 AI，然后回一句「无可转内容」——
 * 钱花了，题没有。
 *
 * 三条硬口径（规划稿 §二 纪律 1/2/3，与 #184 质检同款）：
 *  - **只决定跳不跳**：切片本体、`srcKey`、`questionHash` 一概不动
 *    （结构决定权永远在代码，冻结清单不碰）；
 *  - **失败/低置信回落现状**：无 key（调用方判 `isJevEnabled`）、抛错、
 *    响应形状不对、阈值不确定，一律**一个都不跳**（= 改造前行为）；
 *  - **判定不落盘**：结果只挂在这次运行的返回值上（现算现用，重跑重判无害）。
 *
 * 阈值集中在 `policy.ts` 的 `screenShouldSkip`（保守：noul 明确为否 **且**
 * score 明确低且置信足够才跳）——本模块不自造数字。
 *
 * 一次请求问完一片（纪律 5）：`state` 是编号的切片清单，每片两项问题
 * （noul + score）作为同一批独立问题发出去，**不逐片发请求**。
 *
 * 本模块是**纯判定层**：不 import convert 域类型（输入的 `{key, text}`
 * 结构等价即可），故可直测；是否启用由调用方判。
 */
import { judgeJev, type JevAnswer, type JevQuestion } from "./client";
import { screenShouldSkip } from "./policy";
import type { JevTransportFn } from "./transport";

/* ── 输入形状 ── */

/** 待筛的一片（`key` 只用于回填定位，判定只看 `text`）。 */
export interface ScreenItem {
    key: string;
    text: string;
}

/* ── 单批的字符预算 ── */

/**
 * 单个请求的 `state` 字符预算：切片以窗口为单位（一片可能几千字），
 * 攒批时按它断开——**一次请求问完一个批**，不是一个请求塞下整篇文档
 * （判定模型对超长 state 的答案质量会掉，且失败面更大）。
 */
export const SCREEN_BATCH_CHARS = 6000;

/* ── 判定结果 ── */

/** 一片的预筛结论（`judged` 为假＝这一片没判定成功，调用方必须**不跳**）。 */
export interface ScreenVerdict {
    key: string;
    /** 判定成功（拿到了可用的两项答案）。 */
    judged: boolean;
    /** 建议跳过（进生成 AI 之前拦下）。 */
    skip: boolean;
}

/** 一次预筛的合计（内存态，不落盘）。 */
export interface ScreenOutcome {
    /** 逐片结论（顺序与入参一致）。 */
    verdicts: ScreenVerdict[];
    /** 判定成功的片数（含**不跳**的片）——与 `skipped` 分账，别合成一个。 */
    checked: number;
    /** 判定成功且建议跳过的片数（0 = 零跳过，调用方零行为变化）。 */
    skipped: number;
}

/** 「一片都不跳」的空结果（判定关闭/失败时的统一形态）。 */
function noSkip(items: ScreenItem[]): ScreenOutcome {
    return { verdicts: items.map((it) => ({ key: it.key, judged: false, skip: false })), checked: 0, skipped: 0 };
}

/* ── 问题（**一次请求**发出去） ── */

/**
 * 单片的两项问题（noul + score）。同片两问在**同一请求**里（纪律 5）。
 *
 * ⚠️ 两处措辞别当普通文案改：
 *  - 「可出题的知识内容」必须点明「可被考查」——只说「有内容」会把纯代码
 *    示例、目录页也判成有价值；
 *  - score 的档位描述必须**写死具体情形**（模型按情形对齐，抽象档位漂移大）。
 */
export function screenQuestions(): JevQuestion[] {
    return [
        {
            kind: "noul",
            question:
                "这段内容是否包含可被考查的知识内容？即：其中有可据以出题的知识点、定义、结论、" +
                "例题或可问答的事实；纯粹的目录、导言、致谢、版面装饰、与内容无关的代码示例不算。",
        },
        {
            kind: "score",
            question: "这段内容作为出题材料的总价值如何？",
            legend: {
                "1": "无价值：目录、导读、致谢、纯排版或纯代码示例，出不了有意义的题",
                "2": "价值低：只有零散事实或泛泛的铺垫，勉强能凑出简单题",
                "3": "一般：有可考查内容，但密度或清晰度普通",
                "4": "还好：知识点清楚，可出多道有依据的题",
                "5": "很好：定义、结论、例题密集，是可出题的核心内容",
            },
        },
    ];
}

/**
 * 批的 `state`：编号切片清单（序号与答案位序对应）。
 * 每片前带 `【第 i 片】` 标记，让模型的判定能落到具体一片上。
 */
export function buildScreenState(items: ScreenItem[]): string {
    // 空白片先剔（它们也不该占答案位序——调用方按同一 `usable` 过滤）
    const usable = items.filter((it) => it.text.trim().length > 0);
    return usable.map((it, i) => `【第 ${i + 1} 片】\n${it.text.trim()}`).join("\n\n");
}

/**
 * 响应可用性：每片**恰好**两项答案（noul + score），且值是真数。
 *
 * ⚠️ 与 #184 同款：**不能只看 `kind`**（`client.parseAnswer` 按问题类型建壳，
 * 壳的类型恒等于问题类型），必须**看值**——缺值即「上游回了壳没回值」，
 * 整批弃掉（宁可漏筛，不误杀）。
 */
function answersUsable(answers: JevAnswer[], n: number): boolean {
    if (answers.length !== n * 2) return false;
    for (let i = 0; i < n; i++) {
        const a = answers[i * 2] as { kind: string; noul?: number };
        const s = answers[i * 2 + 1] as { kind: string; score?: number };
        if (a.kind !== "noul" || !Number.isFinite(a.noul)) return false;
        if (s.kind !== "score" || !Number.isFinite(s.score)) return false;
    }
    return true;
}

/* ── 主入口 ── */

/** 预筛的入参（`apiKey` 空 = 未配置，直接「一个都不跳」）。 */
export interface ScreenOpts {
    apiKey?: string;
    /** 传输注入（单测 mock；缺省走内核 forwardProxy）。 */
    transport?: JevTransportFn;
    /** 退避等待注入（单测避免真睡）。 */
    sleep?: (ms: number) => Promise<void>;
}

/** 按字符预算把切片切成批（顺序不变、连续覆盖）。 */
export function planScreenBatches(items: ScreenItem[], budget = SCREEN_BATCH_CHARS): ScreenItem[][] {
    const out: ScreenItem[][] = [];
    let cur: ScreenItem[] = [];
    let used = 0;
    for (const it of items) {
        const len = it.text.trim().length;
        // 单片就超预算：自成一批（不切文本——切片本体是冻结面）
        if (cur.length > 0 && used + len > budget) {
            out.push(cur);
            cur = [];
            used = 0;
        }
        cur.push(it);
        used += len;
    }
    if (cur.length > 0) out.push(cur);
    return out;
}

/**
 * 预筛一批切片（**一次请求问完一批**）。
 *
 * 返回空结果的情形（一律「回落现状」= 一个都不跳，不抛错、不弹窗）：
 *  - 无 key / 无切片（没东西可筛）；
 *  - `judgeJev` 抛错（key 问题、退避后仍限流、网络、协议错）——调用方
 *    不必 try/catch；
 *  - 响应缺值：按位取值会读到 `NaN`，静默落进「不跳」还算是保守，但若
 *    误读成「跳」就是误杀——故整批弃掉（宁可漏筛不误杀）。
 *
 * ⚠️ **结论一律按入参位序落位**（`verdicts[i]` 就是 `items[i]` 的结论），
 * **不许按 `key` 归并回填**：两个调用点都传**空 key**（增量链整批
 * `key: ""`、`ScreenAcc` 单片也是 `""`），按 key 归并会把「空白片的未判定」
 * 与「真判定的跳过」错配到**别的片**上——表现为「报告说跳了 1 片，实际跳
 * 的是另一片（真没料的片照样烧生成调用）」，本落点的省钱目的静默失效。
 * 片内「非空片 ↔ 答案位序」的映射同样按**片内下标**走，不靠重新排序还原。
 */
export async function screenChunks(items: ScreenItem[], opts: ScreenOpts): Promise<ScreenOutcome> {
    const key = (opts.apiKey ?? "").trim();
    if (!key || items.length === 0) return noSkip(items);
    // 逐片结论按位序预置（默认「未判定、不跳」），判成的片就地改写
    const verdicts: ScreenVerdict[] = items.map((it) => ({ key: it.key, judged: false, skip: false }));
    let checked = 0;
    let skipped = 0;
    /** 当前批在 `items` 里的起点：`planScreenBatches` 的批**连续覆盖**入参，
     *  故按批长累加即得位序（不查 key，见上）。 */
    let offset = 0;
    for (const batch of planScreenBatches(items)) {
        const start = offset;
        offset += batch.length;
        const usable = batch.filter((it) => it.text.trim().length > 0);
        if (usable.length === 0) continue; // 整批空白：全批维持「未判定、不跳」
        let answers: JevAnswer[];
        try {
            answers = await judgeJev({
                state: buildScreenState(usable),
                questions: usable.flatMap(() => screenQuestions()),
                apiKey: key,
                ...(opts.transport ? { transport: opts.transport } : {}),
                ...(opts.sleep ? { sleep: opts.sleep } : {}),
            });
        } catch (_) {
            continue; // 判定失败 = 本批一个都不跳（不阻塞转换主流程）
        }
        if (!answersUsable(answers, usable.length)) continue; // 缺值 = 本批一律不跳
        // 片内位序映射：批内第 j 个**非空**片对应答案第 j 组（空白片不入
        // state、不占答案位序），落位到 items 的 `start + 批内下标`
        let j = 0;
        batch.forEach((it, bi) => {
            if (it.text.trim().length === 0) return;
            const a = answers[j * 2] as { noul?: number };
            const sc = answers[j * 2 + 1] as { score?: number; confidence?: number };
            j++;
            // 阈值口径只在 policy 的 screenShouldSkip 里（本模块不自造数字）
            const skip = screenShouldSkip(a.noul, sc.score, sc.confidence);
            checked++;
            if (skip) skipped++;
            verdicts[start + bi] = { key: it.key, judged: true, skip };
        });
    }
    return { verdicts, checked, skipped };
}
