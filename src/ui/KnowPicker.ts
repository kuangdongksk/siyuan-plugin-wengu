import { esc } from "./shared";
import { svgIcon } from "./FormHtml";
import { KernelQuery } from "../siyuan/query";
import { mountSvelteApp, type MountedSvelteApp } from "./mountApp";
import KnowPickerApp from "./KnowPickerApp.svelte";

/**
 * 文档选择器（UI 标准第 7 条：长列表选择用官方风格可搜索浮层）：
 * 挂 body 的 b3-menu 下拉（b3-menu__filter + b3-list）。单选即点即回；
 * 多选行内勾选 + 底部「清空/确定」。SQL 恒带 LIMIT（内核无 LIMIT 静默
 * 截断 64 行的坑），关键词过滤引号/通配符防 SQL 串坏。
 *
 * 20260827 树化（variant-and-doctree §二 T1~T3）：空搜索默认展示
 * hPath 树（分支折叠、仅文档行可点），输入关键词切平铺结果、清空回树
 * （思源文档树同款模式）。树数据分页串行拉全量，60s 内缓存复用。
 * 20260830 树渲染收敛共享组件 TreeList（挂 KnowPickerApp，勾选/展开
 * 是组件内响应态，本文件经实例导出读写；平铺搜索行仍字符串模板，
 * 勾选与之共用同一份事实源）。
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
    const all = await KernelQuery.rowsAll<{ id: string; hpath: string }>(
        "SELECT id, hpath FROM blocks WHERE type='d' ORDER BY hpath",
        100
    );
    treeCache = { at: Date.now(), docs: all };
    return all;
}

let menuEl: HTMLElement | null = null;
/** 树组件实例（勾选事实源；与 menuEl 同生命周期，单浮层全局一份）。 */
let treeApp: MountedSvelteApp<PickerAppExports> | null = null;

function unmountTree(): void {
    treeApp?.unmount();
    treeApp = null;
}

function closePickerMenu(): void {
    unmountTree();
    menuEl?.remove();
    menuEl = null;
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onDocKey, true);
}

function onDocPointer(ev: Event): void {
    if (menuEl && ev.target instanceof Node && !menuEl.contains(ev.target)) closePickerMenu();
}

function onDocKey(ev: Event): void {
    if ((ev as KeyboardEvent).key === "Escape") closePickerMenu();
}

/** 树组件实例导出（勾选事实源，平铺行/清空/确定共用）。 */
interface PickerAppExports {
    getSelected(): string[];
    toggleSelected(id: string): void;
    clearSelected(): void;
}

export function openKnowPicker(opts: KnowPickerOpts): void {
    const { t } = opts;
    closePickerMenu();
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
    // 双宿主并存：树=挂载组件的容器，平铺=搜索结果字符串模板；切换只
    // 翻 hidden（勾选事实源在组件实例里，平铺行读写都经实例导出）
    const treeHost = document.createElement("div");
    const flatHost = document.createElement("div");
    flatHost.hidden = true;
    list.replaceChildren(treeHost, flatHost);

    const mountTree = (docs: { id: string; hpath: string }[]): void => {
        unmountTree();
        treeHost.innerHTML = "";
        const mounted = mountSvelteApp(KnowPickerApp, treeHost, {
            docs,
            current: opts.current[0] ?? "",
            multi: !single,
            initialSelected: opts.current,
            onpick: single
                ? (id: string) => {
                      closePickerMenu();
                      opts.onConfirm([id]);
                  }
                : undefined,
        });
        // *.svelte 的环境声明不带实例导出类型，这里收口一次
        treeApp = { app: mounted.app as PickerAppExports, unmount: mounted.unmount };
    };

    const syncFlatTicks = (): void => {
        const sel = new Set(treeApp?.app.getSelected() ?? []);
        for (const row of flatHost.querySelectorAll<HTMLElement>("[data-id]")) {
            row.querySelector(".b3-list-item__action")?.classList.toggle("fn__none", !sel.has(row.dataset.id ?? ""));
        }
    };

    // 平铺只隐藏树不卸载：树组件是多选勾选的事实源（平铺行/确定钮经
    // 实例导出读写），卸了=勾不上+确定回空（多选下还反向清空已有登记）
    const showFlat = (docs: PickerDoc[]): void => {
        treeHost.hidden = true;
        flatHost.hidden = false;
        flatHost.innerHTML = docs.length
            ? docs
                  .map((d) => {
                      const on = single ? opts.current[0] === d.id : false;
                      const label = d.hpath || d.content || d.id;
                      return `<div class="b3-list-item b3-list-item--narrow${on ? " b3-list-item--focus" : ""}" data-id="${
                          d.id
                      }" title="${esc(label)}"><span class="b3-list-item__text">${esc(label)}</span>${
                          single ? "" : `<span class="b3-list-item__action fn__none">${svgIcon("iconCheck")}</span>`
                      }</div>`;
                  })
                  .join("")
            : `<div class="b3-list--empty">${esc(t("knowPickEmpty"))}</div>`;
    };

    const showTree = (): void => {
        flatHost.hidden = true;
        treeHost.hidden = false;
        if (treeApp) return; // 树已挂载（搜索回树不重灌）
        if (treeCache && Date.now() - treeCache.at < TREE_TTL) {
            mountTree(treeCache.docs);
            return;
        }
        treeHost.innerHTML = "<div class='wengu-muted'>…</div>";
        void fetchTreeDocs()
            .then((docs) => {
                if (menuEl === wrap) mountTree(docs);
            })
            .catch(() => {
                if (menuEl === wrap) {
                    unmountTree();
                    treeHost.innerHTML = `<div class="b3-list--empty">${esc(t("knowPickEmpty"))}</div>`;
                }
            });
    };

    let timer = 0;
    const reload = (): void => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            const kw = wrap.querySelector("input")?.value.trim() ?? "";
            if (!kw) {
                showTree();
                return;
            }
            void queryDocs(kw)
                .then((docs) => {
                    if (menuEl === wrap) showFlat(docs);
                })
                .catch(() => {
                    if (menuEl === wrap) showFlat([]);
                });
        }, 300);
    };
    wrap.querySelector("input")!.addEventListener("input", reload);

    // 平铺行点击：单选即确认；多选切勾（勾选事实源在组件实例，树回显自动同步）
    flatHost.addEventListener("click", (ev) => {
        const row = (ev.target as HTMLElement).closest<HTMLElement>("[data-id]");
        const id = row?.dataset.id ?? "";
        if (!id) return;
        if (single) {
            closePickerMenu();
            opts.onConfirm([id]);
            return;
        }
        treeApp?.app.toggleSelected(id);
        syncFlatTicks();
    });
    wrap.querySelector<HTMLButtonElement>("[data-act='kp-clear']")?.addEventListener("click", () => {
        treeApp?.app.clearSelected();
        syncFlatTicks();
    });
    wrap.querySelector<HTMLButtonElement>("[data-act='kp-ok']")?.addEventListener("click", () => {
        const ids = treeApp?.app.getSelected() ?? [];
        closePickerMenu();
        opts.onConfirm(ids);
    });

    document.body.appendChild(wrap);
    menuEl = wrap;
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKey, true);
    showTree(); // 默认树；输入关键词由 input 事件切平铺
    wrap.querySelector<HTMLInputElement>("input")!.focus();
}
