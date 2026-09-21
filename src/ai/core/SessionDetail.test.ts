import { describe, expect, it } from "vitest";
import type { AiSessionRecord } from "../data/AiSessions";
import { AI_INTERRUPTED, AI_STOPPED } from "../data/AiSessions";
import {
    canExpandRow,
    clockOf,
    copyPartsOf,
    detailViewOf,
    isRowOpen,
    joinCopyParts,
    questionCountOf,
    type SessionLogSeg,
} from "./SessionDetail";
import { buildSessionTree } from "./SessionTree";
import zhDict from "../../i18n/zh-CN.json";
import enDict from "../../i18n/en.json";

/**
 * 详情三段视图（Issue #88）：详情头（任务名 + kind 徽标 + 状态徽标）、
 * 轮次日志（时间戳 + 摘要，数字走 `<em>` 段）、归属备注 / 重试钮。
 * Issue #98 起行展开态按侧别分块（`segments` = 输入 / 输出两块，标签
 * 取词在 core 侧）——摘要行本身不动，仍是一行一轮的 S6 形态。
 * 展开态的**开合判据也在 core 侧**（`canExpandRow` / `isRowOpen`）：组件
 * 自持的 $state 挂不进 vitest，「默认展开」落在组件里就没有回归锁。
 * 断言落在**渲染侧真吃的字段**上。
 */

/** 取词替身：给出带占位符的真实模板（键名直出的话 fmt 无从填空，
 *  断言只能落在键名上、锁不住「填的是这几个数」）。 */
const TEMPLATES: Record<string, string> = {
    aiStatusRunning: "running",
    aiStatusDone: "done",
    aiStatusError: "error",
    aiLogTurnIn: "轮次 {n} · 输入 {x} 字",
    aiLogTurnInOut: "轮次 {n} · 输入 {x} 字 → 输出 {y} 字",
    aiLogTurnInOutQ: "轮次 {n} · 输入 {x} 字 → 输出 {q} 题",
    aiLogTurnOut: "输出 {y} 字",
    aiLogIn: "输入",
    aiLogOut: "输出",
    aiLogLabel: "轮次日志",
    aiInterrupted: "已中断（插件重载）",
    aiStatusStopped: "已停止",
    aiLogStopped: "收到整批停止指令 · 已产出部分保留待抉择",
    aiSending: "思考中…",
    aiWaitingSlot: "等待空闲通道…",
    aiWaitingSlotX: "",
};
const t = (k: string): string => TEMPLATES[k] ?? k;

function rec(over: Partial<AiSessionRecord> = {}): AiSessionRecord {
    return {
        id: "s1",
        kind: "convert",
        title: "转换 · 卷名",
        model: "m1",
        createdAt: new Date(2026, 8, 14, 14, 22, 7).getTime(),
        status: "running",
        turns: [{ role: "user", text: "abc" }],
        ...over,
    };
}

const base = {
    t,
    kindText: "转换",
    title: "生成第 12 批 · 8 题",
    modelText: "默认模型",
    ownNote: [] as SessionLogSeg[],
    decidable: false,
};

describe("详情头", () => {
    it("任务名（树里那份行名）+ kind 徽标 + 状态徽标（与树叶子行同一份判定）", () => {
        const v = detailViewOf(rec(), base)!;
        expect(v.head.title).toBe("生成第 12 批 · 8 题");
        expect(v.head.kindText).toBe("转换");
        expect(v.head.status).toMatchObject({ dotCls: "run", badgeText: "running", spin: true });
        // gap-list S7：稿内无「时间 · 模型」meta 串，模型名折进 h3 的 title
        expect(v.head.modelText).toBe("默认模型");
        expect(v.head).not.toHaveProperty("meta");
    });

    it("任务名缺位时回落记录 title（存量记录/直连调用不留空标题）", () => {
        const v = detailViewOf(rec(), { ...base, title: "" })!;
        expect(v.head.title).toBe("转换 · 卷名");
    });

    it("无选中记录 → undefined（右栏出空态提示）", () => {
        expect(detailViewOf(undefined, base)).toBeUndefined();
    });
});

describe("轮次日志", () => {
    it("user+ai 成对合并成一行「轮次 N · 输入 X 字 → 输出 Y 题」（gap-list S6）", () => {
        const v = detailViewOf(
            rec({
                turns: [
                    { role: "user", text: "abcd" },
                    { role: "ai", text: "@@Q 一\n@@Q 二\n" },
                ],
            }),
            base
        )!;
        expect(v.rows).toHaveLength(1);
        expect(v.rows[0].parts).toEqual([
            { text: "轮次 ", em: false },
            { text: "1", em: true },
            { text: " · 输入 ", em: false },
            { text: "4", em: true },
            { text: " 字 → 输出 ", em: false },
            { text: "2", em: true },
            { text: " 题", em: false },
        ]);
    });

    it("多轮按序编号（轮次 1 / 2…），每轮一行", () => {
        const v = detailViewOf(
            rec({
                turns: [
                    { role: "user", text: "a" },
                    { role: "ai", text: "b" },
                    { role: "user", text: "cc" },
                    { role: "ai", text: "dd" },
                ],
            }),
            base
        )!;
        expect(v.rows).toHaveLength(2);
        expect(v.rows[0].parts[1]).toEqual({ text: "1", em: true });
        expect(v.rows[1].parts[1]).toEqual({ text: "2", em: true });
    });

    it("数不出题数只报字数（设计稿那串数字是 mock，硬凑会写错的数）", () => {
        const v = detailViewOf(
            rec({
                turns: [
                    { role: "user", text: "q" },
                    { role: "ai", text: "随便一段话" },
                ],
            }),
            base
        )!;
        expect(v.rows[0].parts).toEqual([
            { text: "轮次 ", em: false },
            { text: "1", em: true },
            { text: " · 输入 ", em: false },
            { text: "1", em: true },
            { text: " 字 → 输出 ", em: false },
            { text: "5", em: true },
            { text: " 字", em: false },
        ]);
    });

    it("未配对的尾轮退化成单侧行（单轮失败记录/进行中不丢内容）", () => {
        const v = detailViewOf(rec({ turns: [{ role: "user", text: "abcd" }] }), base)!;
        expect(v.rows).toHaveLength(1);
        expect(v.rows[0].parts).toEqual([
            { text: "轮次 ", em: false },
            { text: "1", em: true },
            { text: " · 输入 ", em: false },
            { text: "4", em: true },
            { text: " 字", em: false },
        ]);
    });

    it("孤立 ai 轮也出内容行（非常规形态不静默丢正文）", () => {
        const v = detailViewOf(rec({ turns: [{ role: "ai", text: "abc" }] }), base)!;
        expect(v.rows[0].parts).toEqual([
            { text: "输出 ", em: false },
            { text: "3", em: true },
            { text: " 字", em: false },
        ]);
    });

    it("时间锚只取真实可推的两点：合并行取收口时刻、未收口回落登记时刻", () => {
        // 未收口（running）无 endedAt ⇒ 各行的锚都回落 createdAt（只有起点
        // 是真的）；登记簿没有单轮时间，**不按窗口均分编造中间时刻**。
        const v = detailViewOf(
            rec({
                turns: [
                    { role: "user", text: "a" },
                    { role: "ai", text: "b" },
                    { role: "user", text: "c" },
                    { role: "ai", text: "d" },
                ],
            }),
            base
        )!;
        expect(v.rows[0].time).toBe("14:22:07");
        expect(v.rows[1].time).toBe("14:22:07");
    });

    it("每行带回本轮两侧全文（设计稿日志是摘要，面板的核心用途是回看产出）", () => {
        const v = detailViewOf(
            rec({
                turns: [
                    { role: "user", text: "abcdef" },
                    { role: "ai", text: "回复" },
                ],
            }),
            base
        )!;
        expect(v.rows[0].full).toBe("abcdef\n\n回复");
        expect(detailViewOf(rec({ turns: [{ role: "user", text: "abcdef" }] }), base)!.rows[0].full).toBe("abcdef");
    });

    it("展开态的正文按侧别分块（Issue #98）：输入块 + 输出块，标签在纯逻辑侧取词", () => {
        const v = detailViewOf(
            rec({
                turns: [
                    { role: "user", text: "abcdef" },
                    { role: "ai", text: "回复" },
                ],
            }),
            base
        )!;
        expect(v.rows[0].segments).toEqual([
            { side: "user", label: "输入", text: "abcdef", copyText: "abcdef" },
            { side: "ai", label: "输出", text: "回复", copyText: "回复" },
        ]);
    });

    it("缺侧的尾轮只出一块（单侧行不分块凑数）；不可展开的状态行没有块", () => {
        // 只有 user 侧：输入一块
        const tail = detailViewOf(rec({ turns: [{ role: "user", text: "abcd" }] }), base)!;
        expect(tail.rows[0].segments).toEqual([{ side: "user", label: "输入", text: "abcd", copyText: "abcd" }]);
        // 孤立 ai 轮：输出一块
        const lone = detailViewOf(rec({ turns: [{ role: "ai", text: "abc" }] }), base)!;
        expect(lone.rows[0].segments).toEqual([{ side: "ai", label: "输出", text: "abc", copyText: "abc" }]);
        // 收口的状态行（末行）无正文 ⇒ 无块，与 full 为空串同义（组件据此不出可展开手势）
        const err = detailViewOf(rec({ status: "error", error: "超时", turns: [{ role: "user", text: "q" }] }), base)!;
        expect(err.rows.at(-1)).toMatchObject({ full: "", segments: [], copyParts: [] });
    });

    it("两块文本与摘要行共用同一份轮次数据（分块不另取数，摘要行本身不动）", () => {
        const v = detailViewOf(
            rec({
                turns: [
                    { role: "user", text: "abc" },
                    { role: "ai", text: "@@Q 一\n@@Q 二\n" },
                ],
            }),
            base
        )!;
        // 摘要行仍是 S6 的「一行一轮」（本单不动它）
        expect(v.rows[0].parts.map((x) => x.text).join("")).toBe("轮次 1 · 输入 3 字 → 输出 2 题");
        // 分块正文=两侧原文，标签与侧别一一对应
        expect(v.rows[0].segments.map((x) => `${x.side}:${x.text}`)).toEqual(["user:abc", "ai:@@Q 一\n@@Q 二\n"]);
    });

    it("默认展开（Issue #98）：空「已收起」集合 ⇒ 可展开行全开，不可展开行恒不开", () => {
        const v = detailViewOf(
            rec({
                turns: [
                    { role: "user", text: "a" },
                    { role: "ai", text: "b" },
                ],
            }),
            base
        )!;
        // 默认态：组件持有的「已收起」集合是空的 ⇒ 全部可展开行都展开
        expect(isRowOpen(v.rows[0], {}, 0)).toBe(true);
        // 用户点一下行头 = 只记这一行被收起，其余行不受影响
        expect(isRowOpen(v.rows[0], { 0: true }, 0)).toBe(false);
        // 不可展开的行（收口状态行）恒不展开——与开合状态无关
        const err = detailViewOf(rec({ status: "error", error: "超时", turns: [{ role: "user", text: "q" }] }), base)!;
        expect(canExpandRow(err.rows.at(-1)!)).toBe(false);
        expect(isRowOpen(err.rows.at(-1)!, {}, err.rows.length - 1)).toBe(false);
        expect(isRowOpen(err.rows.at(-1)!, { [err.rows.length - 1]: false }, err.rows.length - 1)).toBe(false);
    });

    it("可展开判据与分块同源：有块才有展开手势（不与 full 另判一遍）", () => {
        const v = detailViewOf(
            rec({
                turns: [
                    { role: "user", text: "a" },
                    { role: "ai", text: "b" },
                ],
            }),
            base
        )!;
        for (const row of v.rows) expect(canExpandRow(row)).toBe(row.segments.length > 0);
        // 分块但 full 为空的行不存在（有块必有文），反之亦然——两条判据同义
        for (const row of v.rows) expect(row.segments.length > 0).toBe(row.full !== "");
    });

    it("error 态把错误正文也摆进日志（日志是过程记录）；done 态不出进行态行", () => {
        const v = detailViewOf(rec({ status: "error", error: "超时", turns: [{ role: "user", text: "q" }] }), base)!;
        expect(v.rows.at(-1)).toMatchObject({ isError: true, parts: [{ text: "超时", em: false }] });
        expect(v.pending).toBe("");
        expect(v.retryable).toBe(true);
    });

    it("未收口（running）无 endedAt：合并行回落登记时刻（只有起点是真的）", () => {
        const v = detailViewOf(
            rec({
                turns: [
                    { role: "user", text: "q" },
                    { role: "ai", text: "a" },
                ],
            }),
            base
        )!;
        expect(v.rows).toHaveLength(1);
        expect(v.rows[0].time).toBe("14:22:07");
    });

    it("已收口：合并行取**收口时刻**（Issue #88 的两点锚不许被本单冲掉）", () => {
        const createdAt = new Date(2026, 8, 14, 14, 22, 7).getTime();
        const endedAt = new Date(2026, 8, 14, 14, 22, 48).getTime();
        const v = detailViewOf(
            rec({
                createdAt,
                endedAt,
                turns: [
                    { role: "user", text: "q" },
                    { role: "ai", text: "a" },
                ],
            }),
            base
        )!;
        expect(v.rows[0].time).toBe("14:22:48");
    });

    it("尾轮未配对（无 ai 侧）：落 user 侧锚=登记时刻，不冒充收口时刻", () => {
        const createdAt = new Date(2026, 8, 14, 14, 22, 7).getTime();
        const endedAt = new Date(2026, 8, 14, 14, 22, 48).getTime();
        const v = detailViewOf(
            rec({
                createdAt,
                endedAt,
                turns: [
                    { role: "user", text: "a" },
                    { role: "ai", text: "b" },
                    { role: "user", text: "c" },
                ],
            }),
            base
        )!;
        expect(v.rows[0].time).toBe("14:22:48");
        expect(v.rows[1].time).toBe("14:22:07");
    });

    it("被停止（AI_STOPPED）：末行是停止词（非红）、出抉择入口、不出重试钮", () => {
        const note: SessionLogSeg[] = [{ text: "本记录随整批转换一起停止…", em: false, bold: true }];
        const v = detailViewOf(rec({ status: "error", error: AI_STOPPED, turns: [{ role: "user", text: "q" }] }), {
            ...base,
            ownNote: note,
            decidable: true, // 宿主按流归属判定（转换族才有保留/丢弃抉择）
        })!;
        expect(v.head.status).toMatchObject({ dotCls: "stop", badgeText: "已停止", spin: false });
        expect(v.rows.at(-1)).toMatchObject({
            isError: false,
            parts: [{ text: "收到整批停止指令 · 已产出部分保留待抉择", em: false }],
        });
        expect(v.decidable).toBe(true);
        expect(v.retryable).toBe(false);
        expect(v.errorText).toBe("");
        // 停止态与在途态**都出**归属备注（前者交代「已随整批停下、抉择在哪」）
        expect(v.ownNote).toBe(note);
    });

    it("抉择入口由宿主判定（本模块不猜）：宿主不给就没有，免死钮", () => {
        const v = detailViewOf(
            rec({ status: "error", error: AI_STOPPED, turns: [{ role: "user", text: "q" }] }),
            base // ownNote=[] 且 decidable=false（如单调用流被中止 / 六批流停下）
        )!;
        expect(v.decidable).toBe(false);
        expect(v.ownNote).toEqual([]);
    });

    it("真失败不出抉择入口、出重试钮（停止态的反面，防两态混同）", () => {
        const v = detailViewOf(rec({ status: "error", error: "超时", turns: [] }), base)!;
        expect(v.decidable).toBe(false);
        expect(v.retryable).toBe(true);
    });

    it("重载中断：不进日志红行、不出重试正文（那是预期收口，不是失败）", () => {
        const v = detailViewOf(
            rec({ status: "error", error: AI_INTERRUPTED, turns: [{ role: "user", text: "q" }] }),
            base
        )!;
        expect(v.rows.at(-1)).toMatchObject({ isError: false, parts: [{ text: "已中断（插件重载）", em: false }] });
        expect(v.errorText).toBe("");
    });
});

/**
 * 跨模块一致性（Issue #88 验收 2/3）：树叶子行与详情头**同源**——两处都取
 * `leafViewOf`，不会各写一套状态词/色名（否则同一条记录左栏说「已停止」
 * 右栏说「失败」）。这条锁死「同源」这个结构事实。
 */
describe("树叶子行与详情头同源", () => {
    it("被停止的记录：两处的色类与状态词逐字一致", () => {
        const stopped = rec({ status: "error", error: AI_STOPPED });
        const tree = buildSessionTree([stopped], "", (k) => k, t);
        const d = detailViewOf(stopped, base)!;
        const leaf = tree.leafViewByKey.get("s1")!;
        expect(d.head.status).toMatchObject({
            dotCls: leaf.dotCls,
            badgeCls: leaf.badgeCls,
            badgeText: leaf.badgeText,
            spin: leaf.spin,
        });
        expect(leaf.dotCls).toBe("stop");
    });
});

describe("三段收口（归属备注 / 进行态 / 重试）", () => {
    it("空脚判据（Issue #98）：done 且非重试态下 ownNote 空 + retryable 假 ⇒ 组件不出 dfoot", () => {
        // 组件按 `ownNote.length > 0 || retryable` 决定 dfoot 是否渲染（空容器
        // 在已完成态就是「下方空一块」），故这里锁这两个字段。
        const done = detailViewOf(rec({ status: "done", turns: [{ role: "user", text: "q" }] }), base)!;
        expect(done.ownNote).toEqual([]);
        expect(done.retryable).toBe(false);
        // 反面：在途态有归属备注（出头栏）、真失败有重试钮（出头栏）
        expect(detailViewOf(rec(), { ...base, ownNote: [{ text: "n", em: false }] })!.ownNote).toHaveLength(1);
        expect(detailViewOf(rec({ status: "error", error: "超时" }), base)!.retryable).toBe(true);
        // #201：jev 记录不出重试钮（重试通道是生成式专属），错误正文照旧可读
        const jev = detailViewOf(rec({ kind: "jev", status: "error", error: "auth (401)" }), base)!;
        expect(jev).toMatchObject({ retryable: false, decidable: false, errorText: "auth (401)" });
    });

    it("running：等槽态出「等待空闲通道」，否则出「思考中」", () => {
        expect(detailViewOf(rec(), base)!.pending).toBe("思考中…");
        expect(detailViewOf(rec({ queued: true } as never), base)!.pending).toBe("等待空闲通道…");
    });

    it("归属备注在在途与被停止两态都出（宿主给的分段，本模块不算归属）", () => {
        const note = [{ text: "本记录属于整批转换", em: false, bold: true }];
        expect(detailViewOf(rec(), { ...base, ownNote: note })!.ownNote).toBe(note);
        expect(detailViewOf(rec({ status: "error", error: AI_STOPPED }), { ...base, ownNote: note })!.ownNote).toBe(
            note
        );
        expect(detailViewOf(rec({ status: "done" }), { ...base, ownNote: note })!.ownNote).toEqual([]);
        // 真失败走 errorText，不出归属备注
        expect(detailViewOf(rec({ status: "error", error: "超时" }), { ...base, ownNote: note })!.ownNote).toEqual([]);
    });
});

/**
 * 一键复制的正文口径（Issue #124 验收 1/2）：复制吃的是**原文**，不是渲染
 * 后的 HTML——粘贴回来必须与源串逐字一致（公式、缩进、换行都在）。
 */
describe("复制正文", () => {
    const pairTurns = [
        { role: "user" as const, text: "算一算：$x^2+1$\n第二行\n" },
        { role: "ai" as const, text: "@@Q 一\n@@Q 二\n\n结束" },
    ];

    it("块级复制正文与源串逐字一致（公式与正文内部换行都不动）", () => {
        const v = detailViewOf(rec({ turns: pairTurns }), base)!;
        // 逐字：公式 `$x^2+1$`、正文内部换行一律保留
        expect(v.rows[0].segments[0].copyText).toBe("算一算：$x^2+1$\n第二行");
        expect(v.rows[0].segments[1].copyText).toBe("@@Q 一\n@@Q 二\n\n结束");
    });

    it("整轮复制 = 各块原文按输入/输出序拼接、块间空行分隔", () => {
        const v = detailViewOf(rec({ turns: pairTurns }), base)!;
        expect(joinCopyParts(v.rows[0].copyParts)).toBe("算一算：$x^2+1$\n第二行\n\n@@Q 一\n@@Q 二\n\n结束");
    });

    it("块尾空行归一：源串尾部的空行不进复制结果（块级与整轮同口径）", () => {
        const v = detailViewOf(
            rec({
                turns: [
                    { role: "user", text: "a\n\n\n" },
                    { role: "ai", text: "b\n" },
                ],
            }),
            base
        )!;
        expect(v.rows[0].segments.map((x) => x.copyText)).toEqual(["a", "b"]);
        expect(joinCopyParts(v.rows[0].copyParts)).toBe("a\n\nb");
    });

    it("整轮与逐块同源（结合律）：复制整轮 == 逐块复制再按同样分隔拼起来", () => {
        // 「整轮」不是另写一套拼接：`copyParts` 恒等于各块复制正文的数组
        const v = detailViewOf(rec({ turns: pairTurns }), base)!;
        const perBlock = v.rows[0].segments.map((x) => x.copyText);
        expect(v.rows[0].copyParts).toEqual(perBlock);
        expect(joinCopyParts(v.rows[0].copyParts)).toBe(joinCopyParts(perBlock));
    });

    it("缺侧的尾轮：整轮 == 那一块（单块不凑数）", () => {
        const v = detailViewOf(rec({ turns: [{ role: "user", text: "只有一个输入" }] }), base)!;
        expect(v.rows[0].copyParts).toEqual(["只有一个输入"]);
        expect(joinCopyParts(v.rows[0].copyParts)).toBe("只有一个输入");
    });

    it("状态行（收口/错误行）无正文 ⇒ 无复制（与 segments 同判据）", () => {
        const v = detailViewOf(rec({ status: "error", error: "超时", turns: [{ role: "user", text: "q" }] }), base)!;
        expect(v.rows.at(-1)).toMatchObject({ segments: [], copyParts: [] });
        expect(joinCopyParts(v.rows.at(-1)!.copyParts)).toBe("");
    });

    it("copyPartsOf：不 trim、行尾 CR 归一、块尾空行折叠（多次拼接自稳定）", () => {
        // 不 trim：缩进与尾随空格都是原文
        expect(copyPartsOf(["  a  "])).toEqual(["  a  "]);
        // 行尾 CR（存储层可能的 CRLF）在复制正文里归一成 LF，不折进粘贴结果
        expect(copyPartsOf(["a\r\n\r\nb\r\n"])).toEqual(["a\n\nb"]);
        // 块尾一串空行折成一个；块**间**的空行保留
        expect(copyPartsOf(["a\n\n\n\n"])).toEqual(["a"]);
        // 幂等：拿结果再跑一遍不变（复制链不会越复制越短）
        const once = copyPartsOf(["a\r\nb\n\n"]);
        expect(copyPartsOf(once)).toEqual(once);
    });

    it("copyPartsOf 保留「存在但为空」的块（空段按空位参与，不静默吞掉）", () => {
        // 只跳过 undefined（该侧不存在）；空串是「有这一块、内容是空的」
        expect(copyPartsOf(["", "b"])).toEqual(["", "b"]);
        expect(joinCopyParts(copyPartsOf(["", "b"]))).toBe("\n\nb");
    });
});

/**
 * i18n 真表锁（Issue #124）：本单新增的取词键必须**真在字典里且非空**。
 *
 * 插件的取词口径是 `i18n[key] || key`（**缺键或空串值都回落键名**）——漏加
 * 一个键，面板上就把字面键名渲染给用户，而用例里的 `t` 替身永远看不出来
 * （替身同样回落键名，段键断言照样全绿）。故这条走**真实中英字典**。
 * 同族锁见 FlowOwnership.test 的幽灵键锁（Issue #93 复审抓到的形态）。
 */
describe("取词键真在字典里（幽灵键锁）", () => {
    const dicts: Record<string, Record<string, string>> = {
        zh: zhDict as Record<string, string>,
        en: enDict as Record<string, string>,
    };
    /** 详情渲染真正会取到的键（含本单新增的四个复制键）。 */
    const asked = [
        "aiLogIn",
        "aiLogOut",
        "aiLogLabel",
        "aiCopyBlock",
        "aiCopyTurn",
        "aiCopied",
        "aiCopyFail",
        "aiLogTurnIn",
        "aiLogTurnInOut",
        "aiLogTurnInOutQ",
        "aiLogTurnOut",
        "aiSending",
        "aiWaitingSlot",
        "aiLogStopped",
        "aiInterrupted",
        "aiStatusRunning",
        "aiStatusDone",
        "aiStatusError",
        "aiStatusStopped",
    ];

    for (const [name, dict] of Object.entries(dicts)) {
        it(`${name}：详情渲染取过的每个键都在字典里且非空`, () => {
            for (const k of asked) expect(dict[k], `${name} 缺键或空值：${k}`).toBeTruthy();
        });
    }

    it("复制相关的四个键中英齐备（新增文案不许只加一侧）", () => {
        // 断言落在真字典上：少加一侧（或键名打错）这条就红
        expect(zhDict.aiCopyBlock).toBeTruthy();
        expect(enDict.aiCopyBlock).toBeTruthy();
        expect(zhDict.aiCopyTurn).toBeTruthy();
        expect(enDict.aiCopyTurn).toBeTruthy();
        expect(zhDict.aiCopied).toBeTruthy();
        expect(enDict.aiCopied).toBeTruthy();
        expect(zhDict.aiCopyFail).toBeTruthy();
        expect(enDict.aiCopyFail).toBeTruthy();
    });

    it("整个详情视图的取词都命中真字典（渲染结果里不得出现键名）", () => {
        for (const dict of Object.values(dicts)) {
            const realT = (k: string): string => {
                const v = dict[k];
                if (!v) throw new Error(`幽灵键：${k}`);
                return v;
            };
            const v = detailViewOf(
                rec({
                    status: "done",
                    endedAt: new Date(2026, 8, 14, 14, 22, 48).getTime(),
                    turns: [
                        { role: "user", text: "q" },
                        { role: "ai", text: "a" },
                    ],
                }),
                { ...base, t: realT }
            )!;
            // 摘要行、块标签、日志标签一律是译文，不是键名
            const texts = [
                v.logLabel,
                ...v.rows.flatMap((r) => [...r.parts.map((x) => x.text), ...r.segments.map((x) => x.label)]),
            ];
            for (const x of texts) expect(x).not.toMatch(/^ai[A-Z]/);
        }
    });
});

describe("纯函数：时间与题数", () => {
    it("clockOf 补零到 HH:MM:SS；questionCountOf 只认行首标记（数不出返 0）", () => {
        expect(clockOf(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe("03:04:05");
        expect(questionCountOf("@@Q 题干\n@@Q 题干2\n")).toBe(2);
        expect(questionCountOf("1. 甲\n2. 乙\n3、丙\n")).toBe(3);
        expect(questionCountOf("不是行首编号的 1.")).toBe(0);
        expect(questionCountOf("")).toBe(0);
    });
});
