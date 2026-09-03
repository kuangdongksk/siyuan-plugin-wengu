import { errText } from "./../../ui/shared";
import { judgeClue } from "../service/AiJudge";
import { renderClueRow } from "./MaterialFlow";
import type { WenguSession } from "../service/HistoryStore";
import type { WenguMaterial, WenguQuestion } from "../../types";
import { esc } from "../../ui/shared";

/**
 * 线索标注（M5 定位能力训练）：材料里选段标为当前题的线索（存进
 * 会话 clues，纯文本锚点不写块），组单元底部 chips 展示；答完题后
 * 可「AI 复核」——judgeClue 输出 hit/near/miss（错因二分：定位错 vs
 * 理解错）。当前线索跟随组内当前题（onActive 时刷新）。
 */

/** ClueFlow 需要的宿主能力（QuizView 组装，全部薄取值器）。 */
export interface ClueHost {
    t(k: string): string;
    el: HTMLElement;
    currentSession(): WenguSession | undefined;
    /** 当前题（组内当前题由 MaterialFlow 切换时同步 activeQIdx）。 */
    currentQuestion(): WenguQuestion | undefined;
    /** 材料正文（AI 复核的输入）。 */
    materialOf(q: WenguQuestion): WenguMaterial | undefined;
    aiModelId(): string;
    /** 会话变更落库。 */
    persist(): void;
}

/** 选中浮层「标为线索」入口（AnnoFlow 回调进来）。 */
export function addClue(host: ClueHost, text: string): void {
    const s = host.currentSession();
    const q = host.currentQuestion();
    if (!s || !q) return;
    if (!q.group) {
        note(host, host.t("clueOnlyGroup"));
        return;
    }
    const clues = (s.clues ?? (s.clues = {}))[q.id] ?? (s.clues[q.id] = []);
    if (clues.includes(text)) return;
    clues.push(text);
    host.persist();
    renderClueRow(host.el, host.t, clues);
}

/** 渲染某题的线索 chips（组内切题/滚动跟踪 onActive 时调用；幂等）。 */
export function refreshClueRow(host: ClueHost): void {
    const s = host.currentSession();
    const q = host.currentQuestion();
    if (!q?.group) return;
    const unit = host.el.querySelector<HTMLElement>(`.wengu-gunit[data-mid="${q.group}"]`);
    if (unit) renderClueRow(unit, host.t, s?.clues?.[q.id] ?? []);
}

/** 绑定「AI 复核线索」按钮（事件委托挂在视图根上，重渲染不失效）。 */
export function bindClueJudge(host: ClueHost): void {
    host.el.addEventListener("click", (ev) => {
        const btn = (ev.target as HTMLElement).closest<HTMLElement>("[data-act='clue-judge']");
        if (!btn) return;
        void judgeClueNow(host, btn.closest<HTMLElement>(".wengu-gunit") ?? host.el);
    });
}

async function judgeClueNow(host: ClueHost, scope: HTMLElement): Promise<void> {
    const s = host.currentSession();
    const q = host.currentQuestion();
    const mat = q ? host.materialOf(q) : undefined;
    const clues = q ? (s?.clues?.[q.id] ?? []) : [];
    if (!s || !q || !mat || clues.length === 0) return;
    const submitted = s.results.find((r) => r.qid === q.id)?.submitted ?? "";
    const row = scope.querySelector<HTMLElement>("[data-clues]");
    if (row) {
        row.querySelector("[data-clue-result]")?.remove();
        row.insertAdjacentHTML(
            "beforeend",
            `<span class="wengu-clue-result" data-clue-result>${esc(host.t("clueJudging"))}</span>`
        );
    }
    try {
        const v = await judgeClue(mat.bodyMd ?? "", q, submitted, clues, host.aiModelId());
        const label =
            v.clue === "hit" ? host.t("clueHit") : v.clue === "near" ? host.t("clueNear") : host.t("clueMiss");
        if (row) {
            row.querySelector("[data-clue-result]")?.remove();
            row.insertAdjacentHTML(
                "beforeend",
                `<span class="wengu-clue-result wengu-clue-${v.clue}" data-clue-result">${esc(label)}${
                    v.comment ? ` · ${esc(v.comment)}` : ""
                }</span>`
            );
        }
    } catch (e) {
        row?.querySelector("[data-clue-result]")?.remove();
        note(host, `${host.t("aiJudgeFailed")}${errText(e)}`);
    }
}

function note(host: ClueHost, text: string): void {
    const status = host.el.querySelector<HTMLElement>("[data-status]");
    if (status) {
        status.textContent = text;
        status.classList.remove("wengu-status-err");
        status.removeAttribute("hidden");
    }
}
