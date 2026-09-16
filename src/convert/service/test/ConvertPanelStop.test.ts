import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BankData, QuestionBank } from "../../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../../bank/data/QuestionBank";

/**
 * 面板「停止」接线回归（Issue #72）：转换族调 AI 走 makeKnowAwareAi，
 * track 原先只带 {kind,title,group}、**从不传 onSid**——AI 会话面板的中止
 * 登记簿查无该记录 id，点「停止」静默无效（六个既有批流好使，唯独转换族
 * 不行）。
 *
 * 这里跑通编排层（内核 IO 全 mock、题库内存实现），AI 出口替身复刻 client
 * 的登记簿语义（track.onSid 回传记录 id）。断言两条：
 *   ① 每一笔转换 AI 调用都带 onSid（noSid 恒 0，即「面板上每条 running
 *      记录都能被点」）；
 *   ② 点停它 = internal.abort() 的等价停止 → 整条流走既有 aborted 收口
 *      （不是只断当前这一笔 fetch）。
 */

// node 测试环境无 window，题库 markDirty/flush 的防抖定时器走 globalThis 顶上
(globalThis as { window?: unknown }).window ??= globalThis;

/** 源卷：多标题链 + 长正文，保证 planShards 切出多片、每片跑多批。 */
const DOC = Array.from({ length: 12 }, (_v, i) =>
    [
        "# 第" + (i + 1) + "章 单元" + (i + 1),
        "",
        "题干文字" + i + "内容".repeat(4000),
        "",
        "## " + (i + 1) + ".1 小节",
        "",
        "小节正文" + i + "正文".repeat(4000),
        "",
    ].join("\n")
).join("\n");

vi.mock("../../../siyuan/query", () => ({
    KernelQuery: {
        rows: vi.fn(async () => [{ id: "20260914000000-abcdefg", box: "nb", content: "测试卷" }] as unknown[]),
        rowsAll: vi.fn(async (): Promise<unknown[]> => []),
    },
}));
vi.mock("../../../siyuan/doc", () => ({
    KernelDoc: { hPath: vi.fn(async () => ({ code: 0, data: "/讲义/测试卷" })) },
}));
vi.mock("../../../siyuan/block", () => ({
    KernelBlock: { kramdown: vi.fn(async () => ({ code: 0, data: { kramdown: DOC } })) },
}));

/** AI 回复：一道可解析单选 + 「本窗口已处理完」。@@TO: END 让每批推进一个
 *  窗口（多批自推进链走满），批数因此随片长自然增长。 */
const REPLY_Q = [
    "CAN_CONVERT: yes",
    "REASON: 覆盖本章",
    "@@Q type=single knowledge=极限 chapter=第一章",
    "@@P stem",
    "求 $\\lim_{x \\to 0}\\frac{\\sin x}{x}$。",
    "@@P opt",
    "$1$",
    "@@P opt",
    "$0$",
    "@@P ans",
    "A",
    "@@P sol",
    "等价无穷小。",
    "@@END",
    "@@TO: END",
].join("\n");

/** AI 出口替身：复刻 client 的登记簿（onSid 回传记录 id → 记录停止句柄），
 *  并统计「没带 onSid 的调用」——那正是 Issue #72 的病灶。 */
const ai = { calls: 0, noSid: 0, registry: new Map<string, () => void>(), stopReasons: [] as unknown[] };
vi.mock("../../../ai/client", () => ({
    newAiGroupId: () => "g-test",
    // 与 client.ts 同款：句柄值=停止回调（调用方给的流总闸）
    aiStopHandle: (signal: AbortSignal, stop: () => void) => ({
        signal,
        // 登记停止句柄时就近观测：调停后读 signal.reason——真实实现里
        // client 的 isUserStopOf 正是这么判的
        onSid: (sid: string) =>
            ai.registry.set(sid, () => {
                stop();
                ai.stopReasons.push((signal as AbortSignal & { reason?: unknown }).reason);
            }),
    }),
    agentChatOnce: vi.fn(
        async (
            _message: string,
            _modelId: string,
            _timeout: number,
            signal?: AbortSignal,
            track?: { onSid?: (sid: string) => void }
        ) => {
            ai.calls++;
            const sid = "sid-" + ai.calls;
            if (track?.onSid) track.onSid(sid);
            else ai.noSid++;
            if (signal?.aborted) throw new DOMException("aborted", "AbortError");
            return REPLY_Q;
        }
    ),
}));

import { convertDocBatched } from "../run/ConvertBatch";
import { convertIncremental } from "../run/ConvertIncrement";
import { SetWriter } from "../output/SetWriter";

function newBank(): QuestionBank {
    let cache: BankData | undefined;
    return new Bank(
        async () =>
            (cache ??= {
                version: 1,
                records: {},
                collections: [],
                migratedDocs: [],
                hashed: {},
                knowRoots: [],
                folders: [],
                knowHidden: [],
                docStats: {},
                sets: {},
                materials: {},
            } as BankData),
        async (v) => {
            cache = v;
        }
    );
}

beforeEach(() => {
    ai.calls = 0;
    ai.noSid = 0;
    ai.registry.clear();
    ai.stopReasons = [];
});

describe("转换族面板「停止」接线（Issue #72）", () => {
    it("每条 running 记录都进登记簿（track 全带 onSid），点停 = internal.abort() 整条流收口", async () => {
        const bank = newBank();
        const ctl = new AbortController();
        const handleRef: { fn?: () => void } = {};
        const r = await convertDocBatched("20260914000000-abcdefg", {
            t: (k) => k,
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 2,
            signal: ctl.signal, // 全程不 abort：停止只走「面板」这一条线
            bank,
            onProgress: () => {
                if (handleRef.fn) return;
                // 「面板点停」= 拿最新一条 running 记录的句柄调一下
                //（abortAiSession(rec.id) 的实际动作），不是 ctl.abort()。
                const last = [...ai.registry.values()].pop();
                if (last) {
                    handleRef.fn = last;
                    last();
                }
            },
        });

        expect(ai.calls).toBeGreaterThan(1); // 确实跑了多笔（否则锁不到全量接线）
        // 反面证据：改造前每笔都进 noSid，登记簿恒空、面板点停静默无效
        expect(ai.noSid).toBe(0);
        expect(ai.registry.size).toBeGreaterThan(0);
        // 点停 → 整条流走既有 aborted 收口（单篇=保留/丢弃抉择态）
        expect(handleRef.fn).toBeDefined();
        expect(r.status).toBe("aborted");
        // 停止是「置 aborted 标记 + 断在途 fetch + worker 池收口」：面板点停
        // 后不再续跑新 AI（否则会一直烧到源卷末尾）。每片 9 个窗口，若只是
        // 「断当前这一笔」而非整条流收口，调用数会继续涨。
        expect(ai.calls).toBeLessThan(6);
    });

    it("面板点停的中止带 AI_STOPPED 理由（在途那笔记「停止」而非「失败」）", async () => {
        const bank = newBank();
        const ctl = new AbortController();
        let fired = false;
        const r = await convertDocBatched("20260914000000-abcdefg", {
            t: (k) => k,
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 2,
            signal: ctl.signal, // 页内信号全程不 abort：停只走「面板」这条线
            bank,
            onProgress: () => {
                if (fired) return;
                const last = [...ai.registry.values()].pop();
                if (last) {
                    fired = true;
                    last(); // 面板点停 = abortAiSession(rec.id) 的实际动作
                }
            },
        });
        expect(r.status).toBe("aborted");
        // 用户停止必须带理由（AI_STOPPED）：登记簿据此判「停止」而非「失败」
        //——不带理由时与「被兄弟失败连坐断掉的那笔」形态完全相同
        expect(ai.stopReasons).toContain("stopped");
    });

    it("页内停止钮不受影响（signal 中止仍是同一条 aborted 收口）", async () => {
        const bank = newBank();
        const ctl = new AbortController();
        const r = await convertDocBatched("20260914000000-abcdefg", {
            t: (k) => k,
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 1,
            signal: ctl.signal,
            bank,
            onProgress: () => ctl.abort(),
        });
        expect(r.status).toBe("aborted");
    });
});

/**
 * 增量重转换的同一根线（Issue #72 验收 3）：增量不由 ConvertRun 起
 *（DocOps 的「重新导入」直接调它），拿不到 startExclusiveConvertRun 的
 * controller 内部句柄——故它自建中止源，面板「停止」经 aiStopHandle
 * 接上后逐块与块间都退出、已入库部分保留（重跑分类自愈）。
 */
describe("增量重转换面板「停止」接线", () => {
    it("逐块检查 onSid 接线：点停即停整条补生成（不是只断当前这块 AI）", async () => {
        const bank = newBank();
        const writer = new SetWriter(bank);
        const setId = await writer.openSet({ title: "测试集", srcId: "src-1", hPath: "/测试集" });
        await bank.flush();
        const chunks = [
            { key: "H:第1章/#0", hash: "h1", offset: 0, text: "块内容一".repeat(40) },
            { key: "H:第1章/#1", hash: "h2", offset: 100, text: "块内容二".repeat(40) },
            { key: "H:第1章/#2", hash: "h3", offset: 200, text: "块内容三".repeat(40) },
        ];
        const stops: Array<() => void> = [];
        // AI 替身：第一笔落库后回调里点停（模拟用户在看面板时点「停止」）
        const onProgress = (): void => {
            const last = [...ai.registry.values()].pop();
            if (last && stops.length === 0) {
                stops.push(last);
                last();
            }
        };
        const res = await convertIncremental({
            deleteQids: [],
            staleQids: [],
            chunks,
            setId,
            bank,
            title: "测试集",
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
            onProgress,
        });
        expect(ai.calls).toBeGreaterThan(0);
        expect(ai.noSid).toBe(0); // 每笔都进了登记簿
        expect(stops.length).toBe(1);
        expect(res.aborted).toBe(true); // 走既有中止自愈收口
        expect(res.added).toBeLessThan(chunks.length); // 未跑完剩余块
    });
});

/**
 * 增量链的 `group=prev` 悬空计数（Issue #148 同款兜底）：增量逐块生成，
 * 块间可能因源结构（块级切分把「文章」与「题目」切成两块）出现「小题块
 * 先到、材料块后到」——SetWriter 不写坏 group、读侧不悬空，但共享原文
 * 缺失要能**被点到名**，否则用户只看到「题目分开了」。
 *
 * 本用例把 AI 替身换成「整卷只回 group=prev 的小题、从不回材料块」，
 * 走真 `convertIncremental` 链，断言 `danglingGroups` 如实计数。
 */
describe("增量链 · 悬空 group=prev 计数（Issue #148）", () => {
    it("AI 只回 group=prev 小题、从不回材料块：计数逐块累加", async () => {
        const bank = newBank();
        const setId = await new SetWriter(bank).openSet({ title: "真题卷" });
        // 仅本用例临时换替身：材料块缺席 ⇒ 每道 prev 小题都该计入悬空
        const { agentChatOnce } = await import("../../../ai/client");
        const prevReply = [
            "CAN_CONVERT: yes",
            "REASON: 真题",
            "@@Q type=cloze group=prev",
            "@@P stem",
            "According to the passage, the author suggests that（ ）",
            "@@P slot-opt",
            "选项甲",
            "@@P slot-opt",
            "选项乙",
            "@@P slot-ans",
            "A",
            "@@END",
        ].join("\n");
        // 全部调用都回同一份「无材料块的 prev 小题」回复（两块的替换一致）
        // agentChatOnce 回**回复字符串本体**（reply 包装在 makeKnowAwareAi 里）
        vi.mocked(agentChatOnce).mockImplementation(
            async (
                _m: string,
                _id: string,
                _to: number,
                _sig?: AbortSignal,
                track?: { onSid?: (s: string) => void }
            ) => {
                ai.calls++;
                track?.onSid?.("sid-" + ai.calls);
                return prevReply as never;
            }
        );
        const chunks = [
            { key: "H:Text1/#0", hash: "h1", offset: 0, text: "文章正文段落。".repeat(40) },
            { key: "H:Text1/#1", hash: "h2", offset: 100, text: "真题题干段落。".repeat(40) },
        ];
        const res = await convertIncremental({
            deleteQids: [],
            staleQids: [],
            chunks,
            setId,
            bank,
            title: "真题卷",
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
        });
        expect(res.added).toBeGreaterThan(0);
        expect(res.danglingGroups).toBe(res.added); // 无一挂上材料：全部降级
        // 落库侧不悬空：记录不带 group（读侧按独立题渲染，不是坏指针）
        for (const r of Object.values((await bank.all()).records)) expect(r.group).toBeUndefined();
    });
});
