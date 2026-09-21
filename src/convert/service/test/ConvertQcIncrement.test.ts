import { describe, expect, it, vi } from "vitest";
import type { BankData, QuestionBank } from "../../../bank/data/QuestionBank";
import { QuestionBank as Bank } from "../../../bank/data/QuestionBank";
import { SetWriter } from "../output/SetWriter";
import type { DraftUnit } from "../draft/QuestionDraft";
import type { StructChunk } from "../source/SrcChunk";

/**
 * 增量重转换的质检接线（Issue #184）：判定**逐块、先于落库**，且
 * 无存疑/未启用时 `IncrementOutcome` 里**没有 `qc` 键**（既有终态文案
 * 与调用方分支逐字节不变）。
 */

(globalThis as { window?: unknown }).window ??= globalThis;

const jev = { calls: 0, body: "" };

vi.mock("../../../ai/jev/transport", async (importOriginal) => {
    const mod = (await importOriginal()) as Record<string, unknown>;
    return {
        ...mod,
        kernelProxyTransport: async () => {
            jev.calls++;
            return { status: 200, body: jev.body };
        },
    };
});

vi.mock("../../../ai/client", () => ({
    newAiGroupId: () => "g-test",
    aiStopHandle: (signal: AbortSignal) => ({ signal, onSid: (): void => undefined }),
    agentChatOnce: vi.fn(async () => REPLY),
}));

const REPLY = `@@Q type=single
@@P stem
求 $\\lim_{x \\to 0}\\frac{\\sin x}{x}$。
@@P opt
$1$
@@P opt
$0$
@@P ans
A
@@P sol
等价无穷小。
@@END`;

const okBody = JSON.stringify({
    answers: {
        q0: { noul: 0.95 },
        q1: { noul: 0.9 },
        q2: { noul: 0.92 },
        q3: { noul: 0.88 },
        q4: { score: 5, confidence: 0.9 },
    },
});
const badBody = JSON.stringify({
    answers: {
        q0: { noul: 0.95 },
        q1: { noul: 0.1 },
        q2: { noul: 0.92 },
        q3: { noul: 0.88 },
        q4: { score: 5, confidence: 0.9 },
    },
});

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

import { convertIncremental } from "../run/ConvertIncrement";

/** 起一个空题集（增量链追加到既有题集）。 */
async function setup(): Promise<{ bank: QuestionBank; setId: string }> {
    const bank = newBank();
    const setId = await new SetWriter(bank).openSet({ title: "题集", srcId: "doc-1" });
    await bank.flush();
    return { bank, setId };
}

const chunk = (key: string, hash: string): StructChunk =>
    ({ key, hash, text: "块正文：" + "内容-".repeat(40) }) as unknown as StructChunk;

async function runIncr(settings?: { jevKey?: string; jevEnabled?: boolean }) {
    const { bank, setId } = await setup();
    const res = await convertIncremental({
        deleteQids: [],
        staleQids: [],
        chunks: [chunk("H:第一章", "h1"), chunk("H:第二章", "h2")],
        setId,
        bank,
        modelId: "m",
        fillToChoice: false,
        bigToSteps: false,
        ...(settings ? { settingsOf: () => settings } : {}),
    });
    return { res, bank };
}

describe("增量链质检（Issue #184）", () => {
    it("无 key：结果无 `qc` 键、零判定请求", async () => {
        jev.calls = 0;
        const { res } = await runIncr();
        expect(res.added).toBeGreaterThan(0);
        expect("qc" in res).toBe(false);
        expect(jev.calls).toBe(0);
    });

    it("全过：无 `qc` 键（不往终态文案里加噪）", async () => {
        jev.calls = 0;
        jev.body = okBody;
        const { res } = await runIncr({ jevKey: "sk-test" });
        expect(jev.calls).toBe(2); // 逐块判定（两块）
        expect("qc" in res).toBe(false);
    });

    it("踩雷：`qc` 只收有存疑的块，且题照常入库（只标不删）", async () => {
        jev.calls = 0;
        jev.body = badBody;
        const { res, bank } = await runIncr({ jevKey: "sk-test" });
        expect(res.qc?.suspectChunks).toBe(2);
        expect(res.qc?.reports.map((x) => x.index)).toEqual([0, 1]);
        const data = await bank.all();
        expect(Object.keys(data.records).length).toBe(res.added);
    });

    it("判定失败：静默跳过（`qc` 无键），增量产物照旧", async () => {
        jev.calls = 0;
        jev.body = JSON.stringify({ answers: {} }); // 协议错 ⇒ 本模块接住
        const { res } = await runIncr({ jevKey: "sk-test" });
        expect("qc" in res).toBe(false);
        expect(res.added).toBeGreaterThan(0);
    });

    it("总开关关：零请求", async () => {
        jev.calls = 0;
        jev.body = badBody;
        const { res } = await runIncr({ jevKey: "sk-test", jevEnabled: false });
        expect(jev.calls).toBe(0);
        expect("qc" in res).toBe(false);
    });
});
