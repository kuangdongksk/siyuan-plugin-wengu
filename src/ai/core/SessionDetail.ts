/**
 * 记录详情的**三段视图模型**（Issue #88，纯逻辑带单测）：
 * 设计稿 `design/convert-stop-redesign.html` 的 `.ai-detail` 由
 * `detail-head`（任务名 + kind 徽标 + 状态徽标）、`detail-body`
 * （`log-label` + `ul.log` 轮次日志）、`detail-foot`（`own-note` 归属备注）
 * 三段构成，此处把记录折算成三段各自的渲染数据——组件只按字段渲染。
 *
 * 三条口径：
 *  1. **轮次日志不是原始轮次文本**（设计稿是「时间戳 + 摘要行」，如
 *     「轮次 1 · 输入 <em>3,240 字</em> → 输出 <em>8 题</em>」）。但登记簿
 *     只存 prompt 与回复全文，**没有结构化的字数/题数**——故这里只做
 *     **可确定性推出**的部分：时间戳（记录 createdAt/endedAt 与轮次的
 *     相对位置无法精确到每轮，用记录级时间锚）、角色、按行提炼的规模
 *     后缀（能从文本里数出来的才出，数不出就不编）。宁缺勿错：设计稿
 *     那串数字是 mock，硬凑会把「8 题」写成错的数。
 *  2. **归属备注复用既有 `FlowOwnership`**（Issue #77 的判定），只在
 *     running 的多调用流上出；错误态换错误正文（既有 `wengu-ai-err`）。
 *  3. **详情头的状态徽标与树叶子行同源**（同一个 `SessionLeafView` 的
 *     色类/词），两处不会各写一套状态词。
 */

import type { AiSessionRecord, AiTurn } from "../data/AiSessions";
import { AI_INTERRUPTED } from "../data/AiSessions";
import { leafViewOf, type SessionLeafView } from "./SessionTree";

/** 详情头：任务名 + kind 徽标 + 状态徽标。 */
export interface SessionDetailHead {
    /** 任务名（空则回落记录 title）。 */
    title: string;
    /** kind 徽标文本（已取词，如「转换」）。 */
    kindText: string;
    /** 状态徽标（复用语义与树叶子行**同一份**判定）。 */
    status: SessionLeafView;
    /** 元信息串（时间 · 模型；状态词已由徽标承担，不在串里重复）。 */
    meta: string;
}

/** 摘要行的一段：普通文字或**强调**数字（设计稿 `<em>`）。 */
export interface SessionLogSeg {
    text: string;
    /** true=`<em>` 强调（设计稿把数字加亮：`输入 <em>3,240 字</em>`）。 */
    em: boolean;
}

/** 轮次日志的一行。 */
export interface SessionLogRow {
    /** 时间戳（HH:MM:SS；记录级锚——单轮时间登记簿未存）。 */
    time: string;
    /** 摘要行的**分段**（普通文字/强调交替；组件按段渲染，零字符串解析
     *  ——拆串拼 HTML 有注入面，分段数组没有）。 */
    parts: SessionLogSeg[];
    /** 失败轮的红色标记（错误正文行）。 */
    isError: boolean;
    /** 该轮的**全文**（prompt / 回复原文）：设计稿的日志行是「时间戳 + 摘要」
     *  形态，但面板的核心用途是「回看产出」——全文不能丢，故随行带回、由
     *  组件按需展开（默认收起，行即设计稿形态）。空=不可展开（无正文的
     *  状态行，如错误行）。 */
    full: string;
}

/** 详情三段整体视图（无选中记录时 undefined）。 */
export interface SessionDetailView {
    head: SessionDetailHead;
    /** 轮次日志标签（已取词）。 */
    logLabel: string;
    rows: SessionLogRow[];
    /** 等槽中的进行态行（running 且未收口；空=不出）。 */
    pending: string;
    /** 归属备注（多调用流 running 时非空；错误态不走这里）。 */
    ownNote: string;
    /** 错误正文（error 态；空=不出）。 */
    errorText: string;
    /** 是否出重试钮（error 态）。 */
    retryable: boolean;
}

const p2 = (n: number): string => String(n).padStart(2, "0");

/** HH:MM:SS（设计稿 log 的时间列是秒级 mono）。 */
export function clockOf(ts: number): string {
    const d = new Date(ts);
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

/**
 * 摘要行的规模后缀（**只出数得出来的**）：AI 回复里按题号行数粗略计数
 * ——`@@Q` 标记行（行协议题头，renderUnit 的输入形态）与 `N.`/`N、` 行首
 * 编号都可数；数不出返回空串（不编数字）。prompt 侧数**输入字符数**是
 * 确定性的（就是字符串长度），故「输入 N 字」这一半恒可用。
 */
export function questionCountOf(text: string): number {
    const marks = text.match(/^[ \t]*@@Q\b/gm)?.length ?? 0;
    if (marks > 0) return marks;
    return text.match(/^[ \t]*\d{1,3}[.、)]\s*\S/gm)?.length ?? 0;
}

/** 取词模板按 `{n}` 拆段：命中的那一段进 `<em>`（强调位在**模板**里，
 *  不靠代码猜哪几个字符是数字——中英两套模板的强调位各自由自己表达）。 */
function segsOf(template: string, vars: Record<string, string>): SessionLogSeg[] {
    const out: SessionLogSeg[] = [];
    let rest = template;
    for (;;) {
        const m = /\{(\w+)\}/.exec(rest);
        if (!m) break;
        const before = rest.slice(0, m.index);
        if (before) out.push({ text: before, em: false });
        out.push({ text: vars[m[1]] ?? `{${m[1]}}`, em: true });
        rest = rest.slice(m.index + m[0].length);
    }
    if (rest) out.push({ text: rest, em: false });
    return out;
}

/** 单轮 → 日志行（role 词与规模后缀都走这里，纯函数便于单测）。 */
function rowOf(t: (k: string) => string, turn: AiTurn, anchor: number): SessionLogRow {
    if (turn.role === "user") {
        return {
            time: clockOf(anchor),
            parts: segsOf(t("aiLogInput"), { n: String(turn.text.length) }),
            isError: false,
            full: turn.text,
        };
    }
    // 输出侧：题数**只出数得出来的**（`questionCountOf`），数不出只报字数
    // ——设计稿那串「输出 8 题」是 mock，硬凑会把错的数写进日志。
    const n = questionCountOf(turn.text);
    const key = n > 0 ? "aiLogOutputQ" : "aiLogOutput";
    const vars: Record<string, string> = { n: String(turn.text.length) };
    if (n > 0) vars.q = String(n);
    return {
        time: clockOf(anchor),
        parts: segsOf(t(key), vars),
        isError: false,
        full: turn.text,
    };
}

/**
 * 折算详情三段（见文件头注释）。`ownNote` 由宿主注入（复用 FlowOwnership
 * 的成品串，避免本模块反向依赖流判定）。
 */
export function detailViewOf(
    rec: AiSessionRecord | undefined,
    opts: {
        t: (k: string) => string;
        kindText: string;
        title?: string;
        modelText: string;
        ownNote: string;
    }
): SessionDetailView | undefined {
    if (!rec) return undefined;
    const { t } = opts;
    const leaf = leafViewOf(rec, opts.title ?? "", t);
    const anchor = rec.endedAt ?? rec.createdAt;
    const rows = rec.turns.map((turn) => rowOf(t, turn, rec.createdAt));
    // 失败轮：把错误正文也摆进日志（设计稿停止屏的末行正是
    // 「收到整批停止指令 · …」——日志是**过程**记录，错误同理）
    if (rec.status === "error" && rec.error) {
        const interrupted = rec.error === AI_INTERRUPTED;
        rows.push({
            time: clockOf(anchor),
            parts: [{ text: interrupted ? t("aiInterrupted") : rec.error, em: false }],
            isError: !interrupted,
            full: "",
        });
    }
    return {
        head: {
            title: leaf.name,
            kindText: opts.kindText,
            status: leaf,
            meta: `${clockOf(rec.createdAt)} · ${opts.modelText}`,
        },
        logLabel: t("aiLogLabel"),
        rows,
        pending: rec.status === "running" ? (rec.queued ? t("aiWaitingSlot") : t("aiSending")) : "",
        ownNote: rec.status === "running" ? opts.ownNote : "",
        errorText: rec.status === "error" && rec.error !== AI_INTERRUPTED ? rec.error : "",
        retryable: rec.status === "error",
    };
}
