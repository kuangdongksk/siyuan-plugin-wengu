import type { QuizView } from "../../quiz";
import type { QuestionBank } from "../data/QuestionBank";
import { createFolder, deleteFolder, renameFolder } from "../data/BankFolders";
import { summarizeSessions, type ColRowView, type ColTreeNode } from "../ui/CollectionPanel";
import { fmt } from "../../ui/shared";
import type { ColPanelUi } from "./ColPanelUi";

/**
 * 专题管理面板控制器（四件套之一）：装载聚合（专题清单 + 逐专题会话
 * 统计串行拉取——fetchSyncPost 并发互吞，真机踩坑）、折叠/改名/两击
 * 删除/新建文件夹的状态机。旧 innerHTML 全量重绘换成 ui 字段写入，
 * 折叠态不再随刷新重置。卸载后 load 作废（alive 标志，对应旧实现的
 * root.isConnected 竞态守卫）。
 */
export class ColPanelCtl {
    private alive = true;
    private armTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly ui: ColPanelUi,
        private readonly v: QuizView
    ) {}

    destroy(): void {
        this.alive = false;
        if (this.armTimer) clearTimeout(this.armTimer);
        this.armTimer = undefined;
    }

    private bank(): QuestionBank | undefined {
        return this.v.bankStore();
    }

    /** 装载/重拉（刷新按钮、增删改后都走这里）。 */
    async load(): Promise<void> {
        const bank = this.bank();
        if (!bank) {
            this.ui.phase = "nobank";
            return;
        }
        this.ui.phase = "loading";
        this.ui.editing = undefined;
        this.disarm();
        this.ui.folderInput = undefined;
        const rows = (await bank.collectionsView()).filter((r) => !r.id.startsWith("doc:"));
        const history = this.v.historyStore();
        const view: ColRowView[] = [];
        for (const r of rows) {
            // 会话统计逐专题串行（内核并发互吞）
            const sessions = history ? await history.docSessions(`col:${r.id}`) : [];
            view.push({ id: r.id, title: r.title, name: r.title, count: r.count, stat: summarizeSessions(sessions) });
        }
        const folders = (await bank.all()).folders;
        if (!this.alive) return; // 卸载后落盘作废（骨架可能已被重建）
        this.ui.rows = view;
        this.ui.folders = folders;
        this.ui.phase = "ready";
    }

    /** 侧栏专题清单联动刷新（增删改后）。 */
    private refreshFlows(): void {
        const colFlow = this.v.colFlowOf();
        void colFlow.refresh().then((): void => colFlow.refreshSide());
    }

    /** 增删改收尾：落盘 + 侧栏联动 + 重拉面板数据。 */
    private async refreshCols(): Promise<void> {
        const bank = this.bank();
        if (bank) await bank.flush();
        this.refreshFlows();
        await this.load();
    }

    toggleDir(path: string): void {
        if (this.ui.closedDirs.has(path)) this.ui.closedDirs.delete(path);
        else this.ui.closedDirs.add(path);
    }

    /** 点击专题：切题库模式进刷题。 */
    openCollection(id: string): void {
        this.v.colFlowOf().switchTo(id);
        this.v.switchWorkspace("drill");
    }

    /** 头部「按知识点收集」弹窗。 */
    openCollectDialog(): void {
        this.v.colFlowOf().openDialog();
    }

    /* ── 行内改名（编辑态由 ui.editing 驱动，输入框非受控） ── */

    startRenameCol(r: ColRowView): void {
        if (this.ui.editing) return;
        this.ui.editing = { kind: "col", key: r.id, origin: r.title };
    }

    startRenameDir(node: ColTreeNode): void {
        if (this.ui.editing) return;
        this.ui.editing = { kind: "dir", key: node.path, origin: node.path };
    }

    cancelEdit(): void {
        this.ui.editing = undefined;
    }

    /** Enter/blur 提交（从 DOM 收值；Esc 先清 editing 再触发 blur 时静默）。 */
    async commitRenameEl(el: HTMLInputElement): Promise<void> {
        const e = this.ui.editing;
        if (!e) return;
        const next = el.value.trim().slice(0, 60);
        this.ui.editing = undefined;
        if (!next || next === e.origin) return;
        const bank = this.bank();
        if (!bank) return;
        if (e.kind === "col") await bank.renameCollection(e.key, next);
        else await renameFolder(bank, e.key, next);
        await this.refreshCols();
    }

    /* ── 两击确认删除（3s 复位；专题/文件夹共用状态机） ── */

    armDeleteCol(id: string): void {
        if (this.ui.armed === id) {
            this.disarm();
            void this.deleteCol(id);
            return;
        }
        this.arm(id);
    }

    armDeleteDir(path: string): void {
        if (this.ui.armed === path) {
            this.disarm();
            void this.deleteDir(path);
            return;
        }
        // 删文件夹连带删严格前缀下的全部专题（含派生挂进来的）——确认
        // 文案明示连带数，避免「删空壳目录却清了一片专题」的误伤
        const n = this.ui.rows.filter((r) => r.title.startsWith(`${path}/`)).length;
        this.arm(path, n > 0 ? fmt(this.v.t("colDelFolderConfirm"), { n: String(n) }) : undefined);
    }

    private arm(key: string, note?: string): void {
        this.disarm();
        this.ui.armed = key;
        this.ui.armedNote = note;
        this.armTimer = setTimeout((): void => {
            this.ui.armed = undefined;
            this.ui.armedNote = undefined;
            this.armTimer = undefined;
        }, 3000);
    }

    private disarm(): void {
        if (this.armTimer) clearTimeout(this.armTimer);
        this.armTimer = undefined;
        this.ui.armed = undefined;
        this.ui.armedNote = undefined;
    }

    private async deleteCol(id: string): Promise<void> {
        const bank = this.bank();
        if (!bank) return;
        await bank.deleteCollection(id);
        await this.v.historyStore()?.removeDocs([`col:${id}`]); // 轮次归档联动清
        this.afterDelete([id]);
        await this.load();
    }

    private async deleteDir(path: string): Promise<void> {
        const bank = this.bank();
        if (!bank) return;
        const dead = await deleteFolder(bank, path);
        await this.v.historyStore()?.removeDocs(dead.map((id) => `col:${id}`));
        this.afterDelete(dead);
        await this.load();
    }

    /** 删的是当前专题 → 回文档模式重载；否则只刷侧栏。 */
    private afterDelete(dead: string[]): void {
        const colFlow = this.v.colFlowOf();
        if (dead.includes(colFlow.id())) {
            colFlow.reset();
            void this.v.reloadView();
        } else {
            this.refreshFlows();
        }
    }

    /* ── 新建文件夹（内联输入行：Enter 提交，Esc/失焦取消不提交） ── */

    /** 打开输入行（prefix 定位层级：空串=树顶层；同時展开目标目录）。 */
    openFolderInput(prefix: string): void {
        if (this.ui.folderInput) return;
        if (prefix) this.ui.closedDirs.delete(prefix);
        this.ui.folderInput = { prefix, depth: prefix ? prefix.split("/").length : 0 };
    }

    closeFolderInput(): void {
        this.ui.folderInput = undefined;
    }

    async confirmFolderEl(el: HTMLInputElement): Promise<void> {
        const fi = this.ui.folderInput;
        this.ui.folderInput = undefined;
        const val = el.value.trim();
        if (!fi || !val) return;
        const bank = this.bank();
        if (!bank) return;
        await createFolder(bank, fi.prefix ? `${fi.prefix}/${val}` : val);
        await bank.flush();
        await this.load();
    }
}
