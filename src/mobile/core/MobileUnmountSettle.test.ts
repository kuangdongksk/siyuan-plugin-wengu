import { describe, expect, it } from "vitest";
import { fakeBank, fakeHistory, make, q, seedSet } from "./MobileDrillHarness";
import { mockDoc } from "./MobileResumeMock";
import { initialMobileUi, MobileDrill } from "./MobileDrill";

/**
 * 移动端**卸载结算**（Issue #169 调查项，Issue #173 接线）：`MobileDrill.destroy`
 * → `core/MobileRound.settleOnUnmount`（停走秒 + 结算用时 + 擦不可恢复的空轮）。
 *
 * 自 `MobileDrillResume.test.ts` 拆出（Issue #173，#135 行数门禁）：那边是
 * 「继续上次」的探测/快照/落点 + 做题屏返回的弃轮擦除，本片单收**卸载**这一条
 * 链，两片都在 500 行红线内。
 *
 * ⚠️ 接线两条路各自必达、互不触发（Svelte `unmount()` 只销毁组件、不跑 dock
 * destroy）：壳组件 `onDestroy` → `drill.destroy()` 覆盖真机实际销毁路径
 * （dock init 重入先卸旧实例）；`Docks` 的 dock destroy → `drillCtl.destroy()`
 * 是兜底路。故 `destroy` 必须**幂等**（本片末例锁住）。
 * 接线的源级契约锁在 `quiz/render/RoundReport.contract.test.ts`。
 */
describe("卸载结算：destroy（Issue #169 调查项 / #173 接线）", () => {
    function set1Fixture() {
        const m = make();
        seedSet(m.face, "set1", [q("set1/a"), q("set1/b")]);
        m.ui.home = {
            loading: false,
            error: "",
            sets: [mockDoc("set1", "卷一")],
            activeSetId: "set1",
            activeSetTitle: "卷一",
        };
        m.ui.fullList = [q("set1/a"), q("set1/b")];
        return m;
    }

    it("空轮卸载：抹掉盘上那条 0 作答记录并清内存态", () => {
        const { drill, ui, removes } = set1Fixture();
        drill.start("fresh");
        const id = ui.session!.id;
        drill.destroy();
        expect(removes).toContain(id);
        expect(ui.session).toBeUndefined();
    });

    it("有作答卸载：**不擦、不封卷**（留作「继续上次」，写 endedAt 就变已收卷轮）", async () => {
        const { drill, ui, removes, upserts } = set1Fixture();
        drill.start("fresh");
        drill.pickLetter("A");
        await drill.submit();
        const id = ui.session!.id;
        drill.destroy();
        expect(removes).not.toContain(id);
        expect(ui.session?.endedAt).toBeUndefined();
        expect(upserts).toContain(ui.session); // 结算用时照旧落盘
    });

    it("已收卷（报告屏）卸载：不擦（报告还要看）", () => {
        const { drill, ui, removes } = set1Fixture();
        drill.start("fresh");
        drill.pickLetter("A");
        drill.endRound();
        const id = ui.session!.id;
        drill.destroy();
        expect(removes).not.toContain(id);
    });

    /** 与 `make` 同款，只是给控制器注入走秒宿主替身——node 环境无 `window`，
     *  注入后才起得来表，「卸载必达 `stopTicker`」才可从外部观测（#173）。 */
    function fixtureWithTicker() {
        const face = fakeBank();
        const { store, upserts, removes } = fakeHistory();
        const ui = initialMobileUi();
        const cleared: number[] = [];
        let id = 0;
        const drill = new MobileDrill(
            ui,
            { i18n: {}, bank: face.bank, history: store, settings: { showNums: true } } as never,
            {
                setInterval: (): number => ++id,
                clearInterval: (h: number): void => void cleared.push(h),
            }
        );
        return { drill, ui, face, upserts, removes, cleared };
    }

    it("卸载必达 stopTicker：走秒 interval 被清、句柄置空（泄漏清零）", () => {
        const { drill, ui, face, cleared } = fixtureWithTicker();
        seedSet(face, "set1", [q("set1/a"), q("set1/b")]);
        ui.home = {
            loading: false,
            error: "",
            sets: [mockDoc("set1", "卷一")],
            activeSetId: "set1",
            activeSetTitle: "卷一",
        };
        ui.fullList = [q("set1/a"), q("set1/b")];
        drill.start("fresh");
        drill.pickLetter("A");
        expect(cleared).toEqual([]); // 起表后仅一枚 interval 在跑
        drill.destroy();
        expect(cleared).toEqual([1]); // 卸载这一下把它清了
        drill.destroy(); // 幂等：无表可停不报错、不重复清（同一句柄不二次 clear）
        expect(cleared).toEqual([1]);
    });

    it("有作答卸载：结算用时落盘、**仍不写 endedAt**（与第二条同口径，带表跑）", async () => {
        const { drill, ui, face, upserts, removes, cleared } = fixtureWithTicker();
        seedSet(face, "set1", [q("set1/a"), q("set1/b")]);
        ui.home = {
            loading: false,
            error: "",
            sets: [mockDoc("set1", "卷一")],
            activeSetId: "set1",
            activeSetTitle: "卷一",
        };
        ui.fullList = [q("set1/a"), q("set1/b")];
        drill.start("fresh");
        drill.pickLetter("A");
        await drill.submit();
        const id = ui.session!.id;
        drill.destroy();
        expect(cleared).toEqual([1]);
        expect(removes).not.toContain(id);
        expect(ui.session?.endedAt).toBeUndefined();
        expect(upserts).toContain(ui.session);
    });

    it("卸载前未起轮：无会话可结算（stopTicker 空转、零落盘零擦除）", () => {
        const { drill, upserts, removes, cleared } = fixtureWithTicker();
        drill.destroy();
        expect(cleared).toEqual([]); // 没起表就没什么可清
        expect(upserts).toEqual([]);
        expect(removes).toEqual([]);
    });
});
