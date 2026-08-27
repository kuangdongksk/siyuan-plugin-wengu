import type { QuizView } from "../../quiz";
import { esc, fmt } from "../../ui/shared";
import { svgIcon } from "../../ui/FormHtml";

/**
 * 专题管理工作区面板：清单（题数/最近刷题/正确率）+ 重命名 + 删除
 * （联动清 col: 会话）+ 点击进刷题；「按知识点收集」沿用既有弹窗。
 * 标题含「/」即目录专题（如 高数/极限/洛必达），按路径段树形展示
 * （buildColTree 纯函数，单测覆盖）。统计聚合 summarizeSessions 同。
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

export interface ColRowView {
    id: string;
    /** 完整路径标题（重命名/悬浮提示用）。 */
    title: string;
    /** 展示名：目录专题=末段，平铺专题=全标题。 */
    name: string;
    count: number;
    stat: ColStat;
}

/** 专题树节点（目录视图）：rows=本目录直属专题，children=子目录。
 *  目录只作为专题标题路径的中间层存在，不落盘、无空目录。 */
export interface ColTreeNode {
    name: string;
    rows: ColRowView[];
    children: ColTreeNode[];
}

/** 标题含「/」的专题挂进对应目录（叶子名=末段），平铺标题留在当前层；
 *  同层专题与子目录均按名排序。root.name 为空、即整棵树的根。 */
export function buildColTree(rows: ColRowView[]): ColTreeNode {
    const root: ColTreeNode = { name: "", rows: [], children: [] };
    for (const r of [...rows].sort((a, b) => a.title.localeCompare(b.title, "zh"))) {
        const segs = r.title
            .split("/")
            .map((s) => s.trim())
            .filter(Boolean);
        if (segs.length === 0) continue;
        const leaf = { ...r, name: segs[segs.length - 1] };
        let node = root;
        for (let i = 0; i < segs.length - 1; i++) {
            let next = node.children.find((c) => c.name === segs[i]);
            if (!next) {
                next = { name: segs[i], rows: [], children: [] };
                node.children.push(next);
            }
            node = next;
        }
        node.rows.push(leaf);
    }
    const sortNode = (n: ColTreeNode): void => {
        n.children.sort((a, b) => a.name.localeCompare(b.name, "zh"));
        for (const c of n.children) sortNode(c);
    };
    sortNode(root);
    return root;
}

/** 目录内的专题总数（含子目录，分组行「{n} 个专题」用）。 */
function countCols(node: ColTreeNode): number {
    return node.rows.length + node.children.reduce((n, c) => n + countCols(c), 0);
}

function rowHtml(v: QuizView, r: ColRowView, depth: number): string {
    const t = v.t;
    const stat = r.stat.lastAt
        ? `${esc(t("colLastDrill"))} ${fmtTime(r.stat.lastAt)} · ${Math.round(
              (r.stat.correct / Math.max(1, r.stat.answered)) * 100
          )}%`
        : esc(t("colNever"));
    return `<div class="wengu-col-row wengu-cp-row" data-cid="${esc(r.id)}" style="padding-left:${10 + depth * 16}px">
  <span class="wengu-cp-title" data-cogo data-full="${esc(r.title)}" title="${esc(r.title)}">${esc(r.name)}</span>
  <span class="wengu-cp-meta">${esc(fmt(t("collectionCount"), { n: String(r.count) }))} · ${stat}</span>
  <span class="wengu-cp-ops">
    <button type="button" class="b3-button b3-button--text" data-coren>${esc(t("colRename"))}</button>
    <button type="button" class="b3-button b3-button--text" data-codel>${esc(t("collectDelete"))}</button>
  </span>
</div>`;
}

/** 目录分组行（可折叠 details；叶子专题缩进行 + 子目录递归）。 */
function treeHtml(v: QuizView, node: ColTreeNode, depth: number): string {
    const t = v.t;
    const rows = node.rows.map((r) => rowHtml(v, r, depth)).join("");
    const groups = node.children
        .map(
            (c) => `<details class="wengu-col-group" open>
  <summary style="padding-left:${10 + depth * 16}px">${svgIcon("iconList")}<span class="wengu-col-group-name" title="${esc(
      c.name
  )}">${esc(c.name)}</span><span class="wengu-cp-meta">${esc(fmt(t("colGroupCount"), { n: String(countCols(c)) }))}</span></summary>
  ${treeHtml(v, c, depth + 1)}
</details>`
        )
        .join("");
    return rows + groups;
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
        view.push({ id: r.id, title: r.title, name: r.title, count: r.count, stat: summarizeSessions(sessions) });
    }
    const tree = buildColTree(view);
    const list =
        tree.rows.length + tree.children.length > 0
            ? treeHtml(v, tree, 0)
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
            // 行内重命名编辑完整路径（改挂目录=改标题），展示名只在非编辑态
            const origin = title.dataset.full || title.textContent || "";
            title.innerHTML = `<input class="b3-text-field fn__flex-1" value="${esc(origin)}">`;
            const input = title.querySelector<HTMLInputElement>("input")!;
            input.focus();
            input.select();
            const commit = async (): Promise<void> => {
                const next = input.value.trim().slice(0, 60);
                title.textContent = title.dataset.full || "";
                if (!next || next === origin) return;
                await bank.renameCollection(cid, next);
                await bank.flush();
                void colFlow.refresh().then((): void => colFlow.refreshSide());
                rerender();
            };
            input.addEventListener("keydown", (ev) => {
                if (ev.key === "Enter") void commit();
                if (ev.key === "Escape") {
                    title.textContent = title.dataset.full || "";
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
