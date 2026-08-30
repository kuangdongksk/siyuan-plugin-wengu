/**
 * 专题面板的视图模型层（Svelte 化前的渲染/绑定已删，20260830）：
 * 类型 + 树化/统计纯函数 + 行样式辅助，供 comp/CollectionPanelApp 与
 * core/ColPanelCtl 消费，单测覆盖 buildColTree/summarizeSessions。
 * 面板语义：官方文档树同款树形（目录=标题含「/」派生 + 手动新建的
 * 空文件夹合并展示），行操作=点击进刷题、行内改名、两击确认删除；
 * 文件夹另有新建子文件夹/改名/删除（删=清严格前缀下全部专题并联动
 * col: 会话）。
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

/** 「最近刷题」列的时间格式（M/D HH:mm）。 */
export function fmtTime(ts: number): string {
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
export function countCols(node: ColTreeNode): number {
    return node.rows.length + node.children.reduce((n, c) => n + countCols(c), 0);
}

/* ── 官方文档树同款行壳（行内 CSS 变量与 stage 实测一致） ── */

const INDENT = 18;

/** 行缩进变量（--file-toggle-width 拖拽高亮留用；depth 0 官方为 22/22）。 */
export function liVars(depth: number): string {
    const w = depth === 0 ? 22 : 18 + depth * INDENT;
    return `--file-toggle-width:${w}px;--file-action-offset:${depth === 0 ? 22 : w + 2}px`;
}

/** 折叠箭头的缩进量（depth>0 时 padding-left，叶子占位与文件夹共用）。 */
export const TOGGLE_INDENT = INDENT;
