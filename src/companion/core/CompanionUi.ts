import { WenguExpr } from "../rules/Expressions";

/**
 * 看板娘的响应态形状（沿用 word 域结论：$state 只能在 Svelte 编译
 * 单元里创建——CompanionApp.svelte 里 `$state(initialCompanionUi())`
 * 生成深代理后经 CompanionCtl.acquireUi 挂到单例控制器，双宿主
 * （刷题页签 / 单词 dock）共享同一份）。
 */

/** 聊天消息（气泡面板用）。 */
export interface CompanionChatMsg {
    role: "user" | "ai";
    text: string;
}

/** 控制器/组件共享的响应态（控制器写、组件读）。 */
export interface CompanionUi {
    /** 学伴总开关镜像（settings 非响应，开关变化经 syncEnabled 刷新）。 */
    enabled: boolean;
    /** 当前表情。 */
    expr: WenguExpr;
    /** 气泡台词（空=不显示气泡）。 */
    line: string;
    /** 台词更新时间戳（组件据此重置气泡显隐计时）。 */
    lineTs: number;
    /** 聊天面板开合。 */
    chatOpen: boolean;
    /** 聊天请求在途（发送/讲解按钮置灰 + 「想一想」行）。 */
    chatBusy: boolean;
    messages: CompanionChatMsg[];
    draft: string;
    /** 「讲讲这题/这个词」chip 的可用性（最近一次错题来源）。 */
    explainKind: "quiz" | "word" | undefined;
    /** 自定义形象命中表（表情→资源 URL；空=内置形象 SVG 模式）。 */
    imgExpr: Partial<Record<WenguExpr, string>>;
}

/** 初始态（$state 包装在 CompanionApp 内完成）。 */
export function initialCompanionUi(): CompanionUi {
    return {
        enabled: true,
        expr: WenguExpr.Idle,
        line: "",
        lineTs: 0,
        chatOpen: false,
        chatBusy: false,
        messages: [],
        draft: "",
        explainKind: undefined,
        imgExpr: {},
    };
}
