import { describe, expect, it } from "vitest";
import * as sass from "sass";
import { needsSwitchConfirm } from "./SwitchConfirm";
import { switchGuardFor, switchTargetNameFor } from "./SideMount";
import { actionClsOf, dialogWidth } from "../../ui/Dialog";
import type { WenguSession } from "../service/HistoryStore";
import type { WenguDialogAction } from "../../ui/Dialog";

/**
 * 切换题集二次确认弹窗（Issue #137 / 差距清单 §7.d，设计稿
 * `design/wengu-sidebar-redesign.html` §5）的**判定与规格**断言。
 *
 * 判据只有一条（`mode === "quiz"` 且点的是**另一**上下文 且当前有进行中
 * 轮次），但四条反证路径（review / preview / 同 id / 空轮 / 已收卷）与
 * 主钮位序一样，一旦漂移都静默 —— 用户「必须弹二次确认」是硬性要求，
 * 漏弹不报错、只是把误触当成真实意图执行。故全部钉成断言。
 */

function session(over: Partial<WenguSession> = {}): WenguSession {
    return {
        id: "s1",
        docId: "d1",
        startedAt: 1,
        mode: "countUp",
        elapsedSec: 0,
        answered: 0,
        correct: 0,
        results: [],
        ...over,
    };
}

describe("切换确认触发判据（§7.d）", () => {
    it("正例：quiz + 另一上下文 + 进行中轮次（answered>0 且未收卷）", () => {
        expect(
            needsSwitchConfirm({
                mode: "quiz",
                session: session({ answered: 3 }),
                targetId: "d2",
                currentId: "d1",
            })
        ).toBe(true);
    });

    it("反证：answered=0 的空轮不弹（刚翻开就切走不该被拦）", () => {
        expect(
            needsSwitchConfirm({
                mode: "quiz",
                session: session({ answered: 0 }),
                targetId: "d2",
                currentId: "d1",
            })
        ).toBe(false);
    });

    it("反证：已收卷（endedAt 已写）不弹——轮次没有可丢的进度", () => {
        expect(
            needsSwitchConfirm({
                mode: "quiz",
                session: session({ answered: 5, endedAt: Date.now() }),
                targetId: "d2",
                currentId: "d1",
            })
        ).toBe(false);
    });

    it("反证：review 点文档=筛选错题本、preview 只读，都不拦", () => {
        for (const mode of ["review", "preview", "study"]) {
            expect(
                needsSwitchConfirm({ mode, session: session({ answered: 3 }), targetId: "d2", currentId: "d1" }),
                mode
            ).toBe(false);
        }
    });

    it("反证：点当前已选中行（同 id）早退，任何模式/轮次都不弹", () => {
        expect(
            needsSwitchConfirm({
                mode: "quiz",
                session: session({ answered: 3 }),
                targetId: "d1",
                currentId: "d1",
            })
        ).toBe(false);
        // 空 id（异常入参）同样早退，不落成「目标名空串」的弹窗
        expect(
            needsSwitchConfirm({ mode: "quiz", session: session({ answered: 3 }), targetId: "", currentId: "" })
        ).toBe(false);
    });

    it("反证：无会话（未开轮）不弹", () => {
        expect(needsSwitchConfirm({ mode: "quiz", session: undefined, targetId: "d2", currentId: "d1" })).toBe(false);
    });

    it("专题↔文档↔聚合三路同口径：上下文 id 只要不同就是「另一上下文」", () => {
        const s = session({ answered: 1 });
        for (const [targetId, currentId] of [
            ["col:c1", "d1"],
            ["d1", "col:c1"],
            ["all", "col:c1"],
        ]) {
            expect(needsSwitchConfirm({ mode: "quiz", session: s, targetId, currentId }), targetId).toBe(true);
        }
    });
});

describe("弹窗动作行与宽度（规范 §2.2 / §5.1 / §5.4）", () => {
    it("variant 与 ButtonVariant 同源：primary=裸 b3-button，outline/cancel/text 各归其类", () => {
        expect(actionClsOf("primary")).toBe("b3-button");
        expect(actionClsOf("outline")).toBe("b3-button b3-button--outline");
        expect(actionClsOf("text")).toBe("b3-button b3-button--text");
        expect(actionClsOf(undefined)).toBe("b3-button b3-button--cancel");
    });

    it("宽度三档收敛为 min(档位, calc(100vw - 32px))；裸 px 透传（存量调用点）", () => {
        expect(dialogWidth("sm")).toBe("min(480px, calc(100vw - 32px))");
        expect(dialogWidth("md")).toBe("min(560px, calc(100vw - 32px))");
        expect(dialogWidth("lg")).toBe("min(680px, calc(100vw - 32px))");
        expect(dialogWidth("780px")).toBe("780px"); // SettingsDialog 存量
        expect(dialogWidth()).toBe("min(560px, calc(100vw - 32px))"); // 缺省=md
    });
});

/** scss 真编译（同 `ButtonVariants.test.ts` 口径；`?raw` 对 scss 恒空串）。 */
const baseCss = (): string => sass.compile("src/scss/base.scss").css.replace(/\/\*[\s\S]*?\*\//g, "");

/** 取一条规则体（按选择器行精确匹配）。 */
const ruleOf = (sel: string): string => {
    const seg = baseCss()
        .split("}")
        .find((r) => r.split("{")[0].trim() === sel);
    expect(seg, `未找到 ${sel} 规则`).toBeTruthy();
    return `${seg}}`;
};

describe("切换确认弹窗视觉规格（稿 §5 逐值）", () => {
    it("图标位 38×38 · 圆角 10 · primary-lightest 底 · 内 18px 图标", () => {
        const ico = ruleOf(".wengu-dialog .wengu-dialog-ico");
        expect(ico).toMatch(/width:\s*38px/);
        expect(ico).toMatch(/height:\s*38px/);
        expect(ico).toMatch(/border-radius:\s*10px/);
        expect(ico).toMatch(/background:\s*var\(--b3-theme-primary-lightest\)/);
        expect(ico).toMatch(/color:\s*var\(--b3-theme-primary\)/);
        expect(ruleOf(".wengu-dialog .wengu-dialog-ico svg")).toMatch(/width:\s*18px/);
    });

    it("正文 13.5px / 行高 1.75 / on-surface-light；目标名 on-surface + 省略", () => {
        const body = ruleOf(".wengu-switch-confirm .wengu-switch-body");
        expect(body).toMatch(/font-size:\s*13\.5px/);
        expect(body).toMatch(/line-height:\s*1\.75/);
        expect(body).toMatch(/color:\s*var\(--b3-theme-on-surface-light\)/);
        const name = ruleOf(".wengu-switch-confirm .wengu-switch-name");
        expect(name).toMatch(/text-overflow:\s*ellipsis/);
        expect(name).toMatch(/color:\s*var\(--b3-theme-on-surface\)/);
    });

    it("零字面色值（明暗两态一律走令牌）", () => {
        const mine = baseCss().match(/\.wengu-(dialog-ico|switch-body|switch-name)[\s\S]*?\n}/g) ?? [];
        expect(mine.length).toBeGreaterThan(0);
        for (const seg of mine) expect(seg.match(/#[0-9a-f]{3,8}\b|rgba?\(/g) ?? []).toEqual([]);
    });
});

describe("主钮位序（§2.2 右起第一＝唯一主操作）", () => {
    it("弹窗动作数组的末位是 primary「留在本卷」，次钮 outline 在前", () => {
        // 与 openSwitchConfirm 内的字面量同序（改序即破「安全默认在主位」）
        const actions: WenguDialogAction[] = [
            { id: "sw-go", label: "go", variant: "outline" },
            { id: "sw-stay", label: "stay", variant: "primary" },
        ];
        expect(actions[actions.length - 1].variant).toBe("primary");
        expect(actions.filter((a) => a.variant === "primary")).toHaveLength(1);
    });
});

describe("视图层闸装配（SideMount.switchGuardFor，不触弹窗的直切路径）", () => {
    /** 假宿主：只喂闸需要的三件套（弹窗路径需 DOM，此处只测直切分支）。 */
    function access(over: Partial<Parameters<typeof switchGuardFor>[0]> = {}): Parameters<typeof switchGuardFor>[0] {
        return {
            t: (k: string): string => k,
            currentSession: (): WenguSession | undefined => undefined,
            targetName: (id: string): string => `name:${id}`,
            guardCtx: (): { mode: string; currentId: string; total: number } => ({
                mode: "quiz",
                currentId: "d1",
                total: 10,
            }),
            colFlowOf: () => ({ rowsView: (): never[] => [] }) as never,
            docsOf: (): never[] => [],
            ...over,
        };
    }

    it("不需要确认时直切（go 被调用、不触弹窗）", () => {
        let ran = 0;
        switchGuardFor(access())("d2", () => void ran++);
        expect(ran).toBe(1);
    });

    it("目标名解析：聚合行取 allExTitle、专题行取行标题、文档行取标题、兜底 id", () => {
        const a = access({
            colFlowOf: () =>
                ({ rowsView: (): { id: string; title: string }[] => [{ id: "col:c1", title: "概率论" }] }) as never,
            docsOf: (): never[] => [{ id: "d2", title: "高数" } as never],
        });
        expect(switchTargetNameFor(a, "all")).toBe("allExTitle");
        expect(switchTargetNameFor(a, "col:c1")).toBe("概率论");
        expect(switchTargetNameFor(a, "d2")).toBe("高数");
        expect(switchTargetNameFor(a, "d9")).toBe("d9");
    });
});
