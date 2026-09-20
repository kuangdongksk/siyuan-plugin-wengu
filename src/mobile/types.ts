import type { WenguRevealMode, WenguTimingMode } from "../types";

/**
 * 移动端刷题域（Issue #59）的自有类型。
 *
 * 移动端「仅刷题」：dock 面板内完成 选卷/开刷 → 作答 → 判分揭示 → 轮次报告。
 * 管理类功能（转换 / rail 工作区 / 统计 / 词书）不进移动端。
 *
 * 设计稿：`design/UI/刷题/wengu-mobile-drill.html`（九屏 390×844）。
 */

/** 移动端视图模式（对应设计稿屏 ①⑥⑦⑧）。 */
export type MobileScreen = "home" | "drill" | "report";

/** 开刷面板的选择（判分模式 + 本次题数）。 */
export interface MobileSetup {
    reveal: WenguRevealMode;
    timing: WenguTimingMode;
    /** 本次题数（0 = 全部）。 */
    count: number;
}

/** 题号抽屉的单格状态（屏 ⑨ 四态图例）。 */
export type MobileCellState = "none" | "ok" | "bad" | "answered";

/** 抽屉格子：单题一格 / 材料组整组一格（`15–19` 连格）。 */
export interface MobileCell {
    /** 首题下标（0 基，点击直达）。 */
    idx: number;
    /** 末题下标（组题 > 首；单题 = 首）。 */
    end: number;
    state: MobileCellState;
    /** 组题格副标签（「阅读 · 组题」）。 */
    sub?: string;
}

/** dock 挂载所需的宿主依赖（插件注入；与 QuizView 同源共享单例）。 */
export interface MobileDeps {
    i18n: Record<string, string>;
    /** 题库（题集清单/题目/材料/记账的唯一真相）。 */
    bank?: import("../bank/data/QuestionBank").QuestionBank;
    history?: import("../quiz/service/HistoryStore").HistoryStore;
    weakness?: import("../bank/data/WeaknessStore").WeaknessStore;
    /** 插件设置（判分模式/计时默认值 + AI 模型）。 */
    settings?: import("../ui/SettingsDialog").WenguSettingsShape;
}
