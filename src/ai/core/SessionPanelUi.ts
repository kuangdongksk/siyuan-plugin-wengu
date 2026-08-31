import type { AiSessionRecord } from "../data/AiSessions";
import type { SessionPanelCtl } from "./SessionPanelCtl";

/**
 * AI 会话面板的响应态形状（四件套之一，模式见 docs/svelte-migration.md）。
 * 登记簿本体在 data/AiSessions（全仓共享单例），这里只放视图态：recs
 * 是订阅回调重拉的**快照**（store 变更 → ctl 通知 → ui.recs 整体替换，
 * Svelte 细粒度更新照常生效）；selId 进明细视图，追问的输入与在途
 * 状态也在此（draft/sending/sendError）。
 */

/** 子组件经 context 取的载荷。 */
export interface SessionPanelCtx {
    ctl: SessionPanelCtl;
    ui: SessionPanelUi;
    t: (key: string) => string;
}

export const SESSION_PANEL_CTX = Symbol("wengu-ai-session-panel");

export interface SessionPanelUi {
    /** loading=登记簿 hydrate 中、ready=可渲染。 */
    phase: "loading" | "ready";
    /** 登记簿快照（头新尾旧；store 订阅回调整体替换）。 */
    recs: AiSessionRecord[];
    /** 类别过滤（"" = 全部）。 */
    filter: string;
    /** 选中的记录 id（进明细视图；空 = 列表视图）。 */
    selId: string | undefined;
    /** 继续追问的输入草稿。 */
    draft: string;
    /** 追问在途（防重入 + 转圈）。 */
    sending: boolean;
    /** 追问失败消息（下次发送前清）。 */
    sendError: string;
    /** 「删除」两击确认中的记录 id（3s 自动复位）。 */
    rmArmed: string | undefined;
    /** 头部「清空」两击确认。 */
    clrArmed: boolean;
}

/** 初始态（$state 包装在 SessionPanelApp 内完成）。 */
export function initialSessionPanelUi(): SessionPanelUi {
    return {
        phase: "loading",
        recs: [],
        filter: "",
        selId: undefined,
        draft: "",
        sending: false,
        sendError: "",
        rmArmed: undefined,
        clrArmed: false,
    };
}
