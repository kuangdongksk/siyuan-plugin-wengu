import { afterEach, vi } from "vitest";
import { initialMobileUi, MobileDrill, type MobileUi } from "./MobileDrill";
import { QuestionType } from "../../types";
import type { WenguQuestion } from "../../types";
import type { WenguSession } from "../../quiz/service/HistoryStore";
import type { MobileDeps } from "../types";

/** node 测试环境无 window（vitest 不启 jsdom），QuestionBank.markDirty 的
 *  防抖定时器需要它——挂全局自指即可（BankRecording.test 同款）。 */
(globalThis as { window?: unknown }).window ??= globalThis;

/** 受控 AI 判分闸：测试自己决定 verdict 何时到场——复现「用户交卷先于
 *  AI 返回」的竞态（终局判分晚于交卷，题库镜像必须被覆写）。
 *  未开闸时**透传真实现**（既有「AI 判分失败回落自评」用例走真链路抛错）。
 *  vi.mock 被提升到 import 之上，故闸与放行器走 vi.hoisted。 */
// 内部名 `gate`（vi.hoisted 的返回值不能直接 export），末尾再 export 一份别名：
// 主测试文件的 vi.mock 工厂要引用它（拆片后仍在同一模块图里）。
const judgeGate = vi.hoisted(() => {
    let release: ((v: { verdict: "right" | "partial" | "wrong"; ok: boolean; comment: string }) => void) | undefined;
    let gate: Promise<{ verdict: "right" | "partial" | "wrong"; ok: boolean; comment: string }> | undefined;
    return {
        arm(): Promise<{ verdict: "right" | "partial" | "wrong"; ok: boolean; comment: string }> {
            gate = new Promise((res) => {
                release = res;
            });
            return gate;
        },
        open(v: { verdict: "right" | "partial" | "wrong"; ok: boolean; comment: string }): void {
            release?.(v);
        },
        pending(): Promise<{ verdict: "right" | "partial" | "wrong"; ok: boolean; comment: string }> | undefined {
            return gate;
        },
        reset(): void {
            gate = undefined;
            release = undefined;
        },
    };
});
/** judgeGate 的对外别名（见上方说明）。 */
export { judgeGate };

afterEach(() => judgeGate.reset());

vi.mock("../../quiz/service/AiJudge", async (orig) => {
    const real = await orig<{ judgeBrief: (...args: unknown[]) => unknown }>();
    return {
        ...real,
        judgeBrief: (...args: unknown[]): unknown => judgeGate.pending() ?? real.judgeBrief(...args),
    };
});

/**
 * 移动端刷题单测的共享装配件（Issue #131 拆片：洗牌用例另立
 * `MobileDrillShuffle.test.ts`，两边共用本文件，避免夹具复制两份）。
 *
 * 原口径：移动端刷题编排的关键口径（Issue #59 验收 5）：记账通道全部走既有
 * 通道（会话 upsert 幂等 / 题库镜像首答与重复提交分账）、揭示写入点
 * 不缺（即时判分即锁定+揭示；收卷模式提交只记已答）、「未完成轮」
 * 判据只看 endedAt。
 *
 * 用假 bank/history 记录调用（真实现走内核 IO，不进单测）。
 */

/** 造一道题（缺省单选 2 选项，`over` 覆写）。 */
export function q(id: string, over: Partial<WenguQuestion> = {}): WenguQuestion {
    return {
        id,
        type: QuestionType.Single,
        answer: "A",
        optionMd: ["甲", "乙"],
        attempts: 0,
        wrongCount: 0,
        ...over,
    };
}

/** 假题库：记录 recordAnswer / recordVerifyResult 调用（镜像分账判据）。 */
export function fakeBank() {
    const calls: { kind: string; qid: string; ok: boolean }[] = [];
    return {
        calls,
        bank: {
            preload: async (): Promise<void> => undefined,
            all: async (): Promise<unknown> => ({ sets: {}, records: {}, materials: {} }),
            recordAnswer: async (qid: string, _a: string, ok: boolean): Promise<void> =>
                void calls.push({ kind: "first", qid, ok }),
            peek: (): undefined => undefined,
            flush: async (): Promise<void> => undefined,
            markDirty: (): void => undefined,
        } as never,
    };
}

export function fakeHistory() {
    const upserts: WenguSession[] = [];
    const store = {
        upsert: async (s: WenguSession): Promise<void> => void upserts.push(s),
        docSessions: async (): Promise<WenguSession[]> => [],
        preload: async (): Promise<void> => undefined,
    };
    return { store: store as never, upserts };
}

/** 建一个控制器（ui 深代理在真机由壳组件创建；单测里给普通对象即可）。 */
export function make(over: Partial<Parameters<typeof buildDeps>[0]> = {}) {
    const { ui, deps, calls, upserts } = buildDeps(over);
    const drill = new MobileDrill(ui, deps);
    return { drill, ui, calls, upserts };
}

/** 拼 deps（真机由壳组件给；单测给假 bank/history）。 */
export function buildDeps(
    over: {
        bank?: unknown;
        history?: unknown;
    } = {}
) {
    const { bank, calls } = fakeBank();
    const { store, upserts } = fakeHistory();
    const ui: MobileUi = initialMobileUi();
    const deps: MobileDeps = {
        i18n: {},
        bank: (over.bank as never) ?? bank,
        history: (over.history as never) ?? store,
        settings: { showNums: true },
    };
    return { ui, deps, calls, upserts };
}

/** 构造一个已装载的会话（绕过内核装载链，直接摆好本轮状态）。 */
export function armed(over: { reveal?: "instant" | "after"; questions?: WenguQuestion[] } = {}) {
    const { drill, ui, calls, upserts } = make();
    const list = over.questions ?? [q("a"), q("b")];
    ui.home = { loading: false, error: "", sets: [], activeSetId: "set1", activeSetTitle: "卷一" };
    ui.fullList = list;
    ui.setup.reveal = over.reveal ?? "instant";
    drill.start("fresh");
    return { drill, ui, calls, upserts, list };
}
