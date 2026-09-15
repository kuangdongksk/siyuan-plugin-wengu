/**
 * 记录详情的**三段视图模型**（Issue #88，纯逻辑带单测）：
 * 设计稿 `design/convert-stop-redesign.html` 的 `.ai-detail` 由
 * `detail-head`（任务名 + kind 徽标 + 状态徽标）、`detail-body`
 * （`log-label` + `ul.log` 轮次日志）、`detail-foot`（`own-note` 归属备注）
 * 三段构成，此处把记录折算成三段各自的渲染数据——组件只按字段渲染。
 *
 * 三条口径：
 *  1. **轮次日志一行 = 一轮**（Issue #92 gap-list S6，spec 6.4 行 1）：
 *     设计稿是「时间戳 + 『轮次 N · 输入 <em>X 字</em> → 输出 <em>Y 题</em>』」
 *     ——把成对的 user + ai 轮**合并成一行**（turns 有序 ⇒ 轮次号可编；
 *     字数是字符串长度、恒可数；题数由 `questionCountOf` 数得出才出）。
 *     未配对的尾轮（单轮失败记录/进行中）退化成「单侧行」：只剩输入或
 *     只剩输出，形态与合并行一致（同一条 i18n 模板的缺项变体）。
 *     设计稿的「校验 N 题，其中 M 题重试」「写入题集」两行是 **mock 专属**
 *     （无结构化数据支撑），不出。宁缺勿错：硬凑会把题数写成错的数。
 *
 *     **时间锚只取「真实可推」的两点**（Issue #88）：user 轮=登记时刻
 *     （`createdAt`，begin 即发出）、ai 轮=收口时刻（`endedAt`）——登记簿
 *     只存记录级 `createdAt`/`endedAt`、**没有单轮时间**，故不按窗口均分
 *     编造中间时刻（编出来的数字看着精确却是假的，同「题数只出数得出来的」
 *     口径）；未收口（running）时 `endedAt` 缺位、回落 `createdAt`，即
 *     「只有起点是真的」的诚实形态。
 *  2. **归属备注复用既有 `FlowOwnership`**（Issue #77 的判定），只在
 *     running 的多调用流上出；错误态换错误正文（既有 `wengu-ai-err`）。
 *  3. **详情头的状态徽标与树叶子行同源**（同一个 `SessionLeafView` 的
 *     色类/词），两处不会各写一套状态词。
 */

import type { AiSessionRecord, AiTurn } from "../data/AiSessions";
import { AI_INTERRUPTED, AI_STOPPED } from "../data/AiSessions";
import { leafViewOf, type SessionLeafView } from "./SessionTree";

/** 详情头：任务名 + kind 徽标 + 状态徽标。 */
export interface SessionDetailHead {
    /** 任务名（空则回落记录 title）。 */
    title: string;
    /** kind 徽标文本（已取词，如「转换」）。 */
    kindText: string;
    /** 状态徽标（复用语义与树叶子行**同一份**判定）。 */
    status: SessionLeafView;
    /** 模型名（**不进常驻视觉位**：设计稿 detail-head 无 meta 串，gap-list
     *  S7 落法是折进 h3 的 `title` 悬停可见）。 */
    modelText: string;
}

/** 摘要行的一段：普通文字或**强调**数字（设计稿 `<em>`）。 */
export interface SessionLogSeg {
    text: string;
    /** true=`<em>` 强调（设计稿把数字加亮：`输入 <em>3,240 字</em>`）。 */
    em: boolean;
    /** gap-list A7 的 `own-note` 首句加粗（`<b>`；log 行不用）。 */
    bold?: boolean;
    /** gap-list A7 的 `own-note` 入口词主色（`.at`；log 行不用）。 */
    accent?: boolean;
}

/** 轮次日志的一行。 */
export interface SessionLogRow {
    /** 时间戳（HH:MM:SS）——**真实可推的两点之一**（user 侧=登记时刻、ai 侧
     *  收口时刻）；单轮时间登记簿未存，故合并行取 ai 侧锚，见文件头口径 1。 */
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
    /** 归属备注的**分段**（多调用流「在途」与「被停止」两态非空；真错误态
     *  不走这里，走 `errorText`）。照 gap-list A7：首句加粗（归属）+ 正文 +
     *  入口词主色强调——文案分段供给，**组件不解析字符串**（同 log 的
     *  `segsOf` 口径）；停止态由宿主按 `FlowOwnership` 给
     *  `aiOwnStopped*` 口径的分段。 */
    ownNote: SessionLogSeg[];
    /** 错误正文（error 态；空=不出）。 */
    errorText: string;
    /** 是否出重试钮（真失败态；被停止的记录不出）。 */
    retryable: boolean;
    /** 是否出「前往页内转换条抉择」入口（**只有「被停止的转换族记录」**）。
     *  由宿主按流归属判定后注入（同 `ownNote` 口径，本模块不反向依赖流逻辑）：
     *  抉择是转换族独有的收口动作，六个批流停下即停下、没有二选一。 */
    decidable: boolean;
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

/**
 * 一轮（user 提示 + 可选 ai 回复）→ **一条**日志行（Issue #92 S6）。
 *
 * 轮次号 `n` 由调用侧按**成对轮序**给（1 起）；`ai` 缺位=尾轮未收（单轮
 * 失败记录/进行中）⇒ 只出「输入」侧。模板按「有几侧」选，取词侧不猜
 * 缺项该不该省——三套模板各自完整表达（中英强调位由模板自己定）。
 *
 * `anchor` = 该轮**真实可推**的时刻锚（见 {@link detailViewOf} 的取法：
 * user 侧=登记时刻、ai 侧=收口时刻）——**不按窗口均分编造中间时刻**：
 * 登记簿没有单轮时间，编出来的数字看着精确却是假的（宁缺勿错口径同
 * 「题数只出数得出来的」）。
 *
 * 失败轮的错误正文行不走这里（单独追加，见 `detailViewOf`）。
 */
function rowOf(
    t: (k: string) => string,
    n: number,
    user: AiTurn,
    ai: AiTurn | undefined,
    anchor: number
): SessionLogRow {
    const vars: Record<string, string> = { n: String(n), x: String(user.text.length) };
    let key = "aiLogTurnIn";
    if (ai) {
        vars.y = String(ai.text.length);
        // 题数**只出数得出来的**（`questionCountOf`），数不出只报字数
        // ——设计稿那串「输出 8 题」是 mock，硬凑会把错的数写进日志。
        const q = questionCountOf(ai.text);
        key = q > 0 ? "aiLogTurnInOutQ" : "aiLogTurnInOut";
        if (q > 0) vars.q = String(q);
    }
    return {
        time: clockOf(anchor),
        parts: segsOf(t(key), vars),
        isError: false,
        // 全文=本轮两侧原文拼接（面板的核心用途是回看产出，全文不能丢）
        full: ai ? `${user.text}\n\n${ai.text}` : user.text,
    };
}

/**
 * turns → 轮次行（user 起头配对；孤立的 ai 轮单独成「只出」一行）。
 *
 * `anchorOf` = 该轮的时刻锚取法（Issue #88：user 侧=登记时刻、ai 侧=收口
 * 时刻）。合并行里**两侧的锚不同**，但一行只有一个时间戳列——取**有 ai
 * 侧就用 ai 侧的锚**（收口时刻更接近「这轮的产出是何时到的」；无 ai 侧
 * 的尾轮用 user 侧锚）。这仍只取「真实可推」的两点，不编造中间时刻。
 */
function rowsOf(t: (k: string) => string, turns: AiTurn[], anchorOf: (side: "user" | "ai") => number): SessionLogRow[] {
    const rows: SessionLogRow[] = [];
    let n = 0;
    for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        if (turn.role === "user") {
            n++;
            const next = turns[i + 1];
            const ai = next && next.role === "ai" ? next : undefined;
            if (ai) i++;
            rows.push(rowOf(t, n, turn, ai, anchorOf(ai ? "ai" : "user")));
        } else if (n === 0) {
            // 首轮就是 ai（非常规形态）：按第 1 轮的输出侧出——不至于丢内容
            n++;
            rows.push({
                time: clockOf(anchorOf("ai")),
                parts: segsOf(t("aiLogTurnOut"), { y: String(turn.text.length) }),
                isError: false,
                full: turn.text,
            });
        } else {
            // 连续 ai 轮（上一次已配对掉一个）：出「追加输出」行，不编新轮号
            rows.push({
                time: clockOf(anchorOf("ai")),
                parts: segsOf(t("aiLogTurnOut"), { y: String(turn.text.length) }),
                isError: false,
                full: turn.text,
            });
        }
    }
    return rows;
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
        /** 归属备注的**分段**（宿主按流归属给；见 {@link SessionDetailView.ownNote}）。 */
        ownNote: SessionLogSeg[];
        /** 是否出抉择入口（宿主按流归属给；见 {@link SessionDetailView.decidable}）。 */
        decidable: boolean;
    }
): SessionDetailView | undefined {
    if (!rec) return undefined;
    const { t } = opts;
    const leaf = leafViewOf(rec, opts.title ?? "", t);
    const anchor = rec.endedAt ?? rec.createdAt;
    // 停止态=error 态里哨兵为 AI_STOPPED 的那条（succeed/retrying 会清
    // error，故非 error 态不会残留该哨兵；显式带上 status 判据防脏盘）
    const stopped = rec.status === "error" && rec.error === AI_STOPPED;
    // 时间锚（只取**真实可推**的两个，见文件头口径 1）：user 轮=登记时刻
    // （begin 即发出，就是 createdAt）；ai 轮=收口时刻（endedAt）。全用
    // createdAt 会让整条时间线恒同一时刻（设计稿是 14:22:07 → 14:22:48
    // 的推进），而未收口（running）时 endedAt 缺位、回落 createdAt 即
    // 「只有起点是真的」的诚实形态。
    const anchorOf = (side: "user" | "ai"): number => (side === "ai" ? anchor : rec.createdAt);
    const rows = rowsOf(t, rec.turns, anchorOf);
    // 末行（收口）：把收口正文也摆进日志——设计稿停止屏的末行正是
    // 「收到整批停止指令 · …」；日志是**过程**记录，错误同理。三种收口
    // 各按其语义：中止=停止词（非红）、重载中断=中断词（非红）、
    // 真失败=错误正文（红）。
    if (rec.status === "error" && rec.error) {
        const text = stopped ? t("aiLogStopped") : rec.error === AI_INTERRUPTED ? t("aiInterrupted") : rec.error;
        rows.push({
            time: clockOf(anchor),
            parts: [{ text, em: false }],
            isError: !stopped && rec.error !== AI_INTERRUPTED,
            full: "",
        });
    }
    return {
        head: {
            title: leaf.name,
            kindText: opts.kindText,
            status: leaf,
            modelText: opts.modelText,
        },
        logLabel: t("aiLogLabel"),
        rows,
        pending: rec.status === "running" ? (rec.queued ? t("aiWaitingSlot") : t("aiSending")) : "",
        // 归属备注在「在途」与「被停止」两态都出：前者指路「要停止去哪」，
        // 后者交代「随整批一起停、抉择入口只有一处」（设计稿 ai-panel-stopped
        // 的 own-note 正是后者）。
        ownNote: rec.status === "running" || stopped ? opts.ownNote : [],
        errorText: rec.status === "error" && !stopped && rec.error !== AI_INTERRUPTED ? rec.error : "",
        // 被停止的记录**不出重试钮**：它是整批流的一部分，单笔重跑会脱离
        // 那条流（设计稿停止屏也没有重试，只有指路抉择的归属备注）。
        retryable: rec.status === "error" && !stopped,
        decidable: opts.decidable,
    };
}
