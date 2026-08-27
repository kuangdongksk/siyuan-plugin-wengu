import type { QuizView } from "../quiz";
import { esc, fmt } from "../ui/shared";
import { svgIcon } from "../ui/FormHtml";

/**
 * 专题管理工作区面板：清单（题数/最近刷题/正确率）+ 重命名 + 删除
 * （联动清 col: 会话）+ 点击进刷题；「按知识点收集」沿用既有弹窗。
 * 统计聚合 summarizeSessions 为导出纯函数（单测覆盖）。
 */

/** 一组会话的聚合（专题行「最近刷题/正确率」列）。 */
export interface ColStat {
    lastAt?: number;
    answered: number;
    correct: number;
}

export function summarizeSessions(sessions: { startedAt: number; answered: number; correct: number }[]): ColStat {
    let lastAt: number | undefined;
    let answered = 0;
    let correct = 0;
    for (const s of sessions) {
        if (lastAt === undefined || s.startedAt > lastAt) lastAt = s.startedAt;
        answered += s.answered;
        correct += s.correct;
    }
    return { lastAt, answered, correct };
}

function fmtTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface ColRowView {
    id: string;
    title: string;
    count: number;
    stat: ColStat;
}

function rowHtml(v: QuizView, r: ColRowView): string {
    const t = v.t;
    const stat = r.stat.lastAt
        ? `${esc(t("colLastDrill"))} ${fmtTime(r.stat.lastAt)} · ${Math.round(
              (r.stat.correct / Math.max(1, r.stat.answered)) * 100
          )}%`
        : esc(t("colNever"));
    return `<div class="wengu-col-row wengu-cp-row" data-cid="${esc(r.id)}">
  <span class="wengu-cp-title" data-cogo title="${esc(r.title)}">${esc(r.title)}</span>
  <span class="wengu-cp-meta">${esc(fmt(t("collectionCount"), { n: String(r.count) }))} · ${stat}</span>
  <span class="wengu-cp-ops">
    <button type="button" class="b3-button b3-button--text" data-coren>${esc(t("colRename"))}</button>
    <button type="button" class="b3-button b3-button--text" data-codel>${esc(t("collectDelete"))}</button>
  </span>
</div>`;
}

/** 专题管理面板渲染入口（WorkspaceShell 调）。 */
export async function renderCollectionPanelInto(v: QuizView, root: HTMLElement): Promise<void> {
    const t = v.t;
    const bank = v.bankStore();
    if (!bank) {
        root.innerHTML = `<div class="wengu-ws-page"><div class="wengu-muted">${esc(t("colEmpty"))}</div></div>`;
        return;
    }
    root.innerHTML = `<div class="wengu-ws-page"><div class="wengu-muted">${esc(t("loading"))}</div></div>`;
    const rows = (await bank.collectionsView()).filter((r) => !r.id.startsWith("doc:"));
    const history = v.historyStore();
    const view: ColRowView[] = [];
    for (const r of rows) {
        const sessions = history ? await history.docSessions(`col:${r.id}`) : [];
        view.push({ id: r.id, title: r.title, count: r.count, stat: summarizeSessions(sessions) });
    }
    const list =
        view.length > 0
            ? view.map((r) => rowHtml(v, r)).join("")
            : `<div class="wengu-muted">${esc(t("colEmpty"))}</div>`;
    root.innerHTML = `<div class="wengu-ws-page">
  <div class="wengu-ws-title">${esc(t("colPanelTitle"))}
    <span class="wengu-ws-titlebtns">
      <button type="button" class="b3-button b3-button--outline" data-collect>${svgIcon("iconSparkles")} ${esc(
          t("colCollect")
      )}</button>
      <button type="button" class="b3-button b3-button--text" data-crefresh>${svgIcon("iconRefresh")}</button>
    </span>
  </div>
  <div class="wengu-col-list wengu-cp-list">${list}</div>
</div>`;
    bindCollectionPanel(v, root);
}

function bindCollectionPanel(v: QuizView, root: HTMLElement): void {
    const t = v.t;
    const bank = v.bankStore();
    if (!bank) return;
    const colFlow = v.colFlowOf();
    const rerender = (): void => void renderCollectionPanelInto(v, root);
    root.querySelector<HTMLButtonElement>("[data-collect]")?.addEventListener("click", () => colFlow.openDialog());
    root.querySelector<HTMLButtonElement>("[data-crefresh]")?.addEventListener("click", rerender);
    for (const row of root.querySelectorAll<HTMLElement>(".wengu-cp-row")) {
        const cid = row.dataset.cid ?? "";
        const delBtn = row.querySelector<HTMLButtonElement>("[data-codel]");
        let armed = false;
        let armTimer: ReturnType<typeof setTimeout> | undefined;
        row.querySelector<HTMLElement>("[data-cogo]")?.addEventListener("click", () => {
            colFlow.switchTo(cid);
            v.switchWorkspace("drill");
        });
        row.querySelector<HTMLButtonElement>("[data-coren]")?.addEventListener("click", () => {
            const title = row.querySelector<HTMLElement>(".wengu-cp-title");
            if (!title || title.querySelector("input")) return;
            const origin = title.textContent ?? "";
            title.innerHTML = `<input class="b3-text-field fn__flex-1" value="${esc(origin)}">`;
            const input = title.querySelector<HTMLInputElement>("input")!;
            input.focus();
            input.select();
            const commit = async (): Promise<void> => {
                const next = input.value.trim().slice(0, 40);
                title.textContent = origin;
                if (!next || next === origin) return;
                await bank.renameCollection(cid, next);
                await bank.flush();
                void colFlow.refresh().then((): void => colFlow.refreshSide());
                rerender();
            };
            input.addEventListener("keydown", (ev) => {
                if (ev.key === "Enter") void commit();
                if (ev.key === "Escape") {
                    title.textContent = origin;
                }
            });
            input.addEventListener("blur", () => void commit());
        });
        delBtn?.addEventListener("click", () => {
            if (!armed) {
                armed = true;
                delBtn.textContent = t("collectConfirm");
                armTimer = setTimeout(() => {
                    armed = false;
                    delBtn.textContent = t("collectDelete");
                }, 3000);
                return;
            }
            clearTimeout(armTimer);
            void (async () => {
                await bank.deleteCollection(cid);
                await v.historyStore()?.removeDocs([`col:${cid}`]); // 轮次归档联动清
                await bank.flush();
                if (colFlow.id() === cid) {
                    colFlow.reset();
                    void v.reloadView();
                } else {
                    void colFlow.refresh().then((): void => colFlow.refreshSide());
                }
                rerender();
            })();
        });
    }
}
