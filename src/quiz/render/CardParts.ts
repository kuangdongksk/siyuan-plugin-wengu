/**
 * 题卡共享常量与渲染入参（自 CardHtml 拆出的余部）：卡头元信息行与
 * 「思路」折叠区的字符串渲染已随题卡组件化退役（component/
 * QuizCardApp，6-4a），本文件只剩题型 i18n 键与渲染入参类型。
 */

/** 题型 → i18n 键：single → typeSingle。 */
export function typeKey(type: string): string {
    return `type${type[0].toUpperCase()}${type.slice(1)}`;
}

/** 题卡渲染入参（展示开关由 QuizView 按设置/模式算好传入）。 */
export interface CardHtmlModel {
    t: (key: string) => string;
    showAttempts: boolean;
    showWrongBadge: boolean;
}
