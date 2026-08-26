import { esc } from "./shared";
import { svgIcon } from "./FormHtml";
import { KernelQuery } from "../siyuan/query";
import { buildPickerTree, renderPickerTree, PickerTreeNode } from "./PickerTree";

/**
 * 文档选择器（UI 标准第 7 条：长列表选择用官方风格可搜索浮层）：
 * 挂 body 的 b3-menu 下拉（b3-menu__filter + b3-list），替代旧版大
 * Dialog（20260826 按用户意见改版）。单选即点即回；多选行内勾选 +
 * 底部「清空/确定」。SQL 恒带 LIMIT（内核无 LIMIT 静默截断 64 行的坑），
 * 关键词过滤引号/通配符防 SQL 串坏。
 *
 * 20260827 树化（variant-and-doctree §二 T1~T3）：空搜索默认展示
 * hPath 树（分支折叠、仅文档行可点），输入关键词切平铺结果、清空回树
 * （思源文档树同款模式）。树数据分页串行拉全量，60s 内缓存复用。
 */

interface PickerDoc {
    id: string;
    hpath: string;
    content: string;
}

export interface KnowPickerOpts {
    t: (key: string) => string;
    /** 触发按钮（浮层定位在其下方）。 */
    anchor: HTMLElement;
    /** 已选中的文档 id。 */
    current: string[];
    /** 确认：回传勾选的全部 id（单选只回第一个）。 */
    onConfirm(ids: string[]): void;
    /** 单选模式（源文档/父文档）：点击即确认关闭。 */
    single?: boolean;
}

/** 输入框里的原始串 → 合法块 id 列表（与转换侧同规则）。 */
export function parseKnowIds(raw: string): string[] {
    return raw
        .split(/[\s,;，；]+/)
        .map((s) => s.trim())
        .filter((s) => /^\d{14}-[a-z0-9]+$/i.test(s));
}

/** 关键词清洗：只留安全字符（防 LIKE 通配/引号破坏 SQL）。 */
function safeKeyword(kw: string): string {
    return kw.replace(/[^\w\u4e00-\u9fa5-]/g, "");
}

async function queryDocs(kw: string): Promise<PickerDoc[]> {
    const key = safeKeyword(kw);
    const like = key ? `AND (hpath LIKE '%${key}%' OR content LIKE '%${key}%') ` : "";
    return KernelQuery.rows<PickerDoc>(
        `SELECT id, hpath, content FROM blocks WHERE type='d' ${like}ORDER BY updated DESC LIMIT 100`
    );
}

/** 树数据缓存（浮层生命周期外也复用，60s 过期防陈旧；fetchSyncPost
 * 必须串行——分页逐页 await，ORDER BY hpath 保证 OFFSET 分页稳定）。 */
let treeCache: { at: number; docs: { id: string; hpath: string }[] } | null = null;
const TREE_TTL = 60000;

async function fetchTreeDocs(): Promise<{ id: string; hpath: string }[]> {
    if (treeCache && Date.now() - treeCache.at < TREE_TTL) return treeCache.docs;
    const all: { id: string; hpath: string }[] = [];
    for (let off = 0; off < 10000; off += 100) {
        const page = await KernelQuery.rows<{ id: string; hpath: string }>(
            `SELECT id, hpath FROM blocks WHERE type='d' ORDER BY hpath LIMIT 100 OFFSET ${off}`
        );
        all.push(...page);
        if (page.length < 100) break;
    }
    treeCache = { at: Date.now(), docs: all };
    return all;
}

let menuEl: HTMLElement | null = null;

function closePickerMenu(): void {
    menuEl?.remove();
    menuEl = null;
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onDocKey, true);
}

function onDocPointer(ev: Event): void {
    if (menuEl && ev.target instanceof Node && !menuEl.contains(ev.target)) closePickerMenu();
}

function onDocKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") closePickerMenu();
}

export function openKnowPicker(opts: KnowPickerOpts): void {
    const { t } = opts;
    closePickerMenu();
    const selected = new Set(opts.current);
    const single = opts.single === true;

    const wrap = document.createElement("div");
    wrap.className = "b3-menu wengu-doc-menu";
    wrap.innerHTML = `<div class="b3-menu__items" style="overflow: initial"><div>
  <div class="fn__flex-column b3-menu__filter">
    <input class="b3-text-field fn__block" type="search" spellcheck="false" placeholder="${esc(t("knowPickSearchPh"))}">
    <div class="fn__hr"></div>
    <div class="b3-list fn__flex-1 b3-list--background" data-act="kp-list"><div class="wengu-muted">…</div></div>
    ${
        single
            ? ""
            : `<div class="wengu-doc-menu-foot">
      <button type="button" class="b3-button b3-button--cancel" data-act="kp-clear">${esc(t("knowPickClear"))}</button>
      <button type="button" class="b3-button b3-button--outline" data-act="kp-ok">${esc(t("knowPickConfirm"))}</button>
    </div>`
    }
  </div>
</div></div>`;
    const rect = opts.anchor.getBoundingClientRect();
    wrap.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 400))}px`;
    wrap.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 80)}px`;

    const list = wrap.querySelector<HTMLElement>("[data-act='kp-list']")!;
    const rowOf = (d: PickerDoc): string => {
        const on = single ? opts.current[0] === d.id : selected.has(d.id);
        const label = d.hpath || d.content || d.id;
        return `<div class="b3-list-item b3-list-item--narrow${single && on ? " b3-list-item--focus" : ""}" data-id="${
            d.id
        }" title="${esc(label)}"><span class="b3-list-item__text">${esc(label)}</span>${
            single ? "" : `<span class="b3-list-item__action fn__none">${svgIcon("iconCheck")}</span>`
        }</div>`;
    };
    const syncTicks = (): void => {
        for (const row of Array.from(list.querySelectorAll<HTMLElement>("[data-id]"))) {
            const tick = row.querySelector<HTMLElement>(".b3-list-item__action");
            if (tick) tick.classList.toggle("fn__none", !selected.has(row.dataset.id ?? ""));
        }
    };
    const render = (docs: PickerDoc[]): void => {
        list.innerHTML = docs.length
            ? docs.map(rowOf).join("")
            : `<div class="b3-list--empty">${esc(t("knowPickEmpty"))}</div>`;
        syncTicks();
    };

    let timer = 0;
    let seq = 0;
    // 树态：节点首拉后常驻本次浮层；展开集合默认第一层（笔记本级）
    let treeNodes: PickerTreeNode[] | null = null;
    const openPaths = new Set<string>();
    const renderTree = (): void => {
        list.innerHTML = treeNodes?.length
            ? renderPickerTree(treeNodes, { selected, current: opts.current[0] ?? "", openPaths }, single)
            : `<div class="b3-list--empty">${esc(t("knowPickEmpty"))}</div>`;
    };
    const showTree = (): void => {
        const cur = ++seq;
        if (treeNodes) {
            renderTree();
            return;
        }
        list.innerHTML = "<div class='wengu-muted'>…</div>";
        fetchTreeDocs()
            .then((docs) => {
                if (cur !== seq) return;
                treeNodes = buildPickerTree(docs);
                for (const n of treeNodes) if (n.children.length > 0) openPaths.add(n.path);
                renderTree();
            })
            .catch(() => {
                if (cur !== seq) return;
                renderTree();
            });
    };
    const reload = (): void => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            const kw = wrap.querySelector("input")?.value.trim() ?? "";
            if (!kw) {
                showTree();
                return;
            }
            const cur = ++seq;
            void queryDocs(kw)
                .then((docs) => {
                    if (cur === seq) render(docs);
                })
                .catch(() => {
                    if (cur === seq) render([]);
                });
        }, 300);
    };
    wrap.querySelector("input")!.addEventListener("input", reload);

    list.addEventListener("click", (ev) => {
        // 折叠箭头优先于文档行选中（箭头在文档行内，closest 先命中）
        const toggle = (ev.target as HTMLElement).closest<HTMLElement>("[data-tree-path]");
        if (toggle) {
            const p = toggle.dataset.treePath ?? "";
            if (openPaths.has(p)) openPaths.delete(p);
            else openPaths.add(p);
            renderTree();
            return;
        }
        const row = (ev.target as HTMLElement).closest<HTMLElement>("[data-id]");
        const id = row?.dataset.id ?? "";
        if (!id) return;
        if (single) {
            closePickerMenu();
            opts.onConfirm([id]);
            return;
        }
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
        syncTicks();
    });
    wrap.querySelector<HTMLButtonElement>("[data-act='kp-clear']")?.addEventListener("click", () => {
        selected.clear();
        syncTicks();
    });
    wrap.querySelector<HTMLButtonElement>("[data-act='kp-ok']")?.addEventListener("click", () => {
        closePickerMenu();
        opts.onConfirm(Array.from(selected));
    });

    document.body.appendChild(wrap);
    menuEl = wrap;
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKey, true);
    showTree(); // 默认树；输入关键词由 input 事件切平铺
    wrap.querySelector<HTMLInputElement>("input")!.focus();
}
