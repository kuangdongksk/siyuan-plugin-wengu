import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionBank, type BankData, type BankRecord } from "../data/QuestionBank";
import { regenRecords } from "./RegenDialog";

/**
 * 重新生成链的**答案核查兜底**（Issue #123 验收 ②）：文本定位不到正确项
 * （选项被 AI 改写）→ 走 verifyPrompt 独立会话自检；自检 no 则**整题不
 * 落盘**（记录 kramdown 逐字节不变），报错走既有 errText 通道。
 */

/** AI 通道替身：按序吐出「重生成回复 / 自检结论」，空回复=调用方兜底失败。
 *  `prompts` 收下每一发的 prompt 原文（自检那发的入参形态要能直接观测
 *  ——「替换落在自检前还是后」只有看入参才验证得动）。 */
const replies: string[] = [];
const prompts: string[] = [];
vi.mock("../../ai/client", () => ({
    agentChatOnce: async (prompt: string): Promise<string> => {
        prompts.push(prompt);
        return replies.shift() ?? "";
    },
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

/** 挤行回复（AI 无视「每个选项一个 @@P opt」，三个选项塞进同一部件）：
 *  正确项文本仍在选项里（故 reseatAnswer 命中、零自检），但渲染只给首行
 *  编字母 ⇒ 不拆行落库即「只剩一个选项」。 */
const PACKED_REPLY = [
    "@@Q type=single",
    "@@P stem",
    "下列关于运动的说法正确的是（）",
    "@@P opt",
    "运动是物质的唯一特性\n运动是物质的根本属性\n运动是物质的一维性",
    "@@P ans",
    "B",
    "@@END",
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

/** 带选项引用标记的回复（keep 序协议要求 AI 在解析里写 〔opt:X〕）：
 *  正确项文本与 OK_REPLY 同款，故 reseatAnswer 文本命中、零自检。 */
const MARKED_REPLY = [
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
    "@@P sol",
    "〔opt:B〕正确：运动是物质的根本属性。",
    "@@P sol",
    "〔opt:A〕错在把唯一特性当成根本属性。",
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
    prompts.length = 0;
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

    it("解析里的 〔opt:X〕 标记**不落库**（P1：regen 链不经 SetWriter）", async () => {
        // runRegen 直写 replaceRecordKramdown（不走 SetWriter.append），故
        // 标记替换必须在本链接线——否则 keep 序 prompt 要求的裸标记会原样
        // 写进题库、显示在题卡上（「唯一落库出口」断言对 regen 不成立）。
        const { bank, read } = newBank();
        replies.push(MARKED_REPLY);
        const ok = await regenRecords(deps(bank), ["q1"], noStop());
        expect(ok).toBe(1);
        const kd = read().records.q1.kramdown;
        expect(kd).not.toContain("〔opt:"); // 标记已换掉
        expect(kd).toContain("「运动是物质的根本属性」正确"); // 换成选项文本
        expect(kd).toContain("「运动是物质的唯一特性」错在"); // A 也被换
    });

    it("自检会话看到的是**已替换**形态（与落盘一致，P1 顺序断言）", async () => {
        // 失配分支发的是 verifyPrompt(renderUnit(draft))——替换必须落在
        // **自检之前**，否则 AI 自检的基线与落盘形态漂移（自检过、落盘另一份）。
        const { bank } = newBank();
        // 正确项文本被改写 ⇒ reseatAnswer 失配 ⇒ 走自检
        const mismatchedMarked = MARKED_REPLY.replace("运动是物质的根本属性", "运动是物质的存在方式");
        replies.push(mismatchedMarked, "VERIFY: yes");
        const ok = await regenRecords(deps(bank), ["q1"], noStop());
        expect(ok).toBe(1);
        expect(prompts).toHaveLength(2); // 重生成 + 自检，自检不多不少一发
        expect(prompts[0]).toContain("〔opt:X〕"); // 重生成 prompt 带标记协议
        // 自检那一发的题目正文里，标记已被换成选项文本（与落盘同一形态）
        expect(prompts[1]).not.toContain("〔opt:");
        expect(prompts[1]).toContain("「运动是物质的存在方式」正确");
    });

    it("挤行回复：拆行落库（不拆则渲染只给首行编字母 ⇒ 只剩一个选项）", async () => {
        // 与上条同源：`shuffleDraftOptions` 撤除时带走了它的**两道**格式
        // 处理，本链直写 replaceRecordKramdown，两步都得自己接。
        const { bank, read } = newBank();
        replies.push(PACKED_REPLY);
        const ok = await regenRecords(deps(bank), ["q1"], noStop());
        expect(ok).toBe(1);
        const kd = read().records.q1.kramdown;
        expect(kd).toContain("- B. 运动是物质的根本属性");
        expect(kd).toContain("- C. 运动是物质的一维性");
        expect(kd).toContain("> B"); // 答案字母逐字不动（死形态指向原文位置）
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
