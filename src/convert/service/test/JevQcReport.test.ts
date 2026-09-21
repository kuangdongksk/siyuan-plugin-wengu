import { describe, expect, it } from "vitest";
import { jevQcLines, showJevQc } from "../../ui/JevQcReport";
import { qcSummary } from "../../../ai/jev/convertChecks";
import type { ConvertQc } from "../run/ConvertBatch";
import zh from "../../../i18n/zh-CN.json";
import { read } from "../../../testkit/readSource";

/**
 * 报告标注（Issue #184 需求 3）：`qc` 缺键/无存疑时**一个字符都不给**
 * （转换条文案逐字不变），有存疑时给出「哪一项存疑 + 一句原因」。
 */

const t = (k: string): string => k;

const qc = (suspects: ConvertQc["suspects"]): ConvertQc => ({ checked: 3, suspects });

describe("Jev 质检报告行", () => {
    it("无 qc / 无存疑 → 空串（调用方零追加）", () => {
        expect(jevQcLines(t, undefined)).toBe("");
        expect(jevQcLines(t, qc([]))).toBe("");
    });

    it("有存疑 → 带「哪一项 + 一句原因」的逐行标注", () => {
        const s = jevQcLines(t, qc([{ reason: "derive", clear: true, items: [] }]));
        expect(s).toContain("jevQcSuspect"); // 汇总头
        expect(s).toContain("jevQcClear"); // 明确踩雷的措辞
        expect(s).toContain("jevQcDerive"); // 具体是哪一项
    });

    it("**真字典**渲染时不留字面 `{n}`**（回归：曾把占位符原样拼进模板串）", () => {
        // 这是真机可见的缺陷：报告行里显示「Jev 存疑（已判定 {n} 题）3 题，…」，
        // 因为键值里的 `{n}` 没经 `fmt` 就被拼进字符串。
        const real = (k: string): string => (zh as Record<string, string>)[k] ?? k;
        const s = jevQcLines(real, qc([{ reason: "derive", clear: true, items: [] }]));
        expect(s).not.toContain("{n}");
        expect(s).toContain("已判定 3 题"); // 题数是真数
        expect(s).toContain("答案可能无法仅凭这段材料推出"); // 一句原因是人话
    });

    it("同一毛病重复出现 → 报告里只说一次（逐批判定会重复）", () => {
        const s = jevQcLines(
            t,
            qc([
                { reason: "derive", clear: true, items: [] },
                { reason: "derive", clear: true, items: [] },
                { reason: "derive", clear: true, items: [] },
            ])
        );
        expect(s.split("\n")).toHaveLength(2); // 头 + 一条明细（不是四条）
    });

    it("低置信用「拿不准」措辞（与明确踩雷分开）", () => {
        const s = jevQcLines(t, qc([{ reason: "quality", clear: false, items: [] }]));
        expect(s).toContain("jevQcUnsure");
        expect(s).not.toContain("jevQcClear");
    });

    it("与完成消息尾巴同源（qcSummary 的「有一项」与报告行说的是同一件事）", () => {
        const suspects: ConvertQc["suspects"] = [{ reason: "unique", clear: true, items: [] }];
        expect(qcSummary(t, { checked: 3, suspects })).toContain("jevQcSuspect");
        expect(jevQcLines(t, qc(suspects))).toContain("jevQcSuspect");
    });
});

/** 只实现 `querySelector`/`innerHTML` 的最小 DOM 替身（node 环境无 document）。 */
function slotEl(): { el: HTMLElement; html: () => string; hidden: () => boolean } {
    const slot = {
        innerHTML: "",
        hidden: true,
        removeAttribute: (): void => {
            slot.hidden = false;
        },
    };
    const el = { querySelector: (): unknown => slot } as unknown as HTMLElement;
    return { el, html: () => slot.innerHTML, hidden: () => slot.hidden };
}

describe("报告行写入位置（Issue #184 复核）", () => {
    it("写进**宿主元素**的槽、unhide；无存疑时零动作", () => {
        const { el, html, hidden } = slotEl();
        showJevQc(el, t, qc([{ reason: "derive", clear: true, items: [] }]));
        expect(html()).toContain("wengu-jev-qc");
        expect(hidden()).toBe(false);
        // 无存疑：一个字符都不写
        const fresh = slotEl();
        showJevQc(fresh.el, t, qc([]));
        expect(fresh.html()).toBe("");
    });

    it("**不用全局 document**（源码级契约：槽一律从宿主元素取）", async () => {
        // 回归：曾直接 `document.querySelector("[data-status]")`——多页签/面板
        // 并存时会写到**第一个**匹配的槽（= 别的视图）上，报告行就长在别处。
        const src = await read("/src/convert/ui/JevQcReport.ts");
        expect(src).toContain("el?.querySelector<HTMLElement>");
        expect(src).not.toContain("document.querySelector");
    });
});
