import { afterEach, vi } from "vitest";
import { initialMobileUi, MobileDrill, type MobileUi } from "./MobileDrill";
import { QuestionType } from "../../types";
import type { WenguQuestion } from "../../types";
import type { WenguSession } from "../../quiz/service/HistoryStore";
import type { MobileDeps } from "../types";
import type { BankData } from "../../bank/data/QuestionBank";

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

/**
 * 假题库（记录 recordAnswer 调用，判镜像分账）。
 *
 * `setQuestions` 走的是**真实现**（`BankSets`），但题面**不经 kramdown
 * 解析**：假 bank 的 `parsedOf/cacheParsed` 就是内存缓存，`seedSet` 把
 * `ParsedQuestion` 形态的题面直接塞进去。理由——单测要的是「切卷装题」
 * 这条链，不是 BankParse（它另有用例）；用真 kramdown 拼夹具等于把解析器
 * 契约抄一份到本文件，且极易随契约演进静默失效。
 */
export interface FakeBank {
    calls: { kind: string; qid: string; ok: boolean }[];
    /** 预埋的题集（`setId → { qids }`）。 */
    sets: Record<string, { id: string; title: string; qids: string[] }>;
    /** 预埋的记录（`qid → BankRecord` 形状）。 */
    records: Record<string, unknown>;
    /** 解析缓存（`setQuestions` 从这里读题面）。 */
    parsed: Map<string, { hash: string; parsed: unknown }>;
    /** 供 `deps.bank` 用的实例面。 */
    bank: never;
}

/** 造一个假题库（空数据面，用例按需 `seedSet`）。 */
export function fakeBank(): FakeBank {
    const calls: { kind: string; qid: string; ok: boolean }[] = [];
    const sets: FakeBank["sets"] = {};
    const records: FakeBank["records"] = {};
    const parsed: FakeBank["parsed"] = new Map();
    // 形状对齐 `BankData`（`check:svelte` 要判隐式 any，逐字段标好）；
    // 只有 sets/records 被消费，其余给空面即可
    const data: BankData = {
        version: 1,
        sets: sets as unknown as BankData["sets"],
        records: records as unknown as BankData["records"],
        materials: {},
        collections: [],
        migratedDocs: [],
        hashed: {},
        knowRoots: [],
        folders: [],
        docStats: {},
    };
    const bank = {
        preload: async (): Promise<void> => undefined,
        all: async (): Promise<unknown> => data,
        parsedOf: (qid: string, hash: string): unknown => {
            const hit = parsed.get(qid);
            return hit && hit.hash === hash ? hit.parsed : undefined;
        },
        cacheParsed: (qid: string, hash: string, p: unknown): void => void parsed.set(qid, { hash, parsed: p }),
        recordAnswer: async (qid: string, _a: string, ok: boolean): Promise<void> =>
            void calls.push({ kind: "first", qid, ok }),
        peek: (): undefined => undefined,
        flush: async (): Promise<void> => undefined,
        markDirty: (): void => undefined,
    };
    return { calls, sets, records, parsed, bank: bank as never };
}

/** 把一个题集连同题面塞进假题库（`setId` 同时是 qid 前缀的源文档 id）。
 *  题面按 `ParsedQuestion` 形态预置：恢复链只关心题 id / 作答位，
 *  解析本身有 `BankParse` 自己的用例。 */
export function seedSet(face: FakeBank, setId: string, list: WenguQuestion[]): void {
    face.sets[setId] = { id: setId, title: setId, qids: list.map((x) => x.id) };
    for (const x of list) {
        const hash = `h-${x.id}`;
        face.records[x.id] = {
            qid: x.id,
            kramdown: "",
            type: x.type ?? QuestionType.Single,
            kpRefs: [],
            sourceDocId: setId,
            hash,
            stats: { attempts: 0, wrongCount: 0, updatedAt: 0 },
        };
        face.parsed.set(x.id, { hash, parsed: { ...x, rootId: setId } });
    }
}

/** 假会话库（`HistoryStore` 面）：`allSessions` 与 `docSessions` **同源**——
 *  未完成轮探测自 Issue #167 起扫全库，只看 docSessions 的老假件覆盖不到。 */
export function fakeHistory() {
    const upserts: WenguSession[] = [];
    /** 被抹掉的会话 id（空轮静默关轮必须删开轮时 upsert 的那条，Issue #158）。 */
    const removes: string[] = [];
    /** 盘上全部轮次（升序口径由测例自己保证：按 startedAt 排好再塞）。 */
    const SESSIONS: WenguSession[] = [];
    const byStarted = (a: WenguSession, b: WenguSession): number => a.startedAt - b.startedAt;
    const store = {
        upsert: async (s: WenguSession): Promise<void> => void upserts.push(s),
        removeSession: async (id: string): Promise<void> => {
            removes.push(id);
            const i = SESSIONS.findIndex((x) => x.id === id);
            if (i >= 0) SESSIONS.splice(i, 1);
        },
        docSessions: async (docId?: string): Promise<WenguSession[]> =>
            [...SESSIONS].filter((s) => !docId || s.docId === docId).sort(byStarted),
        allSessions: async (): Promise<WenguSession[]> => [...SESSIONS].sort(byStarted),
        preload: async (): Promise<void> => undefined,
    };
    return { store: store as never, upserts, removes, SESSIONS };
}

/** 建一个控制器（ui 深代理在真机由壳组件创建；单测里给普通对象即可）。 */
export function make(over: Partial<Parameters<typeof buildDeps>[0]> = {}) {
    const { ui, deps, calls, upserts, removes, SESSIONS, face } = buildDeps(over);
    const drill = new MobileDrill(ui, deps);
    return { drill, ui, calls, upserts, removes, SESSIONS, face };
}

/** 拼 deps（真机由壳组件给；单测给假 bank/history）。 */
export function buildDeps(
    over: {
        bank?: unknown;
        history?: unknown;
    } = {}
) {
    const face = fakeBank();
    const { bank, calls } = face;
    const { store, upserts, removes, SESSIONS } = fakeHistory();
    const ui: MobileUi = initialMobileUi();
    const deps: MobileDeps = {
        i18n: {},
        bank: (over.bank as never) ?? bank,
        history: (over.history as never) ?? store,
        settings: { showNums: true },
    };
    return { ui, deps, calls, upserts, removes, SESSIONS, face };
}

/** 构造一个已装载的会话（绕过内核装载链，直接摆好本轮状态）。 */
export function armed(over: { reveal?: "instant" | "after"; questions?: WenguQuestion[] } = {}) {
    const { drill, ui, calls, upserts, removes, SESSIONS } = make();
    const list = over.questions ?? [q("a"), q("b")];
    ui.home = { loading: false, error: "", sets: [], activeSetId: "set1", activeSetTitle: "卷一" };
    ui.fullList = list;
    ui.setup.reveal = over.reveal ?? "instant";
    drill.start("fresh");
    return { drill, ui, calls, upserts, removes, SESSIONS, list };
}
