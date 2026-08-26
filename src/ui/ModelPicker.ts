import { defaultAgentModelId, listAiModels, type WenguAiModel } from "../convert/AgentClient";
import { esc } from "./shared";

/**
 * 模型选择控件（UI 标准第 7 条：候选 >20 的长列表不用原生 select）：
 * 触发按钮 + 模仿思源官方「带搜索的下拉」浮层（b3-menu__filter +
 * b3-list--background + b3-list-item--narrow，类名照抄官方 commonMenu
 * 的 DOM 结构，视觉与原生一致）。转换弹窗与设置页共用。
 */

function labelOf(m: WenguAiModel): string {
    return `${m.provider} · ${m.name}`;
}

/** 触发按钮（占位与 formSelect 同宽 fn__size200；当前值存 data-value）。 */
export function modelPickHtml(field: string, selectedId: string, act = "data-act"): string {
    const models = listAiModels();
    const sel = selectedId && models.some((m) => m.id === selectedId) ? selectedId : defaultAgentModelId();
    const cur = models.find((m) => m.id === sel);
    const text = cur ? labelOf(cur) : "-";
    return `<button type="button" class="b3-button b3-button--outline fn__size200 wengu-model-pick" ${act}="${field}" data-value="${esc(
        sel
    )}" title="${esc(text)}">${esc(text)}</button>`;
}

interface PickOptions {
    t: (key: string) => string;
    /** 选中后回调（设置页立即落盘用；转换弹窗不传、提交时读 data-value）。 */
    onPick?: (value: string) => void;
}

/** 绑定触发按钮：点击弹官方风格搜索浮层，选中回填按钮文字与 data-value。 */
export function bindModelPicker(btn: HTMLButtonElement | null, opts: PickOptions): void {
    if (!btn) return;
    btn.addEventListener("click", () => {
        if (btn.disabled) return;
        closeModelMenu();
        // 挂 body：弹窗内容区 overflow:auto 会裁剪内部浮层，且开窗动画的
        // transform 会让 position:fixed 错位
        document.body.appendChild(buildMenu(btn, opts));
        btn.classList.add("b3-button--focus");
    });
}

let menuEl: HTMLElement | null = null;
let menuOwner: HTMLElement | null = null;

function closeModelMenu(): void {
    menuEl?.remove();
    menuEl = null;
    menuOwner?.classList.remove("b3-button--focus");
    menuOwner = null;
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onDocKey, true);
}

function onDocPointer(ev: Event): void {
    if (menuEl && ev.target instanceof Node && !menuEl.contains(ev.target)) closeModelMenu();
}

function onDocKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") closeModelMenu();
}

function buildMenu(btn: HTMLButtonElement, opts: PickOptions): HTMLElement {
    const models = listAiModels();
    const wrap = document.createElement("div");
    wrap.className = "b3-menu wengu-model-menu";
    wrap.innerHTML = `<div class="b3-menu__items" style="overflow: initial"><div>
  <div class="fn__flex-column b3-menu__filter">
    <input class="b3-text-field fn__block" placeholder="${esc(opts.t("modelSearch"))}">
    <div class="fn__hr"></div>
    <div class="b3-list fn__flex-1 b3-list--background">${models
        .map(
            (m) =>
                `<div class="b3-list-item b3-list-item--narrow${
                    m.id === btn.dataset.value ? " b3-list-item--focus" : ""
                }" data-id="${esc(m.id)}"><span class="b3-list-item__text">${esc(labelOf(m))}</span></div>`
        )
        .join("")}
      <div class="b3-list--empty fn__none" data-type="empty">${esc(opts.t("modelEmpty"))}</div>
    </div>
  </div>
</div></div>`;
    const rect = btn.getBoundingClientRect();
    wrap.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 320))}px`;
    wrap.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 60)}px`;

    const list = wrap.querySelector<HTMLElement>(".b3-list")!;
    const empty = wrap.querySelector<HTMLElement>('[data-type="empty"]')!;
    const applyFilter = (kw: string) => {
        const q = kw.trim().toLowerCase();
        let visible = 0;
        for (const item of Array.from(list.children)) {
            if (!(item instanceof HTMLElement) || item.dataset.type === "empty") continue;
            const hit = !q || (item.textContent ?? "").toLowerCase().includes(q);
            item.classList.toggle("fn__none", !hit);
            if (hit) visible++;
        }
        empty.classList.toggle("fn__none", visible > 0);
    };
    wrap.querySelector<HTMLInputElement>("input")!.addEventListener("input", (ev) => {
        applyFilter((ev.target as HTMLInputElement).value);
    });
    list.addEventListener("click", (ev) => {
        const item = (ev.target as HTMLElement).closest<HTMLElement>(".b3-list-item");
        const id = item?.dataset.id ?? "";
        if (!id) return;
        const cur = models.find((m) => m.id === id);
        btn.dataset.value = id;
        const text = cur ? labelOf(cur) : id;
        btn.textContent = text;
        btn.title = text;
        opts.onPick?.(id);
        closeModelMenu();
    });

    menuEl = wrap;
    menuOwner = btn;
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKey, true);
    return wrap;
}
