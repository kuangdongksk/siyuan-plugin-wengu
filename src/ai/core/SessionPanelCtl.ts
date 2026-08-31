import { AI_TIMEOUT } from "../timeouts";
import { agentChatContinued } from "../client";
import { aiSessions, type AiSessionRecord } from "../data/AiSessions";
import type { SessionPanelUi } from "./SessionPanelUi";

/**
 * AI 会话面板控制器（四件套之一）：装载（订阅登记簿变更 → 快照进
 * ui.recs）、列表/明细切换、继续追问（agentChatContinued 历史回放播种
 * 新会话，成功后轮次登记回原记录）、删除/清空两击确认（3s 复位，同
 * bank 面板口径）。卸载退订 + 清定时器。
 */
export class SessionPanelCtl {
    private alive = true;
    private unsubscribe?: () => void;
    private rmTimer?: ReturnType<typeof setTimeout>;
    private clrTimer?: ReturnType<typeof setTimeout>;

    constructor(private readonly ui: SessionPanelUi) {}

    destroy(): void {
        this.alive = false;
        this.unsubscribe?.();
        this.unsubscribe = undefined;
        if (this.rmTimer) clearTimeout(this.rmTimer);
        if (this.clrTimer) clearTimeout(this.clrTimer);
        this.rmTimer = undefined;
        this.clrTimer = undefined;
    }

    /** 装载：等登记簿 hydrate 完成后首拉快照并订阅后续变更。 */
    async load(): Promise<void> {
        const s = aiSessions();
        if (!s) {
            // 未接线（测试/极端时序）按空表渲染，不给死界面
            this.ui.phase = "ready";
            return;
        }
        await s.ready();
        if (!this.alive) return;
        this.sync();
        this.unsubscribe = s.subscribe(() => this.sync());
        this.ui.phase = "ready";
    }

    /** 登记簿变更 → 快照整体替换；选中记录同步刷新（追问追轮就地可见）。 */
    private sync(): void {
        const s = aiSessions();
        if (!s) return;
        this.ui.recs = s.list();
        if (this.ui.selId && !this.ui.recs.some((r) => r.id === this.ui.selId)) this.ui.selId = undefined;
    }

    setFilter(kind: string): void {
        this.ui.filter = kind;
    }

    select(id: string): void {
        this.ui.selId = id;
        this.ui.draft = "";
        this.ui.sendError = "";
    }

    back(): void {
        this.ui.selId = undefined;
    }

    setDraft(text: string): void {
        this.ui.draft = text;
    }

    /** 继续追问：user 轮先进记录（问了什么立即可见），AI 回复到达补
     *  ai 轮——轮次登记回记录本体（视图切走也不丢），失败只留 user 轮
     *  + 错误条，可改小问题再发。 */
    async ask(rec: AiSessionRecord, text: string): Promise<void> {
        const s = aiSessions();
        const question = text.trim();
        if (!s || !question || this.ui.sending) return;
        this.ui.draft = "";
        this.ui.sendError = "";
        this.ui.sending = true;
        s.appendTurns(rec.id, { role: "user", text: question });
        try {
            const reply = await agentChatContinued(rec.turns, question, rec.model, AI_TIMEOUT.chat);
            s.appendTurns(rec.id, { role: "ai", text: reply });
        } catch (e) {
            if (this.alive && this.ui.selId === rec.id) this.ui.sendError = String((e as Error)?.message ?? e);
        } finally {
            if (this.alive) this.ui.sending = false;
        }
    }

    /* ── 「删除」两击确认（3s 复位，与 bank 面板同口径） ── */

    armRemove(id: string): void {
        if (this.ui.rmArmed === id) {
            this.disarmRemove();
            aiSessions()?.remove(id);
            return;
        }
        if (this.rmTimer) clearTimeout(this.rmTimer);
        this.ui.rmArmed = id;
        this.rmTimer = setTimeout((): void => {
            this.ui.rmArmed = undefined;
            this.rmTimer = undefined;
        }, 3000);
    }

    private disarmRemove(): void {
        if (this.rmTimer) clearTimeout(this.rmTimer);
        this.rmTimer = undefined;
        this.ui.rmArmed = undefined;
    }

    /* ── 头部「清空」两击确认 ── */

    armClear(): void {
        if (this.ui.clrArmed) {
            this.disarmClear();
            aiSessions()?.clear();
            this.back();
            return;
        }
        this.ui.clrArmed = true;
        this.clrTimer = setTimeout((): void => {
            this.ui.clrArmed = false;
            this.clrTimer = undefined;
        }, 3000);
    }

    private disarmClear(): void {
        if (this.clrTimer) clearTimeout(this.clrTimer);
        this.clrTimer = undefined;
        this.ui.clrArmed = false;
    }
}
