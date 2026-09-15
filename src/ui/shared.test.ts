import { describe, expect, it } from "vitest";
import {
    dayKey,
    errText,
    isLifecycleGone,
    isMobileUi,
    markMobileUi,
    MOBILE_CLASS,
    plainText,
    ratePct,
    SaveChain,
} from "./shared";

describe("errText（思源前端裸对象拒绝 → 人读文案，修 [object Object] 直出）", () => {
    it("Error 取 message；空 message 回落 name", () => {
        expect(errText(new Error("disk full"))).toBe("disk full");
        expect(errText(new Error())).toBe("Error");
    });

    it("3.8.2 saveData 生命周期闸的 {code:410, msg} → msg + code 标注", () => {
        expect(errText({ code: 410, msg: "Plugin lifecycle has ended", data: null })).toBe(
            "Plugin lifecycle has ended [code 410]"
        );
    });

    it("只读闸 {code:403}、无 code 的 {msg}、{message} 形态同样识别", () => {
        expect(errText({ code: 403, msg: "Readonly mode or publish mode", data: null })).toBe(
            "Readonly mode or publish mode [code 403]"
        );
        expect(errText({ msg: "not found" })).toBe("not found");
        expect(errText({ message: "boom" })).toBe("boom");
    });

    it("字符串原样；无 msg/message 的普通对象 JSON 兜底；循环引用 String 兜底", () => {
        expect(errText("raw")).toBe("raw");
        expect(errText({ foo: 1 })).toBe('{"foo":1}');
        const circ: Record<string, unknown> = {};
        circ.self = circ;
        expect(errText(circ)).toBe("[object Object]");
        expect(errText(42)).toBe("42");
    });
});

describe("isLifecycleGone（实例已终止的永久失败，重试循环必须停手）", () => {
    it("code 410 或文案含 lifecycle 判终止；普通错误不误判", () => {
        expect(isLifecycleGone({ code: 410, msg: "Plugin lifecycle has ended" })).toBe(true);
        expect(isLifecycleGone(new Error("plugin lifecycle removal deadline reached"))).toBe(true);
        expect(isLifecycleGone(new Error("disk full"))).toBe(false);
        expect(isLifecycleGone({ code: 403, msg: "Readonly mode" })).toBe(false);
        expect(isLifecycleGone(undefined)).toBe(false);
    });
});

describe("isMobileUi / markMobileUi（Issue #10 环境探测）", () => {
    const host = () => {
        const classes = new Set<string>();
        return {
            classList: {
                add: (c: string): void => void classes.add(c),
                has: (c: string) => classes.has(c),
            },
            classes,
        };
    };
    const stubWindow = (mobile: unknown): void => {
        (globalThis as { window?: unknown }).window = mobile === undefined ? {} : { siyuan: { mobile } };
    };
    const clearWindow = (): void => {
        delete (globalThis as { window?: unknown }).window;
    };

    it("window.siyuan.mobile 存在即移动端；桌面（无 mobile/无 window）为假", () => {
        stubWindow(undefined);
        expect(isMobileUi()).toBe(false);
        stubWindow({ size: {} });
        expect(isMobileUi()).toBe(true);
        clearWindow();
        expect(isMobileUi()).toBe(false); // 内核侧/单测环境按桌面处理
    });

    it("markMobileUi：桌面空操作不落类；移动端给宿主落标记类", () => {
        const el = host();
        stubWindow(undefined);
        expect(markMobileUi(el as unknown as HTMLElement)).toBe(false);
        expect(el.classes.size).toBe(0);
        stubWindow({ size: {} });
        expect(markMobileUi(el as unknown as HTMLElement)).toBe(true);
        expect(el.classes.has(MOBILE_CLASS)).toBe(true);
        expect(markMobileUi(undefined)).toBe(true); // 无宿主也算移动端（调用方自行决定要不要宿主）
        clearWindow();
    });
});

describe("dayKey / plainText / ratePct（Issue #114 归拢新增锁）", () => {
    it("dayKey：本地日期 YYYY-MM-DD，月日补零", () => {
        expect(dayKey(new Date(2026, 8, 15, 23, 59).getTime())).toBe("2026-09-15");
        expect(dayKey(new Date(2026, 0, 5).getTime())).toBe("2026-01-05");
    });
    it("plainText：折叠空白、剥 md 记号、超长截断加省略号", () => {
        expect(plainText("**bold**  and\n`code`", 40)).toBe("bold and code");
        expect(plainText("a".repeat(50), 10)).toBe("aaaaaaaaaa…");
        expect(plainText("短", 10)).toBe("短");
    });
    it("ratePct：四舍五入到整数、≤100 钳位、answered≤0 归 0", () => {
        expect(ratePct(2, 3)).toBe(67);
        expect(ratePct(1, 1)).toBe(100);
        expect(ratePct(0, 5)).toBe(0);
        expect(ratePct(5, 0)).toBe(0);
        expect(ratePct(120, 100)).toBe(100); // 钳位（脏数据兜底）
    });
});

describe("SaveChain（串行落盘链，Issue #114 归拢新增锁）", () => {
    it("写盘严格串行：后一笔等前一笔 resolve 才开跑", async () => {
        const chain = new SaveChain();
        const order: string[] = [];
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const first = chain.enqueue(async () => {
            order.push("first-start");
            await gate;
            order.push("first-end");
        });
        const second = chain.enqueue(async () => {
            order.push("second-start");
        });
        await Promise.resolve();
        expect(order).toEqual(["first-start"]); // 第二笔被链住，未开跑
        release();
        await Promise.all([first, second]);
        expect(order).toEqual(["first-start", "first-end", "second-start"]);
    });

    it("链面吞错保后续可排：前一笔 reject 不阻断后一笔", async () => {
        const chain = new SaveChain();
        const first = chain.enqueue(() => Promise.reject(new Error("disk full")));
        await expect(first).rejects.toThrow("disk full"); // 本笔错误交回调用侧
        await expect(chain.enqueue(() => Promise.resolve("ok"))).resolves.toBe("ok");
    });
});
