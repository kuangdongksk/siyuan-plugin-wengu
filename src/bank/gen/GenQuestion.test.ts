import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateVariantOf } from "./GenQuestion";

/**
 * 出题链（加练/变式）的**落库形态**（Issue #131 P1，20260915 审查）：
 * `genWithVerify` 的产物经 `addGenerated` **直写题库**（不经 SetWriter），
 * 而 P1-2 把 `〔opt:X〕` 标记约定改成**缺省恒在** ⇒ 本链同样必须自己接线
 * 替换，否则裸标记原样落库并显示在题卡上（与 regen 链同一个坑）。
 * 挤行选项的拆行同理：`shuffleDraftOptions` 撤除时 `unpackPackedSingle`
 * 一并带走，本链若只删不接，AI 挤行时「只剩首选项」原样落库。
 */

const replies: string[] = [];
const prompts: string[] = [];
vi.mock("../../ai/client", () => ({
    agentChatOnce: async (prompt: string): Promise<string> => {
        prompts.push(prompt);
        if (/VERIFY/.test(prompt)) return "VERIFY: yes";
        return replies.shift() ?? "";
    },
    newAiGroupId: (): string => "g-test",
    aiAbort: (): unknown => ({ signal: new AbortController().signal, onSid: (): void => undefined }),
}));
vi.mock("../../ui/Notify", async (orig) => ({
    ...(await orig<Record<string, unknown>>()),
    notifyError: vi.fn(),
    notifyInfo: vi.fn(),
    initNotify: (): void => undefined,
}));

/** node 环境无 window（防抖定时器要它）。 */
(globalThis as { window?: unknown }).window ??= globalThis;

const TEMPLATE = [
    "{{{row",
    "下列关于运动的说法正确的是（）",
    '{: custom-plugin-wengu-part="stem"}',
    "",
    "- A. 运动是物质的唯一特性",
    '{: custom-plugin-wengu-part="option-0"}',
    "}}}",
    '{: custom-plugin-wengu-q="1" custom-plugin-wengu-type="single"}',
].join("\n");

/** 带选项引用标记的变式回复（与协议 sol 规则同款形态）。 */
const MARKED_REPLY = [
    "@@Q type=single",
    "@@P stem",
    "下列关于静止的说法正确的是（）",
    "@@P opt",
    "静止是运动的特殊状态",
    "@@P opt",
    "静止是绝对的不动",
    "@@P ans",
    "A",
    "@@P sol",
    "〔opt:A〕正确：静止是运动的特殊状态。",
    "@@P sol",
    "〔opt:B〕错在把静止绝对化。",
    "@@END",
].join("\n");

/** 挤行回复：三个选项塞进同一个 @@P opt 部件（AI 无视「一选项一部件」）。 */
const PACKED_REPLY = [
    "@@Q type=single",
    "@@P stem",
    "下列关于静止的说法正确的是（）",
    "@@P opt",
    "甲\n乙\n丙",
    "@@P ans",
    "B",
    "@@END",
].join("\n");

beforeEach(() => {
    replies.length = 0;
    prompts.length = 0;
});

describe("出题链（变式/加练）的落库形态", () => {
    it("解析里的 〔opt:X〕 不落库（本链直写 addGenerated，不经 SetWriter）", async () => {
        replies.push(MARKED_REPLY);
        const kd = await generateVariantOf(TEMPLATE, "");
        expect(kd).not.toContain("〔opt:");
        expect(kd).toContain("「静止是运动的特殊状态」正确");
        expect(kd).toContain("「静止是绝对的不动」错在");
    });

    it("自检看到的是已替换形态（与落库同一份）", async () => {
        replies.push(MARKED_REPLY);
        const kd = await generateVariantOf(TEMPLATE, "");
        expect(prompts).toHaveLength(2);
        expect(prompts[1]).not.toContain("〔opt:");
        expect(prompts[1]).toContain("「静止是运动的特殊状态」正确");
        // 自检入参就是落库的那份 kramdown
        expect(prompts[1]).toContain(kd);
    });

    it("挤行选项拆行落库，字母逐字不动", async () => {
        replies.push(PACKED_REPLY);
        const kd = await generateVariantOf(TEMPLATE, "");
        expect(kd).toContain("- A. 甲");
        expect(kd).toContain("- B. 乙");
        expect(kd).toContain("- C. 丙");
        expect(kd).toContain("> B"); // 答案字母不被改写（死形态：指向原文位置）
    });
});
