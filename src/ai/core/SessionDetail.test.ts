import { describe, expect, it } from "vitest";
import type { AiSessionRecord } from "../data/AiSessions";
import { AI_INTERRUPTED, AI_STOPPED } from "../data/AiSessions";
import { clockOf, detailViewOf, questionCountOf, type SessionLogSeg } from "./SessionDetail";
import { buildSessionTree } from "./SessionTree";

/**
 * 详情三段视图（Issue #88）：详情头（任务名 + kind 徽标 + 状态徽标）、
 * 轮次日志（时间戳 + 摘要，数字走 `<em>` 段）、归属备注 / 重试钮。
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

describe("纯函数：时间与题数", () => {
    it("clockOf 补零到 HH:MM:SS", () => {
        expect(clockOf(new Date(2026, 0, 2, 3, 4, 5).getTime())).toBe("03:04:05");
    });

    it("questionCountOf 只认行首标记（@@Q 与 N./N、编号）；数不出返回 0", () => {
        expect(questionCountOf("@@Q 题干\n@@Q 题干2\n")).toBe(2);
        expect(questionCountOf("1. 甲\n2. 乙\n3、丙\n")).toBe(3);
        expect(questionCountOf("这句话里出现 1. 但不是行首编号")).toBe(0);
        expect(questionCountOf("")).toBe(0);
    });
});
