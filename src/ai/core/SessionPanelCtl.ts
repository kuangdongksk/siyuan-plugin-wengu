import { errText } from "./../../ui/shared";
import { AI_TIMEOUT } from "../timeouts";
import { abortAiSession, agentChatContinued } from "../client";
import { aiSessions, type AiSessionRecord } from "../data/AiSessions";
import type { SessionPanelUi } from "./SessionPanelUi";

/**
 * AI 会话面板控制器（四件套之一）：装载（订阅登记簿变更 → 快照进
 * ui.recs）、两栏选择（selId 驱动右栏明细）、失败记录重试
 * （agentChatContinued 历史回放播种新会话重跑末次调用，成功原地翻案，
 * 20260905 起取代原自由追问）、删除/清空两击确认（3s 复位，同 bank
 * 面板口径）。卸载退订 + 清定时器。
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

    /* 组行展开/收起由共享树组件 TreeList 内部消化（openKeys 即
       ui.openGroups，SvelteSet 原地增删即重渲），控制器不再经手。 */

    select(id: string): void {
        this.ui.selId = id;
    }

    back(): void {
        this.ui.selId = undefined;
    }

    /** 停止在途记录：经 client 的中止登记簿断掉所属后台流（在途 fetch
     *  断流 + 流循环逐项检查 signal 退出，产物保留已落部分）。未接线的
     *  流（转换自带页内停止面）登记簿查无此 id，静默无操作。 */
    stop(rec: AiSessionRecord): void {
        if (rec.status !== "running") return;
        abortAiSession(rec.id);
    }

    /** 重试失败记录：回放已有轮次 + 重发末条 user 消息进新会话（error
     *  记录的 turns 必以 user 轮收尾——失败无 ai 回复，单轮失败记录即
     *  重发原 prompt）。retrying 先转回 running（按钮随即消失，防重入），
     *  成功 succeed 原地翻案追加 ai 轮、失败 fail 记新错误消息；记录
     *  中途被删时 succeed/fail 按 id 落空自然无害。超时取最宽松档——
     *  空闲计不误杀慢模型，重试是用户显式动作等得起。 */
    async retry(rec: AiSessionRecord): Promise<void> {
        const s = aiSessions();
        if (!s || rec.status !== "error") return;
        const last = rec.turns[rec.turns.length - 1];
        if (!last || last.role !== "user") return; // 防御：非预期形态不重跑
        s.retrying(rec.id);
        try {
            const reply = await agentChatContinued(rec.turns.slice(0, -1), last.text, rec.model, AI_TIMEOUT.batch);
            s.succeed(rec.id, reply);
        } catch (e) {
            s.fail(rec.id, errText(e));
        }
    }

    /* ── 「删除」两击确认（3s 复位，与 bank 面板同口径）；文档分支行
        删除复用同一确认位（key=分支 key），二次点击按成员 id 精确删 ── */

    armRemove(id: string): void {
        if (this.ui.rmArmed === id) {
            this.disarmRemove();
            aiSessions()?.remove(id);
            return;
        }
        this.armWith(id);
    }

    /** 文档分支行删除（20260903 树改版：分支成员=树算出的记录集合，
     *  按 id 精确回收；跨次运行同文档合并后删除对象就是这份可见集合）。 */
    armRemoveIds(key: string, ids: string[]): void {
        if (this.ui.rmArmed === key) {
            this.disarmRemove();
            aiSessions()?.removeIds(ids);
            return;
        }
        this.armWith(key);
    }

    private armWith(key: string): void {
        if (this.rmTimer) clearTimeout(this.rmTimer);
        this.ui.rmArmed = key;
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
