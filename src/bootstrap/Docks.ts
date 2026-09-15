import { mountWordView as mountWordViewImpl, type WordView } from "../word";
import { mountMobileDrill } from "../mobile";
import type { QuestionBank } from "../bank/data/QuestionBank";
import type { HistoryStore } from "../quiz/service/HistoryStore";
import type { WeaknessStore } from "../bank/data/WeaknessStore";
import type { WordStore } from "../word/core/WordStore";
import type { WenguSettingsShape as SettingsDialogShape } from "../ui/SettingsDialog";
import { isMobileUi } from "../ui/shared";

/**
 * Dock 装载段（20260915 自 `src/index.ts` 搬出压 500 行红线，纯 move 语义、
 * 零行为变更）：两个 dock（单词复习 / 移动端刷题）的注册、面板挂载与
 * 「3.8.0 运行时的 addDock 入参」局部声明一起收在这里，入口文件只留一句
 * `registerDocks(host)`；宿主能力经 `DockHost` 注入（i18n / 共享单例）。
 *
 * **注册次序是硬的**（原注释保留在下面各段）：dock 与刷题页签共用 type 会
 * 让 init 分发错实例；移动端面板**只在移动端注册**，桌面重复注册会多出一个
 * 面板（桌面零回归验收）。搬出时只改「`this.` 前缀 → 宿主入参」，其余逐字。
 */

/** 页签 type：单词复习页签（Dock 面板共用）。 */
const TAB_WORDS = "wengu-words";

/** 移动端刷题 dock 面板 type（Issue #59 起挂 dock；桌面不注册）。 */
const TAB_MOBILE_DRILL = "wengu-mobile-drill";

/** 3.8.0 运行时的插件 Dock 注册入参（类型包 1.2.x 未收录，按运行时形状声明）。 */
export interface WordDockConfig {
    type: string;
    config: {
        title: string;
        icon: string;
        index?: number;
        hotkey?: string;
        /** 内核 dock 布局必读字段（缺失会在 addDock 内部 startsWith 崩溃）。 */
        position?: "LeftBottom" | "LeftTop" | "RightBottom" | "RightTop" | "BottomLeft" | "BottomRight";
        size?: { width?: number; height?: number };
    };
    init: (custom: { element?: Element }) => void;
    destroy?: () => void;
    update?: () => void;
    resize?: () => void;
}

/** 单词面板的 Svelte 卸载函数（Dock 单例，模块级传递给 destroy 回调）。 */
let wordUnmount: (() => void) | undefined;

/** 移动端刷题面板的卸载函数（同 dock 单例口径）。 */
let drillUnmount: (() => void) | undefined;

/** dock 装载所需的宿主能力（插件实例按需提供；各店取共享单例）。 */
export interface DockHost {
    /** 插件 i18n 表（dock 标题与面板取词）。 */
    i18n: Record<string, string>;
    /** 插件实例是否在位（原 `WenguPlugin.instance` 守卫，调用时判定）。 */
    alive(): boolean;
    /** 内核 addDock 通道（插件实例自带；类型包 1.2.x 未收录其运行时形状，
     *  故宿主侧就地转换后再转发——见 index.ts 的 registerDocks）。 */
    addDock?: (config: WordDockConfig) => unknown;
    /** 共享 WordStore（刷题页签的生词标记也写入同一份进度）。 */
    wordStore(): WordStore;
    /** 共享设置对象（移动端面板读默认判分/计时；**取用时读**——设置装载会
     *  整对象替换 `this.settings`，快照会读到旧引用）。 */
    settings?: () => SettingsDialogShape | undefined;
    bank?: () => QuestionBank | undefined;
    history?: () => HistoryStore | undefined;
    weakness?: () => WeaknessStore | undefined;
}

/** Dock 注册：单词复习面板（桌面 + 移动）+ 移动端刷题面板（仅移动）。
 *  单词复习只走 Dock 面板（顶部入口与同名页签已删：addTab 与
 *  addDock 注册同名 type 会让 dock 的 init 分发到页签实例，面板空白的
 *  根因）。3.8.0 运行时支持，类型包未收录 → 局部声明。 */
export function registerDocks(host: DockHost): void {
    registerWordDock(host);
    registerMobileDrillDock(host);
}

/** 单词复习 dock（桌面与移动都注册）。 */
function registerWordDock(host: DockHost): void {
    if (host.addDock) {
        host.addDock({
            type: TAB_WORDS,
            config: {
                title: host.i18n.wordBtn || "背单词",
                icon: "iconWenguWords",
                index: 1000,
                hotkey: "",
                position: "RightBottom",
                size: { width: 360, height: 0 },
            },
            init: (custom) => mountWordView(host, custom),
            // 卸载 Svelte 应用与计时器监听（旧版此处空置会泄漏）
            destroy: () => {
                wordUnmount?.();
                wordUnmount = undefined;
            },
        });
    }
}

/** 移动端刷题 dock（Issue #59）：思源移动端 openTab 是空桩，dock 是
 *  插件面板唯一通道。**只在移动端注册**——桌面已由页签承担刷题，
 *  重复注册会在桌面 dock 里多出一个面板（桌面零回归验收）。 */
function registerMobileDrillDock(host: DockHost): void {
    if (isMobileUi() && host.addDock) {
        host.addDock({
            type: TAB_MOBILE_DRILL,
            config: {
                title: host.i18n.pluginName || "温故",
                icon: "iconWengu",
                index: 999,
                hotkey: "",
                position: "RightBottom",
                size: { width: 0, height: 0 },
            },
            init: (custom) => mountMobileDrillView(host, custom),
            destroy: () => {
                drillUnmount?.();
                drillUnmount = undefined;
            },
        });
    }
}

/** 单词视图挂载（Dock 面板与兜底页签共用；WordStore 单例共享进度缓存）。 */
function mountWordView(host: DockHost, custom: { element?: Element }): void {
    const el = custom.element as HTMLElement | undefined;
    if (!el || !host.alive()) return;
    wordUnmount?.(); // dock init 重入（布局恢复竞态）先卸旧实例——否则旧 WordTimer 间隔器泄漏
    const m = mountWordViewImpl(el, host.i18n ?? {}, host.wordStore());
    (custom as unknown as { wenguWordView?: WordView }).wenguWordView = m.view;
    wordUnmount = m.unmount;
}

/** 移动端刷题面板挂载（dock init；与单词面板同位次）。 */
function mountMobileDrillView(host: DockHost, custom: { element?: Element }): void {
    const el = custom.element as HTMLElement | undefined;
    if (!el || !host.alive()) return;
    drillUnmount?.(); // dock init 重入（布局恢复竞态）先卸旧实例，防计时器泄漏
    const mounted = mountMobileDrill(el, {
        i18n: host.i18n ?? {},
        bank: host.bank?.(),
        history: host.history?.(),
        weakness: host.weakness?.(),
        settings: host.settings?.(),
    });
    drillUnmount = mounted.unmount;
}
