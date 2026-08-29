import type { BankData, QuestionBank } from "./QuestionBank";
import { normalizeCollectionPath } from "./QuestionBank";

/**
 * 专题目录文件夹操作（20260829，BankMigrate 同款友元模块——
 * QuestionBank 已贴 500 行红线，文件夹 CRUD 落这里）：文件夹是
 * 「标题含 / 派生目录」之外的持久化空目录（BankData.folders），
 * 树形合并展示在 CollectionPanel.buildColTree。纯函数 *In 直改
 * BankData 供单测；async 包装给面板用（走 bank.all + markDirty）。
 */

/** 新建文件夹（路径可含 / 建层级；规范化后为空或重复则忽略）。 */
export function folderCreateIn(data: BankData, path: string): boolean {
    const p = normalizeCollectionPath(path);
    if (!p || data.folders.includes(p)) return false;
    data.folders.push(p);
    return true;
}

/** 删除文件夹：清文件夹条目（含子路径）+ 严格前缀下的全部专题
 *  （标题恰等于文件夹名的平铺专题不受牵连），返回被删专题 id
 *  （调用方联动清 col: 会话）。 */
export function folderDeleteIn(data: BankData, path: string): string[] {
    const p = normalizeCollectionPath(path);
    if (!p) return [];
    const dead = data.collections.filter((c) => c.title.startsWith(`${p}/`)).map((c) => c.id);
    data.collections = data.collections.filter((c) => !c.title.startsWith(`${p}/`));
    data.folders = data.folders.filter((f) => f !== p && !f.startsWith(`${p}/`));
    return dead;
}

/** 重命名文件夹：严格前缀下的专题标题与文件夹条目（含自身）改前缀；
 *  改写后超长按整段截断（normalizeCollectionPath），条目去重。 */
export function folderRenameIn(data: BankData, from: string, to: string): boolean {
    const f = normalizeCollectionPath(from);
    const t = normalizeCollectionPath(to);
    if (!f || !t || f === t) return false;
    const re = (s: string): string => (s === f || s.startsWith(`${f}/`) ? t + s.slice(f.length) : s);
    let changed = false;
    for (const c of data.collections) {
        if (!c.title.startsWith(`${f}/`)) continue;
        c.title = normalizeCollectionPath(re(c.title)) || c.title;
        changed = true;
    }
    const next = [...new Set(data.folders.map(re))];
    changed = changed || next.some((s, i) => s !== data.folders[i]) || next.length !== data.folders.length;
    data.folders = next;
    return changed;
}

export async function createFolder(bank: QuestionBank, path: string): Promise<void> {
    const data = await bank.all();
    if (folderCreateIn(data, path)) bank.markDirty();
}

/** 删除文件夹，返回被删专题 id（col: 会话联动清用）。 */
export async function deleteFolder(bank: QuestionBank, path: string): Promise<string[]> {
    const data = await bank.all();
    const p = normalizeCollectionPath(path);
    const hadFolder = !!p && data.folders.some((f) => f === p || f.startsWith(`${p}/`));
    const dead = folderDeleteIn(data, path);
    if (dead.length > 0 || hadFolder) bank.markDirty();
    return dead;
}

export async function renameFolder(bank: QuestionBank, from: string, to: string): Promise<void> {
    const data = await bank.all();
    if (folderRenameIn(data, from, to)) bank.markDirty();
}
