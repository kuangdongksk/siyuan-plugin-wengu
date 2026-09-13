import { describe, expect, it, vi } from "vitest";
import { ConvertPanelCtl } from "../ConvertPanelCtl";
import { ConvertDialogCtl } from "../ConvertDialogCtl";
import { initialConvertDialogUi } from "../ConvertDialogUi";
import type { ConvertProgressRecord } from "../../service/run/ConvertBatch";
import type { ConvertDialogDeps } from "../../ui/ConvertDialog";
import type { ConvertPanelDeps } from "../../ui/ConvertPanel";
import type { ConvertRunCfg } from "../../service/run/ConvertRun";

/**
 * 批量转换「继续生成」链路（Issue #62）：面板恢复整个队列 + 弹窗队列口径。
 *
 * 单测只碰编排层（内核 IO/AI 不进单测）：
 *  1. 面板带 `batch.rootId` 的记录 → 预填**队列根**且标记 resumeQueue；
 *  2. 单篇记录 / 存量队列记录（无 rootId）→ 仍预填该篇、单篇续跑；
 *  3. 弹窗：**单篇**记录（无 batch 键）不展开队列；**带 batch** 的记录照常
 *     展开队列且 `cfg.resume` 不传（逐篇自查），并透传 reconvertDone。
 */

vi.mock("../../service/source/SubDocs", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../../service/source/SubDocs")>();
    return {
        ...orig,
        planSubDocs: vi.fn(async () => ({
            root: { id: "20260828145729-00000000", title: "卷" },
            children: [
                { id: "20260828145730-aaaaaaaa", title: "01" },
                { id: "20260828145731-bbbbbbbb", title: "02" },
            ],
            rootEmpty: true,
        })),
        // 生产实现会把「根空壳」展开成全部子文档——这里保留真实实现即可，
        // 只把探查结果换成可复现的固定清单
    };
});
vi.mock("../../service/core/ConvertService", async (importOriginal) => {
    const orig = await importOriginal<typeof import("../../service/core/ConvertService")>();
    return {
        ...orig,
        getDocInfo: vi.fn(async () => ({ title: "卷", hPath: "/卷", notebook: "box", id: "x" })),
    };
});

const ROOT = "20260828145729-00000000";
const rec = (batch?: ConvertProgressRecord["batch"]): ConvertProgressRecord => ({
    setId: "set-1",
    title: "01",
    offset: 100,
    batches: 2,
    total: 2,
    count: 5,
    ...(batch ? { batch } : {}),
});

function panelDeps(records: { srcDocId: string; rec: ConvertProgressRecord }[]): {
    deps: ConvertPanelDeps;
    resumed: { srcDocId: string; queue?: boolean }[];
} {
    const resumed: { srcDocId: string; queue?: boolean }[] = [];
    return {
        resumed,
        deps: {
            t: (k: string): string => k,
            listProgress: () => records,
            discardProgress: (): void => undefined,
            resumeProgress: (srcDocId: string, queue?: boolean): void => {
                resumed.push({ srcDocId, queue });
            },
        },
    };
}

describe("ConvertPanelCtl.resume（Issue #62）", () => {
    it("带 batch.rootId 的记录恢复整个队列（预填根 + resumeQueue 标记）", () => {
        const { deps, resumed } = panelDeps([
            { srcDocId: "20260828145731-bbbbbbbb", rec: rec({ index: 1, total: 2, rootId: ROOT }) },
        ]);
        const ctl = new ConvertPanelCtl();
        ctl.attach({ armedDoc: "" } as never, deps, () => undefined);
        ctl.resume("20260828145731-bbbbbbbb");
        ctl.detach();
        expect(resumed).toEqual([{ srcDocId: ROOT, queue: true }]);
    });

    it("单篇记录（无 batch 键）仍预填该篇", () => {
        const { deps, resumed } = panelDeps([{ srcDocId: "20260828145731-bbbbbbbb", rec: rec() }]);
        const ctl = new ConvertPanelCtl();
        ctl.attach({ armedDoc: "" } as never, deps, () => undefined);
        ctl.resume("20260828145731-bbbbbbbb");
        ctl.detach();
        expect(resumed).toEqual([{ srcDocId: "20260828145731-bbbbbbbb", queue: false }]);
    });

    it("存量队列记录（带 batch 但无 rootId）退化为单篇预填", () => {
        const { deps, resumed } = panelDeps([
            { srcDocId: "20260828145731-bbbbbbbb", rec: rec({ index: 1, total: 2 }) },
        ]);
        const ctl = new ConvertPanelCtl();
        ctl.attach({ armedDoc: "" } as never, deps, () => undefined);
        ctl.resume("20260828145731-bbbbbbbb");
        ctl.detach();
        expect(resumed).toEqual([{ srcDocId: "20260828145731-bbbbbbbb", queue: false }]);
    });
});

function dialogDeps(records: Record<string, ConvertProgressRecord>): {
    deps: ConvertDialogDeps;
    started: ConvertRunCfg[];
    docs: string[];
} {
    const started: ConvertRunCfg[] = [];
    const docs: string[] = [];
    return {
        started,
        docs,
        deps: {
            t: (k: string): string => k,
            activeDocId: "",
            initialModelId: "",
            initialFillToChoice: false,
            initialBigToSteps: false,
            initialParallel: 1,
            initialKnowRoots: "",
            saveChoice: (): void => undefined,
            getProgress: (id: string) => records[id],
            setConverting: (): void => undefined,
            startRun: (cfg: ConvertRunCfg): boolean => {
                started.push(cfg);
                return true;
            },
            isRunning: (): boolean => false,
            openPanel: (): void => undefined,
        },
    };
}

/** 等弹窗内的异步探查（子文档 + 回显）落定（多层 await 链，多轮 tick）。 */
const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("ConvertDialogCtl.start 队列口径（Issue #62）", () => {
    it("单篇续跑记录不展开队列（cfg.resume 照传）", async () => {
        const { deps, started } = dialogDeps({ [ROOT]: rec() });
        const ctl = new ConvertDialogCtl();
        const ui = initialConvertDialogUi();
        ctl.attach(ui, deps, () => undefined);
        ctl.setDocId(ROOT);
        await settle();
        ctl.start(rec());
        ctl.detach();
        expect(started.length).toBe(1);
        expect(started[0].subDocs).toBeUndefined();
        expect(started[0].resume).toEqual({ offset: 100, setId: "set-1" });
    });

    it("带 batch 的记录走队列且不传 resume（逐篇自查续跑）", async () => {
        const { deps, started } = dialogDeps({ [ROOT]: rec({ index: 0, total: 2, rootId: ROOT }) });
        const ctl = new ConvertDialogCtl();
        const ui = initialConvertDialogUi();
        // resumeQueue=true：本次打开来自面板的队列恢复
        ctl.attach(ui, { ...deps, resumeQueue: true }, () => undefined);
        ctl.setDocId(ROOT);
        await settle();
        // 队列恢复自动勾上「连同子文档」，弹窗直接展开整个队列
        expect(ui.includeSub).toBe(true);
        ctl.start(rec({ index: 0, total: 2, rootId: ROOT }));
        ctl.detach();
        expect(started.length).toBe(1);
        expect(started[0].resume).toBeUndefined();
        expect(started[0].subDocs?.length).toBeGreaterThan(0);
        expect(started[0].reconvertDone).toBe(false);
    });
});
