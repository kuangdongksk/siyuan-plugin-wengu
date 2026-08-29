import type { QuizView } from "../../quiz";
import { esc, fmt } from "../../ui/shared";
import { svgIcon } from "../../ui/FormHtml";
import type { QuestionBank } from "../data/QuestionBank";
import { createFolder, deleteFolder, renameFolder } from "../data/BankFolders";

/**
 * 专题管理工作区面板：官方文档树同款树形（ul.b3-list--background +
 * li.b3-list-item 行壳、箭头旋转折叠、counter 计数徽标、hover 才显的
 * 图标操作），目录=标题含「/」派生 + 手动新建的空文件夹（BankData.
 * folders，增删改走 BankFolders）合并展示（buildColTree 纯函数，单测
 * 覆盖）。行操作：点击进刷题、行内改名、两击确认删除；文件夹另有
 * 新建子文件夹/改名/删除（删=清严格前缀下全部专题并联动 col: 会话）。
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

/** 专题树节点（目录视图）：rows=本目录直属专题，children=子目录；
 *  path=从根拼到的目录路径（文件夹增删改的键）。目录来自标题派生
 *  与手动文件夹（folders）两路合并，空目录也能落树。 */
export interface ColTreeNode {
    name: string;
    path: string;
    rows: ColRowView[];
    children: ColTreeNode[];
}

/** 标题含「/」的专题挂进对应目录（叶子名=末段），平铺标题留在当前层；
 *  folders 的手动目录（含中间层）补成节点。同层按名排序。 */
export function buildColTree(rows: ColRowView[], folders: string[] = []): ColTreeNode {
    const root: ColTreeNode = { name: "", path: "", rows: [], children: [] };
    const walk = (segs: string[]): ColTreeNode => {
        let node = root;
        for (const seg of segs) {
            let next = node.children.find((c) => c.name === seg);
            if (!next) {
                next = { name: seg, path: node.path ? `${node.path}/${seg}` : seg, rows: [], children: [] };
                node.children.push(next);
            }
            node = next;
        }
        return node;
    };
    for (const r of [...rows].sort((a, b) => a.title.localeCompare(b.title, "zh"))) {
        const segs = r.title
            .split("/")
            .map((s) => s.trim())
            .filter(Boolean);
        if (segs.length === 0) continue;
        walk(segs.slice(0, -1)).rows.push({ ...r, name: segs[segs.length - 1] });
    }
    for (const f of folders) {
        const segs = f
            .split("/")
            .map((s) => s.trim())
            .filter(Boolean);
        if (segs.length > 0) walk(segs);
    }
    const sortNode = (n: ColTreeNode): void => {
        n.children.sort((a, b) => a.name.localeCompare(b.name, "zh"));
        for (const c of n.children) sortNode(c);
    };
    sortNode(root);
    return root;
}

/** 目录内的专题总数（含子目录，文件夹行 counter 用）。 */
function countCols(node: ColTreeNode): number {
    return node.rows.length + node.children.reduce((n, c) => n + countCols(c), 0);
}

/* ── 官方文档树同款 DOM（行内 CSS 变量/缩进与 stage 实测一致） ── */

const INDENT = 18;

/** 行缩进变量（--file-toggle-width 拖拽高亮留用；depth 0 官方为 22/22）。 */
function liVars(depth: number): string {
    const w = depth === 0 ? 22 : 18 + depth * INDENT;
    return `--file-toggle-width:${w}px;--file-action-offset:${depth === 0 ? 22 : w + 2}px`;
}

/** 折叠箭头：叶子保留占位（fn__hidden 对齐图标列）；文件夹可点。 */
function toggleHtml(depth: number, dir = false): string {
    const pad = depth > 0 ? `padding-left:${depth * INDENT}px;` : "";
    return `<span class="b3-list-item__toggle${dir ? " b3-list-item__toggle--hl" : " fn__hidden"}" style="${pad}"${
        dir ? " data-dirtoggle" : ""
    }>${svgIcon("iconRight", "b3-list-item__arrow b3-list-item__arrow--open")}</span>`;
}

function actionHtml(act: string, label: string, icon: string): string {
    return `<span class="b3-list-item__action b3-tooltips b3-tooltips__w" data-${act} aria-label="${esc(
        label
    )}">${svgIcon(icon)}</span>`;
}

function rowHtml(v: QuizView, r: ColRowView, depth: number): string {
    const t = v.t;
    const stat = r.stat.lastAt
        ? `${t("colLastDrill")} ${fmtTime(r.stat.lastAt)} · ${Math.round(
              (r.stat.correct / Math.max(1, r.stat.answered)) * 100
          )}%`
        : t("colNever");
    const tip = `${r.title}\n${fmt(t("collectionCount"), { n: String(r.count) })} · ${stat}`;
    return `<li class="b3-list-item b3-list-item--hide-action" data-cid="${esc(r.id)}" style="${liVars(depth)}">
  ${toggleHtml(depth)}
  <span class="b3-list-item__icon">${svgIcon("iconList")}</span>
  <span class="b3-list-item__text b3-tooltips b3-tooltips__e wengu-cp-name" data-cogo data-full="${esc(
      r.title
  )}" aria-label="${esc(tip)}">${esc(r.name)}</span>
  <span class="counter">${r.count}</span>
  ${actionHtml("coren", t("colRename"), "iconEdit")}
  ${actionHtml("codel", t("collectDelete"), "iconTrashcan")}
</li>`;
}

function folderHtml(v: QuizView, node: ColTreeNode, depth: number): string {
    const t = v.t;
    return `<li class="b3-list-item b3-list-item--hide-action" data-dir="${esc(node.path)}" style="${liVars(depth)}">
  ${toggleHtml(depth, true)}
  <span class="b3-list-item__icon">${svgIcon("iconFolder")}</span>
  <span class="b3-list-item__text b3-tooltips b3-tooltips__e wengu-cp-name" data-dirname data-full="${esc(
      node.path
  )}" aria-label="${esc(node.path)}">${esc(node.name)}</span>
  <span class="counter">${countCols(node)}</span>
  ${actionHtml("dirnew", t("colNewSub"), "iconAdd")}
  ${actionHtml("dirren", t("colRename"), "iconEdit")}
  ${actionHtml("dirdel", t("colDelFolder"), "iconTrashcan")}
</li><ul data-dirchildren>${treeHtml(v, node, depth + 1)}</ul>`;
}

/** 一层的行与子目录按名混排（官方文档树同款，不分组前置）。 */
function treeHtml(v: QuizView, node: ColTreeNode, depth: number): string {
    return [
        ...node.rows.map((r) => ({ name: r.name, html: rowHtml(v, r, depth) })),
        ...node.children.map((c) => ({ name: c.name, html: folderHtml(v, c, depth) })),
    ]
        .sort((a, b) => a.name.localeCompare(b.name, "zh"))
        .map((i) => i.html)
        .join("");
}

/** 新建文件夹的内联输入行（Enter 提交、Esc/失焦取消）。 */
function folderInputLi(v: QuizView, depth: number, prefix: string): string {
    return `<li class="b3-list-item" style="${liVars(depth)}">
  ${toggleHtml(depth)}
  <span class="b3-list-item__icon">${svgIcon("iconFolder")}</span>
  <input class="b3-text-field fn__flex-1" placeholder="${esc(v.t("colFolderPh"))}" data-prefix="${esc(prefix)}">
</li>`;
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
    const tree = buildColTree(view, (await bank.all()).folders);
    const empty = tree.rows.length + tree.children.length === 0;
    root.innerHTML = `<div class="wengu-ws-page">
  <div class="wengu-ws-title">${esc(t("colPanelTitle"))}
    <span class="wengu-ws-titlebtns">
      <button type="button" class="b3-button b3-button--outline" data-colnewfolder>${svgIcon("iconAdd")} ${esc(
          t("colNewFolder")
      )}</button>
      <button type="button" class="b3-button b3-button--outline" data-collect>${svgIcon("iconSparkles")} ${esc(
          t("colCollect")
      )}</button>
      <button type="button" class="b3-button b3-button--text" data-crefresh>${svgIcon("iconRefresh")}</button>
    </span>
  </div>
  <div class="wengu-col-list wengu-cp-list">
    <ul class="b3-list b3-list--background wengu-cp-tree">${treeHtml(v, tree, 0)}</ul>
    ${empty ? `<div class="wengu-muted">${esc(t("colEmpty"))}</div>` : ""}
  </div>
</div>`;
    bindCollectionPanel(v, root);
}

/** 两击确认（首击图标变「确认」红字、3s 复原；专题/文件夹删除共用）。 */
function armAction(btn: HTMLElement, t: (key: string) => string, icon: string, onConfirm: () => void): void {
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reset = (): void => {
        armed = false;
        btn.classList.remove("wengu-cp-armed");
        btn.innerHTML = svgIcon(icon);
    };
    btn.addEventListener("click", () => {
        if (!armed) {
            armed = true;
            btn.classList.add("wengu-cp-armed");
            btn.textContent = t("collectConfirm");
            timer = setTimeout(reset, 3000);
            return;
        }
        clearTimeout(timer);
        reset();
        onConfirm();
    });
}

/** 名字 span → 行内输入框（改名专题=编辑完整标题；改名文件夹=编辑完整路径）。 */
function bindInlineRename(span: HTMLElement, onCommit: (next: string) => Promise<void>): void {
    const origin = span.dataset.full || span.textContent || "";
    span.innerHTML = `<input class="b3-text-field fn__flex-1" value="${esc(origin)}">`;
    span.classList.add("wengu-cp-editing");
    const input = span.querySelector<HTMLInputElement>("input")!;
    input.focus();
    input.select();
    const commit = async (): Promise<void> => {
        const next = input.value.trim().slice(0, 60);
        restore();
        if (!next || next === origin) return;
        await onCommit(next);
    };
    const restore = (): void => {
        span.classList.remove("wengu-cp-editing");
        span.textContent = origin;
    };
    input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") void commit();
        if (ev.key === "Escape") restore();
    });
    input.addEventListener("blur", () => void commit());
}

/** 内联输入行绑定：Enter 建文件夹（prefix 可带父路径），Esc/失焦取消。 */
function bindFolderInput(bank: QuestionBank, li: HTMLElement, rerender: () => void): void {
    const input = li.querySelector<HTMLInputElement>("input");
    if (!input) return;
    input.focus();
    const done = (): void => li.remove();
    const commit = async (): Promise<void> => {
        const prefix = input.dataset.prefix ?? "";
        const val = input.value.trim();
        done();
        if (!val) return;
        await createFolder(bank, prefix ? `${prefix}/${val}` : val);
        await bank.flush();
        rerender();
    };
    input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") void commit();
        if (ev.key === "Escape") done();
    });
    input.addEventListener("blur", () => done());
}

function bindCollectionPanel(v: QuizView, root: HTMLElement): void {
    const t = v.t;
    const bank = v.bankStore();
    if (!bank) return;
    const colFlow = v.colFlowOf();
    const rerender = (): void => void renderCollectionPanelInto(v, root);
    const refreshFlows = (): void => void colFlow.refresh().then((): void => colFlow.refreshSide());
    const treeEl = root.querySelector<HTMLUListElement>(".wengu-cp-tree");
    const refreshCols = async (): Promise<void> => {
        await bank.flush();
        refreshFlows();
        rerender();
    };
    root.querySelector<HTMLButtonElement>("[data-collect]")?.addEventListener("click", () => colFlow.openDialog());
    root.querySelector<HTMLButtonElement>("[data-crefresh]")?.addEventListener("click", rerender);
    root.querySelector<HTMLButtonElement>("[data-colnewfolder]")?.addEventListener("click", () => {
        if (!treeEl || treeEl.querySelector(".wengu-cp-folder-input")) return;
        treeEl.insertAdjacentHTML("afterbegin", folderInputLi(v, 0, ""));
        const li = treeEl.firstElementChild as HTMLElement;
        li.querySelector("input")?.classList.add("wengu-cp-folder-input");
        bindFolderInput(bank, li, rerender);
    });
    // 折叠：箭头/文件夹名切换子 ul 显隐（fn__none）+ 箭头旋转
    for (const el of root.querySelectorAll<HTMLElement>("[data-dirtoggle], [data-dirname]")) {
        el.addEventListener("click", () => {
            const li = el.closest("li");
            const kids = li?.nextElementSibling as HTMLElement | null;
            if (!kids) return;
            const open = kids.classList.toggle("fn__none") === false;
            li?.querySelector(".b3-list-item__arrow")?.classList.toggle("b3-list-item__arrow--open", open);
        });
    }
    for (const row of root.querySelectorAll<HTMLElement>("li[data-cid]")) {
        const cid = row.dataset.cid ?? "";
        const nameEl = row.querySelector<HTMLElement>("[data-cogo]");
        nameEl?.addEventListener("click", () => {
            if (nameEl.querySelector("input")) return; // 改名编辑态不触发
            colFlow.switchTo(cid);
            v.switchWorkspace("drill");
        });
        row.querySelector<HTMLElement>("[data-coren]")?.addEventListener("click", () => {
            const span = row.querySelector<HTMLElement>(".wengu-cp-name");
            if (!span || span.querySelector("input")) return;
            bindInlineRename(span, async (next): Promise<void> => {
                await bank.renameCollection(cid, next);
                await refreshCols();
            });
        });
        row.querySelector<HTMLElement>("[data-codel]")?.addEventListener("click", (ev) =>
            armAction(
                ev.currentTarget as HTMLElement,
                t,
                "iconTrashcan",
                () =>
                    void (async () => {
                        await bank.deleteCollection(cid);
                        await v.historyStore()?.removeDocs([`col:${cid}`]); // 轮次归档联动清
                        if (colFlow.id() === cid) {
                            colFlow.reset();
                            void v.reloadView();
                        } else {
                            refreshFlows();
                        }
                        rerender();
                    })()
            )
        );
    }
    for (const row of root.querySelectorAll<HTMLElement>("li[data-dir]")) {
        const dir = row.dataset.dir ?? "";
        const depth = dir.split("/").length; // 子级深度=段数（根目录段数 1 → 子行 depth 1）
        row.querySelector<HTMLElement>("[data-dirnew]")?.addEventListener("click", () => {
            const kids = row.nextElementSibling as HTMLElement | null;
            if (!kids || kids.querySelector(".wengu-cp-folder-input")) return;
            kids.classList.remove("fn__none");
            row.querySelector(".b3-list-item__arrow")?.classList.add("b3-list-item__arrow--open");
            kids.insertAdjacentHTML("afterbegin", folderInputLi(v, depth, dir));
            const li = kids.firstElementChild as HTMLElement;
            li.querySelector("input")?.classList.add("wengu-cp-folder-input");
            bindFolderInput(bank, li, rerender);
        });
        row.querySelector<HTMLElement>("[data-dirren]")?.addEventListener("click", () => {
            const span = row.querySelector<HTMLElement>("[data-dirname]");
            if (!span || span.querySelector("input")) return;
            bindInlineRename(span, async (next): Promise<void> => {
                await renameFolder(bank, dir, next);
                await refreshCols();
            });
        });
        row.querySelector<HTMLElement>("[data-dirdel]")?.addEventListener("click", (ev) =>
            armAction(
                ev.currentTarget as HTMLElement,
                t,
                "iconTrashcan",
                () =>
                    void (async () => {
                        const dead = await deleteFolder(bank, dir);
                        await v.historyStore()?.removeDocs(dead.map((id) => `col:${id}`));
                        if (dead.includes(colFlow.id())) {
                            colFlow.reset();
                            void v.reloadView();
                        } else {
                            refreshFlows();
                        }
                        rerender();
                    })()
            )
        );
    }
}
