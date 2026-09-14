import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BankData, QuestionBank } from "../../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../../bank/data/QuestionBank";

/**
 * 转换批记录的**行名任务名化**（Issue #88）：批号与题数在批落库时才知道，
 * 而 AI 会话登记在调用前——故落库后经 `AiSessions.retitle` 把 title 改成
 * 「生成第 N 批 · M 题」。本用例跑通编排层（内核 IO 全 mock），用 mock 的
 * 登记簿锁死：① 改名真的发生了；② 名里的批号与题数与**该批实际产出**一致
 * （不是编的数）；③ 登记 id 取自那次生成调用（改的是对的那条记录）。
 */

(globalThis as { window?: unknown }).window ??= globalThis;

const DOC = Array.from({ length: 6 }, (_, i) =>
    [`# 第${i + 1}章 单元${i + 1}`, `正文${i}-`.repeat(200), ""].join("\n")
).join("\n");

vi.mock("../../../siyuan/query", () => ({
    KernelQuery: {
        rows: vi.fn(async () => [{ id: "20260910000000-abcdefg", box: "nb", content: "测试卷" }] as unknown[]),
        rowsAll: vi.fn(async (): Promise<unknown[]> => []),
    },
}));
vi.mock("../../../siyuan/doc", () => ({
    KernelDoc: { hPath: vi.fn(async () => ({ code: 0, data: "/讲义/测试卷" })) },
}));
vi.mock("../../../siyuan/block", () => ({
    KernelBlock: { kramdown: vi.fn(async () => ({ code: 0, data: { kramdown: DOC } })) },
}));

/** 登记簿替身：记下每次 begin 的 id 与每次 retitle。 */
const store = {
    seq: 0,
    begun: [] as { id: string; kind: string; title: string }[],
    retitled: [] as { id: string; title: string }[],
};
vi.mock("../../../ai/data/AiSessions", () => ({
    aiSessions: () => ({
        begin: (id: string, kind: string, title: string): void => void store.begun.push({ id, kind, title }),
        succeed: (): void => undefined,
        fail: (): void => undefined,
        queued: (): void => undefined,
        dequeued: (): void => undefined,
        retitle: (id: string, title: string): void => void store.retitled.push({ id, title }),
    }),
}));

/** 一道可解析的单选（行协议形态）。 */
const BLOCK = [
    "@@Q type=single knowledge=极限 chapter=第一章",
    "@@P stem",
    "求 $x$。",
    "@@P opt",
    "A 选项",
    "@@P opt",
    "B 选项",
    "@@P ans",
    "A",
    "@@P sol",
    "略。",
    "@@END",
].join("\n");

/** 每次生成调用：回两道题（题干行 + 选项/答案），并按登记簿契约把
 *  **本次调用自己的登记 id** 经 track.onSid 回传（id 逐笔递增可辨）。 */
const perCall = 2;
const replyOf = (): string => {
    const blocks = Array.from({ length: perCall }, () => BLOCK).join("\n");
    return `CAN_CONVERT: yes\nREASON: ok\nSUBJECT: 数学\n${blocks}\n@@TO: END`;
};
vi.mock("../../../ai/client", () => ({
    newAiGroupId: () => "g-test",
    aiStopHandle: (signal: AbortSignal, stop: () => void) => ({ signal, onSid: (): void => void stop }),
    agentChatOnce: vi.fn(
        async (
            _msg: string,
            _model: string,
            _timeout: number,
            _signal?: AbortSignal,
            track?: { kind: string; title?: string; onSid?: (sid: string) => void }
        ) => {
            // 生成腿带 id 回传（路由腿不带 onSid）；按 kind 分流
            if (track?.kind === "convert" && track.onSid) {
                const id = `sid-${++store.seq}`;
                store.begun.push({ id, kind: "convert", title: track.title ?? "" });
                track.onSid(id);
            }
            return replyOf();
        }
    ),
}));

import { convertDocBatched } from "../run/ConvertBatch";

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
    store.seq = 0;
    store.begun = [];
    store.retitled = [];
});

const TEMPLATES: Record<string, string> = { aiRecordConvertBatch: "生成第 {i} 批 · {n} 题" };

describe("转换批记录的行名任务名化（Issue #88）", () => {
    it("每落一批就把那条生成记录的 title 改成「生成第 N 批 · M 题」", async () => {
        const bank = newBank();
        const r = await convertDocBatched("20260910000000-abcdefg", {
            t: (k) => TEMPLATES[k] ?? k,
            modelId: "m",
            fillToChoice: false,
            bigToSteps: false,
            parallel: 1,
            bank,
            onProgress: (): void => undefined,
        });
        expect(r.status).toBe("done");
        expect(store.retitled.length).toBeGreaterThan(0);
        // 名里的题数必须等于本批实际产出（perCall 道），批号是片内序号
        for (const x of store.retitled) {
            const m = /^生成第 (\d+) 批 · (\d+) 题$/.exec(x.title);
            expect(m, `bad title: ${x.title}`).not.toBeNull();
            expect(Number(m![2])).toBe(perCall);
            expect(Number(m![1])).toBeGreaterThanOrEqual(1);
        }
        // 改的必须**是生成记录**（登记簿里那条 convert），不是别的
        const genIds = new Set(store.begun.filter((b) => b.kind === "convert").map((b) => b.id));
        for (const x of store.retitled) expect(genIds.has(x.id)).toBe(true);
        // 批号在片内连续（单并发 ⇒ 单片，1..N 不跳号）
        expect(store.retitled.map((x) => Number(/第 (\d+) 批/.exec(x.title)![1]))).toEqual(
            Array.from({ length: store.retitled.length }, (_, i) => i + 1)
        );
    });
});
