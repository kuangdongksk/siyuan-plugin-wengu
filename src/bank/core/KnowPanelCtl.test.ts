import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionBank, type BankData } from "../data/QuestionBank";
import { initialKnowPanelUi, type KnowPanelUi } from "./KnowPanelUi";
import { KnowPanelCtl } from "./KnowPanelCtl";
import type { QuizView } from "../../quiz";
import { generateKnowledgeOutline } from "../../convert/service/knowledge/KnowOutline";
import { expandKnowDocs, type KnowDocEntry } from "../../convert/service/knowledge/KnowledgeLink";
import { notifyError, notifyInfo } from "../../ui/Notify";
import { AI_STOPPED } from "../../ai/data/AiSessions";

/**
 * 导入后自动补索引（Issue #2）的编排行为：整条链在 node 里跑到「起 AI」
 * 的门槛——内核读、单篇归纳、文档展开、通知全用替身，验的是编排口径：
 * 已索引不重跑、与手动路径共用同一坑位（同时只跑一份）、失败不冒
 * unhandled rejection。
 */

vi.mock("siyuan", () => ({ fetchSyncPost: vi.fn(), showMessage: vi.fn() }));
vi.mock("../../ui/Notify", () => ({ notifyError: vi.fn(), notifyInfo: vi.fn() }));
// 选择器回传的勾选集合（用例可改：验「只认本次新增登记根」需带历史根）
const hp = vi.hoisted(() => ({ ids: ["root"] as string[] }));
vi.mock("../../ui/KnowPicker", () => ({
    openKnowPicker: (o: { onConfirm(ids: string[]): void }) => o.onConfirm(hp.ids),
}));
vi.mock("../../siyuan/query", () => ({
    KernelQuery: {
        rows: vi.fn(async () => []),
        rowsMap: vi.fn(async () => []),
        rowsAll: vi.fn(async () => []),
        rowsMapAll: vi.fn(async () => []),
    },
}));
vi.mock("../data/KnowHash", () => ({ knowHash: (): undefined => undefined }));
vi.mock("../../convert/service/knowledge/KnowOutline", () => ({
    generateKnowledgeOutline: vi.fn(),
    outlineSrcHash: vi.fn(async () => ""),
}));
vi.mock("../../convert/service/knowledge/KnowledgeLink", () => ({
    expandKnowDocs: vi.fn(),
}));

const genMock = vi.mocked(generateKnowledgeOutline);
const expandMock = vi.mocked(expandKnowDocs);
const notifyErrorMock = vi.mocked(notifyError);
const notifyInfoMock = vi.mocked(notifyInfo);

// QuestionBank.markDirty 走 window 防抖定时器，node 环境补桩
Reflect.set(globalThis, "window", { setTimeout, clearTimeout });

/** node 的 unhandledRejection 钩子（仓库 tsconfig 不带 @types/node，类型就地收口）。 */
const nodeProc = (
    globalThis as unknown as {
        process: { on(ev: string, cb: (e: unknown) => void): void; off(ev: string, cb: (e: unknown) => void): void };
    }
).process;

const ROOT = "root";
const OLD = "kid-old";
const NEW = "kid-new";

/** 展开结果：登记根自身 + 一个已索引子文档 + 一个未索引子文档。 */
const entries = (id: string): KnowDocEntry => ({
    docId: id,
    title: id,
    hPath: `/${id}`,
    sections: [],
    sectionTree: [],
});

function makeBank(): QuestionBank {
    const data: BankData = {
        version: 1,
        records: {},
        collections: [],
        migratedDocs: [],
        hashed: {},
        knowRoots: [],
        folders: [],
        knowHidden: [],
        docStats: {},
        knowTrees: {
            [OLD]: { srcId: OLD, outlineMd: "# 旧", nodes: [], srcHash: "h", createdAt: 1 },
        },
    };
    return new QuestionBank(
        async () => data,
        async () => undefined
    );
}

function makeCtl(): { ctl: KnowPanelCtl; ui: KnowPanelUi; bank: QuestionBank } {
    const ui = initialKnowPanelUi();
    const bank = makeBank();
    const v = {
        t: (k: string) => k,
        bankStore: () => bank,
        aiModelId: () => "model-1",
    } as unknown as QuizView;
    return { ctl: new KnowPanelCtl(ui, v), ui, bank };
}

/** 跑完一条导入链并等到「起 AI」的门槛（宏任务让出 + 归纳 Promise 落定）。 */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 1));
};

beforeEach(() => {
    vi.clearAllMocks();
    hp.ids = [ROOT];
    expandMock.mockImplementation(async (id: string) =>
        id === ROOT ? [entries(ROOT), entries(OLD), entries(NEW)] : [entries(id)]
    );
    genMock.mockImplementation(async (id: string) => {
        if (id === ROOT) throw new Error("doc has no content"); // 目录壳
        return { count: 2 };
    });
});

describe("导入后自动补索引", () => {
    it("只跑本次新导入且尚无索引的文档（已索引的一个都不重跑、不跑 AI）", async () => {
        const { ctl, ui } = makeCtl();
        ctl.importRoots({} as HTMLElement);
        await settle();
        expect(genMock.mock.calls.map((c) => c[0])).toEqual([ROOT, NEW]);
        expect(genMock.mock.calls.some((c) => c[0] === OLD)).toBe(false);
        expect(notifyInfoMock).toHaveBeenCalledWith({
            key: "notifyOutlineAutoDone",
            vars: { n: "1", k: "1", m: "0" }, // 成功 1 篇（目录壳计入跳过）
        });
        expect(ui.outlining).toBeUndefined(); // 收工复位坑位
    });

    it("只认本次新增的登记根：历史登记的缺索引文档不被顺手重跑", async () => {
        const { ctl, bank } = makeCtl();
        const past = "kid-past"; // 上一轮就登记过、至今无索引
        (await bank.all()).knowRoots = [past]; // 导入前的登记清单
        hp.ids = [past, ROOT]; // 选择器回传全量勾选：含既有根 + 本次新增根
        expandMock.mockImplementation(async (id: string) =>
            id === ROOT ? [entries(ROOT), entries(OLD), entries(NEW)] : [entries(id)]
        );
        genMock.mockImplementation(async () => ({ count: 2 }));
        ctl.importRoots({} as HTMLElement);
        await settle();
        // 历史根的子树不展开、不进清单——本轮只处理新增根
        expect(genMock.mock.calls.map((c) => c[0])).not.toContain(past);
        expect(genMock.mock.calls.map((c) => c[0])).toEqual([ROOT, NEW]);
    });

    it("自动索引进行中，行内「索引」不起第二份任务（共用 outlineCtrl 坑位）", async () => {
        const { ctl, ui } = makeCtl();
        let release = (): void => undefined;
        genMock.mockImplementation((id: string) =>
            id === NEW
                ? new Promise((resolve) => (release = () => resolve({ count: 1 })))
                : Promise.resolve({ count: 1 })
        );
        ctl.importRoots({} as HTMLElement);
        await settle();
        expect(ui.outlining).toBe(ROOT); // 坑位挂首个待索引文档行
        const calls = genMock.mock.calls.length;
        ctl.outline({ docId: OLD } as never); // 坑位被自动索引占着：不起第二份
        ctl.outline({ docId: NEW } as never);
        await settle();
        expect(genMock.mock.calls.length).toBe(calls);
        expect(ui.outlining).toBe(ROOT);
        release();
        await settle();
        expect(ui.outlining).toBeUndefined(); // 收工复位
    });

    it("手动任务已占坑位时，自动路径让位（不双开、不改用户任务的坑位）", async () => {
        const { ctl, ui } = makeCtl();
        let release = (): void => undefined;
        genMock.mockImplementation(
            (id: string) =>
                new Promise((resolve) => {
                    if (id === "kid-new") release = () => resolve({ count: 1 });
                })
        );
        ctl.outline({ docId: NEW } as never); // 用户先点行内「索引」：单篇直接跑，占住坑位
        await settle();
        expect(ui.outlining).toBe(NEW);
        ctl.importRoots({} as HTMLElement); // 随后导入：自动路径不得抢坑位
        await settle();
        expect(genMock.mock.calls.map((c) => c[0])).toEqual([NEW]); // 自动路径一篇都没起
        expect(notifyInfoMock).not.toHaveBeenCalledWith(expect.objectContaining({ key: "notifyOutlineAutoDone" }));
        expect(ui.outlining).toBe(NEW); // 用户任务的坑位不被自动路径擦掉
        release();
        await settle();
        expect(ui.outlining).toBeUndefined();
    });

    it("导入链失败（落盘抛）落通知、面板仍重载，不冒 unhandled rejection", async () => {
        const { ctl, bank } = makeCtl();
        const seen: unknown[] = [];
        const onUnhandled = (e: unknown): void => void seen.push(e);
        nodeProc.on("unhandledRejection", onUnhandled);
        vi.spyOn(bank, "flush").mockRejectedValueOnce(new Error("saveData rejected"));
        ctl.importRoots({} as HTMLElement);
        await settle();
        nodeProc.off("unhandledRejection", onUnhandled);
        expect(notifyErrorMock).toHaveBeenCalledWith({ key: "notifyAutoLinkFail", vars: { msg: "saveData rejected" } });
        expect(genMock).not.toHaveBeenCalled(); // 链条断在落盘，不该盲跑 AI
        expect(seen).toEqual([]);
    });

    it("归纳全灭走失败通知并复位坑位（面板不卡在「索引中」）", async () => {
        const { ctl, ui } = makeCtl();
        genMock.mockRejectedValue(new Error("provider boom"));
        ctl.importRoots({} as HTMLElement);
        await settle();
        expect(notifyErrorMock).toHaveBeenCalledWith({ key: "notifyOutlineFail", vars: { msg: "provider boom" } });
        expect(ui.outlining).toBeUndefined();
        expect(ui.outlineErr).toContain("knowOutlineFail");
    });
});

/**
 * AI 索引流的用户停止必须带 `AI_STOPPED` 理由（Issue #88 复审补记）：
 * 索引流是 #72 登记的第三条多调用流，它的三处停止（页内「再点=中止」、
 * 面板点停的 `aiStopHandle` 接线、横幅停止钮）都走同一个自建 ctrl——
 * 漏带理由时横幅说「已停止」、在途记录却落红色「失败」（与转换族曾经
 * 的同款矛盾）。这里跑真实 `runOutlineFlow`（不 mock KnowOutlineFlow），
 * 用 `generateKnowledgeOutline` 替身在每篇里就近读 `signal.reason`。
 */
describe("AI 索引流的停止必带 AI_STOPPED 理由", () => {
    /** 记下每次归纳拿到的 signal（面板点停 / 页内中止都在其上验理由）。 */
    const signals: AbortSignal[] = [];

    beforeEach(() => {
        signals.length = 0;
    });

    it("页内「再点=中止」：signal.reason 落 AI_STOPPED（不是裸 abort）", async () => {
        const { ctl, ui } = makeCtl();
        let held = (): void => undefined;
        const mk = (id: string): Promise<{ count: number }> =>
            id === NEW ? new Promise((resolve) => (held = () => resolve({ count: 1 }))) : Promise.resolve({ count: 1 });
        genMock.mockImplementation((id: string, _m: string, signal?: AbortSignal) => {
            if (signal) signals.push(signal);
            return mk(id);
        });
        ctl.outline({ docId: NEW } as never); // 单篇：直接跑，占住坑位
        await settle();
        expect(ui.outlining).toBe(NEW);
        ctl.outline({ docId: NEW } as never); // 再点 = 中止
        expect(signals[0].aborted).toBe(true);
        expect(signals[0].reason).toBe(AI_STOPPED); // 不带理由 ⇒ 记录落「失败」
        held();
        await settle();
        expect(ui.outlining).toBeUndefined();
    });

    it("面板点停接线（aiStopHandle 的 stop）= 同一处理由带上的中止", async () => {
        const { ctl } = makeCtl();
        let abortHandle: { stop?(): void } | undefined;
        genMock.mockImplementation(
            (id: string, _m: string, signal?: AbortSignal, _b?: unknown, abort?: { stop?(): void }) => {
                if (signal) signals.push(signal);
                abortHandle = abort; // executeOutline 交给 generateKnowledgeOutline 的句柄
                return new Promise((resolve) => setTimeout(() => resolve({ count: 1 }), 1));
            }
        );
        ctl.outline({ docId: NEW } as never);
        await settle();
        expect(abortHandle?.stop).toBeDefined(); // 面板点停的落点（Issue #72）
        abortHandle?.stop?.();
        expect(signals[0].reason).toBe(AI_STOPPED); // 与页内同一处 ctrl、同一理由
        await settle();
    });

    it("横幅停止钮（stopAiFlow）：真停到索引流、ctrl 理由落 AI_STOPPED", async () => {
        const { runOutlineFlow } = await import("./KnowOutlineFlow");
        const { resetAiFlow, stopAiFlow } = await import("../../ai/core/FlowRegistry");
        resetAiFlow();
        const ctrl = new AbortController();
        const visited: string[] = [];
        // 首篇执行中按横幅停止钮（面板上的实际动作）→ 逐篇循环必须退出
        const run = await runOutlineFlow(
            (k) => k,
            ["a", "b", "c"],
            ctrl,
            async (id) => {
                visited.push(id);
                if (id === "a") stopAiFlow();
                return 1;
            }
        );
        expect(visited).toEqual(["a"]); // 停住整批，不是只断当前这一笔
        expect(ctrl.signal.reason).toBe(AI_STOPPED); // 用户显式停止的理由（在途记录据此记「停止」）
        expect(run.ok).toBe(1);
    });
});
