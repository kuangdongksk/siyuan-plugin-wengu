import { esc } from "./shared";
import { svgIcon } from "./FormHtml";
import { KernelQuery } from "../siyuan/query";

/**
 * 文档选择器（UI 标准第 7 条：长列表选择用官方风格可搜索浮层）：
 * 挂 body 的 b3-menu 下拉（b3-menu__filter + b3-list），替代旧版大
 * Dialog（20260826 按用户意见改版）。单选即点即回；多选行内勾选 +
 * 底部「清空/确定」。SQL 恒带 LIMIT（内核无 LIMIT 静默截断 64 行的坑），
 * 关键词过滤引号/通配符防 SQL 串坏。
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
    const reload = (): void => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            void queryDocs(wrap.querySelector("input")?.value ?? "")
                .then(render)
                .catch(() => render([]));
        }, 300);
    };
    wrap.querySelector("input")!.addEventListener("input", reload);

    list.addEventListener("click", (ev) => {
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
    reload();
    wrap.querySelector<HTMLInputElement>("input")!.focus();
}
