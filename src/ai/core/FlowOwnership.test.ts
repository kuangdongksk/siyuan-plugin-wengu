import { describe, expect, it } from "vitest";
import { decideEntryOf, flowOwnershipOf, ownershipSegsOf } from "./FlowOwnership";
import type { AiSessionRecord } from "../data/AiSessions";
import { AI_STOPPED } from "../data/AiSessions";
import zh from "../../i18n/zh-CN.json";
import en from "../../i18n/en.json";

/** 造一条记录（只填判定用到的字段）。 */
function rec(kind: string, status: AiSessionRecord["status"] = "running", error?: string): AiSessionRecord {
    return { id: "s1", kind, title: "t", model: "m", createdAt: 0, status, turns: [], ...(error ? { error } : {}) };
}

const t = (k: string): string => k; // 取词替身：断言键而非译文

/**
 * **成句级断言用**的取词替身：走真实 i18n 表（段键断言用上面的 `t`，
 * 成句断言必须拿真译文——段键序列全对而拼出来的句子仍是坏的，正是
 * Issue #93 复审抓到的形态：`aiOwnBody` 的开引号与 `aiOwnTail` 的闭引号
 * 在 accent 段被省后相撞成空引号对，且停止态还在被下停止指令）。
 */
const realT =
    (dict: Record<string, string>, flowName = "F") =>
    (k: string): string =>
        (dict[k] ?? k).replace(/\{(\w+)\}/g, (_, n: string) => (n === "flow" ? flowName : `{${n}}`));

/**
 * **幽灵键锁**用取词替身：与 `realT` 同译文，另**记账被请求过的键**。
 *
 * 插件的真取词口径是 `i18n[key] || key`（`quiz/index.ts` 的 `this.t`、
 * `ui/SettingsDialog.ts`、`companion/core/CompanionCtl.ts` 同款）——
 * **键不存在（或值为空串）时回落键名**。于是 `const tail = t("某键");
 * if (tail) …` 这种「靠空值判不渲染」的写法会**把字面键名渲染进面板**：
 * `if` 拿到的是 truthy 的键名本身。这正是本单第二处复审缺陷的形态
 * （Issue #93）。
 */
const trackingT = (dict: Record<string, string>, flowName = "F"): { asked: string[]; t: (k: string) => string } => {
    const asked: string[] = [];
    const inner = realT(dict, flowName);
    return {
        asked,
        t: (k: string): string => {
            asked.push(k);
            return inner(k);
        },
    };
};

/** 段拼成整串（成句断言的输入）。 */
const join = (segs: { text: string }[]): string => segs.map((x) => x.text).join("");

/**
 * 记录级停止钮退役的口径锁定（Issue #77 回归测试 2）：**kind × 状态矩阵**
 * ——多调用流（转换族 + 六批流）在 running 下出归属说明；单调用流一律
 * 无停止 UI；done/error 无说明（没有在跑的东西可停）。
 */
describe("记录详情的流归属说明（停止钮白名单）", () => {
    it("转换族 running：出通用归属说明（指向上方横幅）", () => {
        for (const k of ["convert", "detect"]) {
            const own = flowOwnershipOf(rec(k));
            expect(own.kind).toBe("convert");
            expect(ownershipSegsOf(t, own).map((s) => s.text)).toEqual([
                "aiOwnHeadConvert",
                "aiOwnBody",
                "aiFlowStopBatch",
                "aiOwnTail",
            ]);
        }
    });

    it("六批流 running：出带流名的归属说明", () => {
        expect(flowOwnershipOf(rec("route"))).toEqual({ kind: "batch", flowKey: "aiFlowTitleMatch" });
        expect(flowOwnershipOf(rec("tag"))).toEqual({ kind: "batch", flowKey: "aiFlowTitleTag" });
        expect(flowOwnershipOf(rec("regen"))).toEqual({ kind: "batch", flowKey: "aiFlowTitleRegen" });
        expect(flowOwnershipOf(rec("outline"))).toEqual({ kind: "batch", flowKey: "aiFlowTitleOutline" });
        expect(ownershipSegsOf(t, flowOwnershipOf(rec("tag"))).map((s) => s.text)).toEqual([
            "aiOwnHeadBatch",
            "aiOwnBody",
            "aiFlowStop",
            "aiOwnTail",
        ]);
    });

    it("分段形态照 gap-list A7：首句加粗、入口词主色（其余普通正文）", () => {
        const segs = ownershipSegsOf(t, flowOwnershipOf(rec("convert")));
        expect(segs.map((s) => [s.bold === true, s.accent === true])).toEqual([
            [true, false],
            [false, false],
            [false, true],
            [false, false],
        ]);
    });

    it("单调用流 running：**不出任何停止 UI**（无说明行）", () => {
        // jev（Issue #201 验收 2）：判定记录也不出停止钮——它不在任何
        // 多调用流的白名单里（判定没有可停的整批流），故走 none 分支。
        for (const k of ["judge", "word", "ask", "analyze", "jev", ""]) {
            expect(flowOwnershipOf(rec(k))).toEqual({ kind: "none" });
            expect(ownershipSegsOf(t, flowOwnershipOf(rec(k)))).toEqual([]);
        }
    });

    it("done/error：无说明（没在跑的东西可停）", () => {
        expect(flowOwnershipOf(rec("convert", "done"))).toEqual({ kind: "none" });
        expect(flowOwnershipOf(rec("route", "error"))).toEqual({ kind: "none" });
        expect(flowOwnershipOf(rec("route", "error", "超时"))).toEqual({ kind: "none" });
        expect(flowOwnershipOf(undefined)).toEqual({ kind: "none" });
        expect(ownershipSegsOf(t, { kind: "none" })).toEqual([]);
    });

    /**
     * 被停止的记录（Issue #88）：设计稿 ai-panel-stopped 屏的 own-note 不是
     * 「去哪停」而是「已随整批停下、抉择在哪」——两态文案必须分开，否则用户
     * 已经停了还在被指路「请去停止」。
     *
     * ⚠️ Issue #92 把这段文案从**整串**改成**分段**（A7 的首句加粗 + 正文 +
     * 入口词主色），但 #88 的**两态语义**原样保留：首段（加粗位）取
     * `aiOwnStopped*`（与在途态不同句），且停止态**不出」停止」动作词**
     * （用户已经停过了，动作是页内抉择）。
     */
    it("被停止（error + AI_STOPPED 哨兵）：出停止后的归属说明，且与在途文案不同", () => {
        const conv = flowOwnershipOf(rec("convert", "error", AI_STOPPED));
        expect(conv).toEqual({ kind: "stoppedConvert" });
        const segs = ownershipSegsOf(t, conv);
        // ⚠️ 停止态**不与在途态共用 body/tail**（Issue #93 复审必修）：
        // 共用时 accent 段被省 ⇒ 开/闭引号相撞成空引号对。
        expect(segs.map((s) => s.text)).toEqual(["aiOwnStoppedConvert", "aiOwnStoppedBody", "aiOwnStoppedTail"]);
        expect(segs.some((s) => s.text.startsWith("aiFlowStop"))).toBe(false);
        expect(segs.some((s) => s.accent === true)).toBe(false);
        expect(segs[0].bold).toBe(true);
        // 与在途态（同一记录 kind、只是没被停）逐段不同——不指错路
        expect(segs.map((s) => s.text)).not.toEqual(
            ownershipSegsOf(t, flowOwnershipOf(rec("convert"))).map((s) => s.text)
        );

        const batch = flowOwnershipOf(rec("tag", "error", AI_STOPPED));
        expect(batch).toEqual({ kind: "stoppedBatch", flowKey: "aiFlowTitleTag" });
        // 六批流没有抉择入口 ⇒ **自有正文**（不指路转换条，那是另一条流的
        // 入口）；批流支**不收尾、也不读收尾键**（故两段）——正文本身已是
        // 一句完整交代（含句末收束）。成句形态由下一条用例按真译文锁。
        expect(ownershipSegsOf(t, batch).map((s) => s.text)).toEqual(["aiOwnStoppedBatch", "aiOwnStoppedBatchBody"]);
    });

    /**
     * **成句级锁定**（Issue #93 复审加）：段键序列正确**不等于**拼出来的
     * 句子正确——上一条用例全绿而真机文案带病（空引号对 + 停止态被下停止
     * 指令）。故这里拿**真实 i18n** 拼串，逐条断言：
     *  1. 停止态**不含停止指令**（「要停止请用…」/`use the … stop`）；
     *  2. 停止态**无空引号对、无不配对引号**；
     *  3. 在途态的四段形态与配对引号照旧（防止修停止态时把它改坏）；
     *  4. **无幽灵键**：段拼接结果里不得出现任何被请求过的 i18n 键名
     *     ——`t = i18n[k] || k` 的回落会把缺键/空值键的字面键名渲染给用户。
     */
    it("拼成整句后：停止态不含停止指令、无空引号对、不泄漏键名；在途态引号仍配对", () => {
        const STOP_HINT = [/要停止请/, /不可单独中止/, /use the .*stop/i, /can't be stopped/i];
        const EMPTY_QUOTES = ["「」", "“”", "『』", '""', "''"];
        const PAIRS: [string, string][] = [
            ["「", "」"],
            ["“", "”"],
            ["『", "』"],
        ];

        for (const [name, dict] of [
            ["zh", zh],
            ["en", en],
        ] as [string, Record<string, string>][]) {
            for (const kind of ["convert", "tag"] as const) {
                const own = flowOwnershipOf(rec(kind, "error", AI_STOPPED));
                // 4) 幽灵键：请求过的每个键都必须真实在表且非空串——否则
                //    `t = i18n[k] || k` 会回落键名，把它当正文渲染给用户。
                const probe = trackingT(dict, dict.aiFlowTitleTag);
                const segs = ownershipSegsOf(probe.t, own);
                const text = join(segs);
                expect(probe.asked.length, `${name}/${kind} 未请求任何键`).toBeGreaterThan(0);
                for (const k of probe.asked) {
                    expect(dict[k], `${name}/${kind} 幽灵键（缺失）: ${k}`).toBeTypeOf("string");
                    expect(dict[k], `${name}/${kind} 幽灵键（空串，会被 || 回落成键名）: ${k}`).not.toBe("");
                    expect(text, `${name}/${kind} 整串里泄漏了键名 ${k}`).not.toContain(k);
                }
                // 1) 不得给一条已停止的记录下停止指令（#88 两态语义）
                for (const re of STOP_HINT) expect(text, `${name}/${kind} 含停止指令: ${text}`).not.toMatch(re);
                // 2) 空引号对（accent 段被省后开/闭引号相撞的形态）
                for (const q of EMPTY_QUOTES) expect(text, `${name}/${kind} 空引号对: ${text}`).not.toContain(q);
                // 3) 引号配平
                for (const [open, close] of PAIRS) {
                    const a = text.split(open).length - 1;
                    const b = text.split(close).length - 1;
                    expect(a, `${name}/${kind} 引号不配对(${open}${close}): ${text}`).toBe(b);
                }
                expect(text.length).toBeGreaterThan(0);
            }

            // 在途态四段照旧：含停止指令（那正是它的职责）+ 引号配对
            const probe = trackingT(dict, dict.aiFlowTitleTag);
            const inflight = join(ownershipSegsOf(probe.t, flowOwnershipOf(rec("convert"))));
            expect(inflight).toMatch(/stop|停止/i);
            for (const [open, close] of PAIRS) {
                const a = inflight.split(open).length - 1;
                const b = inflight.split(close).length - 1;
                expect(a, `${name} 在途态引号不配对: ${inflight}`).toBe(b);
            }
            for (const k of probe.asked) expect(dict[k], `${name} 在途态幽灵键: ${k}`).toBeTypeOf("string");
        }
    });

    it("抉择入口只属转换族（六批流停下即停下，没有保留/丢弃二选一）", () => {
        expect(decideEntryOf(flowOwnershipOf(rec("convert", "error", AI_STOPPED)))).toBe(true);
        expect(decideEntryOf(flowOwnershipOf(rec("detect", "error", AI_STOPPED)))).toBe(true);
        expect(decideEntryOf(flowOwnershipOf(rec("tag", "error", AI_STOPPED)))).toBe(false);
        expect(decideEntryOf({ kind: "none" })).toBe(false);
        // 在途态也不出（在途的归属备注是「去哪停」，不是「去哪抉择」）
        expect(decideEntryOf(flowOwnershipOf(rec("convert")))).toBe(false);
    });

    it("哨兵只对多调用流白名单出说明；单调用流被中止仍当作普通收口（无说明）", () => {
        expect(flowOwnershipOf(rec("judge", "error", AI_STOPPED))).toEqual({ kind: "none" });
        expect(flowOwnershipOf(rec("word", "error", AI_STOPPED))).toEqual({ kind: "none" });
    });
});
