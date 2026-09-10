import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionBank, type BankData } from "../data/QuestionBank";
import { initialKnowPanelUi, type KnowPanelUi } from "./KnowPanelUi";
import { KnowPanelCtl } from "./KnowPanelCtl";
import type { QuizView } from "../../quiz";
import { generateKnowledgeOutline } from "../../convert/service/knowledge/KnowOutline";
import { expandKnowDocs, type KnowDocEntry } from "../../convert/service/knowledge/KnowledgeLink";
import { notifyError, notifyInfo } from "../../ui/Notify";

/**
 * 导入后自动补索引（Issue #2）的编排行为：整条链在 node 里跑到「起 AI」
 * 的门槛——内核读、单篇归纳、文档展开、通知全用替身，验的是编排口径：
 * 已索引不重跑、与手动路径共用同一坑位（同时只跑一份）、失败不冒
 * unhandled rejection。
 */

vi.mock("siyuan", () => ({ fetchSyncPost: vi.fn(), showMessage: vi.fn() }));
vi.mock("../../ui/Notify", () => ({ notifyError: vi.fn(), notifyInfo: vi.fn() }));
vi.mock("../../ui/KnowPicker", () => ({
    openKnowPicker: (o: { onConfirm(ids: string[]): void }) => o.onConfirm(["root"]),
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
