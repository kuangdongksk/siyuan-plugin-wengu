import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionBank, type BankData, type BankRecord } from "../data/QuestionBank";
import { regenRecords } from "./RegenDialog";

/**
 * 重新生成链的**答案核查兜底**（Issue #123 验收 ②）：文本定位不到正确项
 * （选项被 AI 改写）→ 走 verifyPrompt 独立会话自检；自检 no 则**整题不
 * 落盘**（记录 kramdown 逐字节不变），报错走既有 errText 通道。
 */

/** AI 通道替身：按序吐出「重生成回复 / 自检结论」，空回复=调用方兜底失败。 */
const replies: string[] = [];
vi.mock("../../ai/client", () => ({
    agentChatOnce: async (): Promise<string> => replies.shift() ?? "",
    aiAbort: (): unknown => ({ signal: new AbortController().signal, onSid: (): void => undefined }),
    newAiGroupId: (): string => "g-test",
}));
vi.mock("../../ui/Notify", () => ({
    notifyError: vi.fn(),
    notifyInfo: vi.fn(),
    initNotify: (): void => undefined,
}));
vi.mock("../../siyuan/block", () => ({
    KernelBlock: { kramdown: async (): Promise<unknown> => ({ data: { kramdown: "" } }) },
}));

/** node 环境无 window（markDirty 的防抖定时器要它）。 */
(globalThis as { window?: unknown }).window ??= globalThis;

/** 原题：ans=B 指向「运动是物质的根本属性」（用户实录原题视图）。 */
const ORIG_KD = [
    "{{{row",
    "下列关于运动的说法正确的是（）",
    '{: custom-plugin-wengu-part="stem"}',
    "",
    "- A. 运动是物质的唯一特性",
    '{: custom-plugin-wengu-part="option-0"}',
    "",
    "- B. 运动是物质的根本属性",
    '{: custom-plugin-wengu-part="option-1"}',
    "",
    "- C. 运动是物质的一维性",
    '{: custom-plugin-wengu-part="option-2"}',
    "",
    "> B",
    '{: custom-plugin-wengu-part="answer"}',
    "}}}",
    '{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"}',
].join("\n");

/** 选项被改写的回复（正确项文本已不在选项里）→ 必须走 AI 自检。 */
const MISMATCH_REPLY = [
    "@@Q type=single",
    "@@P stem",
    "下列关于运动的说法正确的是（）",
    "@@P opt",
    "运动是物质的存在方式",
    "@@P opt",
    "运动是物质的唯一特性",
    "@@P opt",
    "运动是物质的一维性",
    "@@P ans",
    "A",
    "@@END",
].join("\n");

const OK_REPLY = [
    "@@Q type=single",
    "@@P stem",
    "下列关于运动的说法正确的是（）",
    "@@P opt",
    "运动是物质的唯一特性",
    "@@P opt",
    "运动是物质的根本属性",
    "@@P opt",
    "运动是物质的一维性",
    "@@P ans",
    "B",
    "@@END",
].join("\n");

function newBank(kd = ORIG_KD): { bank: QuestionBank; read: () => BankData } {
    const data: BankData = {
        version: 1,
        records: {
            q1: {
                qid: "q1",
                kramdown: kd,
                type: "single",
                kpRefs: [],
                sourceDocId: "doc1",
                hash: "h1",
                stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
            } satisfies BankRecord,
        },
        collections: [],
        migratedDocs: [],
        hashed: { h1: "q1" },
        knowRoots: [],
        folders: [],
        knowHidden: [],
        docStats: {},
    };
    return {
        bank: new QuestionBank(
            async () => data,
            async () => undefined
        ),
        read: () => data,
    };
}

/** 无中止句柄（批量重转照常跑到底）。 */
function noStop(): { signal: AbortSignal; onSid(sid: string): void } {
    return { signal: new AbortController().signal, onSid: (): void => undefined };
}

const deps = (bank: QuestionBank) => ({ t: (k: string) => k, bank, modelId: "", onDone: (): void => undefined });

beforeEach(() => {
    replies.length = 0;
});

describe("runRegen · 答案核查兜底（Issue #123 验收 ②）", () => {
    it("文本失配 + 自检 no → 整题不落盘（kramdown 逐字节不变）", async () => {
        const { bank, read } = newBank();
        replies.push(MISMATCH_REPLY, "VERIFY: no");
        const seen: [string, boolean][] = [];
        const ok = await regenRecords(deps(bank), ["q1"], noStop(), (qid, one) => seen.push([qid, one]));
        expect(ok).toBe(0);
        expect(seen).toEqual([["q1", false]]);
        expect(read().records.q1.kramdown).toBe(ORIG_KD); // 未落盘：原文逐字节不变
        expect(read().records.q1.hash).toBe("h1"); // 指纹未被改写
        expect(replies.length).toBe(0); // 两发都消费掉（重生成 + 自检）
    });

    it("文本失配 + 自检 yes → 放行并落盘（自检是兜底放行口，不是拒收口）", async () => {
        const { bank, read } = newBank();
        replies.push(MISMATCH_REPLY, "VERIFY: YES");
        const ok = await regenRecords(deps(bank), ["q1"], noStop());
        expect(ok).toBe(1);
        expect(read().records.q1.kramdown).not.toBe(ORIG_KD);
        expect(read().records.q1.hash).not.toBe("h1");
    });

    it("文本命中（选项沿用原题）→ 零自检调用，直接落盘", async () => {
        const { bank, read } = newBank();
        replies.push(OK_REPLY);
        const ok = await regenRecords(deps(bank), ["q1"], noStop());
        expect(ok).toBe(1);
        expect(replies.length).toBe(0); // 未多耗一发自检
        expect(read().records.q1.kramdown).toContain("运动是物质的根本属性");
    });
});
