/**
 * 题卡共享常量与渲染入参（自 CardHtml 拆出的余部）：卡头元信息行与
 * 「思路」折叠区的字符串渲染已随题卡组件化退役（components/
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
    /** 预览模式（Issue #46）：卡头「标记为错题」钮只在预览下渲染
     *  （做题模式不加）。缺省 undefined=非预览。 */
    preview?: boolean;
    /** 阅读面作用域（Issue #81）：本卷是英语卷时，题卡列表与材料组单元
     *  都挂 .wengu-reading（阅读面 + 间距阶梯）。判定唯一由 QuizShell
     *  经 readingScopeOf 给出，组件只消费（缺省/非英语卷=不带类名）。 */
    reading?: boolean;
}
