import type { MobileDrill } from "./MobileDrill";

/**
 * Svelte context 键（移动端刷题域）：壳组件注入控制器，各屏组件取用
 * ——静态依赖经 context 传，避免当 prop 传触发 state_referenced_locally
 * 警告（word 域 WORD_VIEW_CTX 同款约定）。
 */
export const MOBILE_DRILL_CTX = Symbol("wenguMobileDrill");

export type { MobileDrill };
