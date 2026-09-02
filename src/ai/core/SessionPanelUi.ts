import type { AiSessionRecord } from "../data/AiSessions";
import type { SessionPanelCtl } from "./SessionPanelCtl";

/**
 * AI 会话面板的响应态形状（四件套之一，模式见 docs/svelte-migration.md）。
 * 登记簿本体在 data/AiSessions（全仓共享单例），这里只放视图态：recs
 * 是订阅回调重拉的**快照**（store 变更 → ctl 通知 → ui.recs 整体替换，
 * Svelte 细粒度更新照常生效）；两栏式（20260901）——左栏清单常驻，
 * selId 选中会话驱动右栏明细，追问的输入与在途状态也在此
 * （draft/sending/sendError）。左栏树状分组（20260902）：同组记录归并
 * 成组行（归并在 core/SessionTree 纯函数），openGroups 记展开态。
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
    /** 选中的记录 id（右栏明细；空 = 右栏空态提示）。 */
    selId: string | undefined;
    /** 继续追问的输入草稿。 */
    draft: string;
    /** 追问在途（防重入 + 转圈）。 */
    sending: boolean;
    /** 追问失败消息（下次发送前清）。 */
    sendError: string;
    /** 「删除」两击确认中的记录 id（3s 自动复位；组行用 `g:{组id}` 前缀）。 */
    rmArmed: string | undefined;
    /** 头部「清空」两击确认。 */
    clrArmed: boolean;
    /** 左栏组行的展开态（组 id → 是否展开；缺省收起，不持久化）。 */
    openGroups: Record<string, boolean>;
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
        openGroups: {},
    };
}
