import { searchWords } from "../../word/flow/WordLookup";
import { wordLib } from "../../word/service/WordLib";
import { keyOf, type WenguWordProgress } from "../../word/core/WordStore";
import { seedWord } from "../../word/core/WordFsrs";
import { svgIcon } from "../../ui/FormHtml";
import { esc } from "../../ui/shared";

/**
 * 材料标注层（M5 线索标注 + E4 生词标记共用）：材料/题干文本里选中
 * 一段后浮出操作条——「标为线索」（当前组内题的定位依据，进会话
 * clues）与「查生词」（词书检索 → 加入生词本=写入复习队列+星标）。
 * 只读 Protyle 内用 window.getSelection 实现，不改块内容。
 *
 * 按钮按选择位置分流（Issue #28）：**「标为线索」只在可标区域出现**
 * ——组题的材料面板（[data-mprotyle]）或非组题的题干区
 * （.wengu-qprotyle）；解析区/选项区/作答区里选段只给「查生词」。
 */

/** 标注层回调（QuizView 组装：线索进会话，生词进背单词）。 */
export interface AnnoCallbacks {
    t: (k: string) => string;
    /** 选段标为当前题的线索。 */
    onMarkClue(text: string): void;
    /** 查/收一个生词（word 归一后仍找不到时弹提示行）。 */
    wordStore?: { get(): Promise<WenguWordProgress>; save(p: WenguWordProgress): Promise<unknown> };
}

let bar: HTMLElement | undefined;
let popup: HTMLElement | undefined;

/** 绑定标注层（每视图一次；返回解绑函数供 destroy 清理）。 */
export function bindAnnotationLayer(host: HTMLElement, cb: AnnoCallbacks): () => void {
    const onSel = () => {
        window.setTimeout(() => positionBar(host, cb), 0);
    };
    document.addEventListener("selectionchange", onSel);
    host.addEventListener("scroll", hideBar, { passive: true });
    return () => {
        document.removeEventListener("selectionchange", onSel);
        host.removeEventListener("scroll", hideBar);
        hideBar();
    };
}

/** 题干区里**不算原文**的部分（Issue #28）：答案解析区与选项区都渲染在
 *  `.wengu-qprotyle` 内（fallbackQuestionHtml 把选项行与解析块拼在同一
 *  容器里），在它们里选段只应对「查生词」——标成线索等于把答案/干扰项
 *  当定位依据，语义错且剧透。 */
const NON_SOURCE_SELECTOR = ".wengu-static-sol, .wengu-opts, .wengu-option-fallback";

/** 选区是否落在**可标区域**（Issue #28）：组题=材料面板
 *  （`[data-mprotyle]`），非组题=题干区（不在组单元里的
 *  `.wengu-qprotyle`）。解析区/选项区（与题干同容器）不命中——只出
 *  「查生词」；组内题自身的题干也不算（组题的可标范围就是材料，
 *  chips 也挂在组单元底部，与「定位依据在原文」的训练语义一致）。 */
export function isCluableNode(node: Node | null | undefined): boolean {
    const el = node instanceof Element ? node : node?.parentElement;
    if (!el) return false;
    if (el.closest("[data-mprotyle]")) return true;
    if (el.closest(NON_SOURCE_SELECTOR)) return false;
    const stem = el.closest(".wengu-qprotyle");
    if (!stem) return false;
    return !stem.closest(".wengu-gunit");
}

function positionBar(host: HTMLElement, cb: AnnoCallbacks): void {
    const sel = document.getSelection();
    const text = sel?.toString().trim() ?? "";
    if (!sel || sel.isCollapsed || !text || text.length > 120 || !host.contains(sel.anchorNode)) {
        hideBar();
        return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) {
        hideBar();
        return;
    }
    // 分流只看**选区起点**（拖选方向不定，起点决定用户从哪片区域拉起）；
    // anchor 在控件/浮层里（不可选区）不出现「标为线索」
    const cluable = isCluableNode(sel.anchorNode);
    getBar(cb, cluable).style.left =
        `${Math.max(8, Math.min(window.innerWidth - 220, rect.left + rect.width / 2 - 100))}px`;
    getBar(cb, cluable).style.top = `${Math.max(8, rect.top - 40)}px`;
}

function getBar(cb: AnnoCallbacks, cluable: boolean): HTMLElement {
    if (bar?.isConnected) {
        bar.replaceChildren(...barChildren(cb, cluable));
        return bar;
    }
    bar = document.createElement("div");
    bar.className = "wengu-annobar";
    document.body.appendChild(bar);
    bar.replaceChildren(...barChildren(cb, cluable));
    return bar;
}

function barChildren(cb: AnnoCallbacks, cluable: boolean): HTMLElement[] {
    const buttons: HTMLElement[] = [];
    if (cluable) {
        const clue = document.createElement("button");
        clue.className = "wengu-annobar-btn";
        clue.innerHTML = `${svgIcon("iconInfo")} ${esc(cb.t("clueMark"))}`;
        clue.addEventListener("mousedown", (ev) => {
            ev.preventDefault(); // 不清选区
            const text = document.getSelection()?.toString().trim() ?? "";
            hideBar();
            if (text) cb.onMarkClue(text);
        });
        buttons.push(clue);
    }
    const word = document.createElement("button");
    word.className = "wengu-annobar-btn";
    word.innerHTML = `${svgIcon("iconList")} ${esc(cb.t("wordMark"))}`;
    word.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        const text = document.getSelection()?.toString().trim() ?? "";
        hideBar();
        if (text) showWordPopup(text, cb);
    });
    buttons.push(word);
    return buttons;
}

export function hideBar(): void {
    bar?.remove();
    bar = undefined;
}

/* ── 生词卡：词形归一 → 词书检索 → 加入生词本 ── */

/** 简单词形归一：小写去杂物 + 常见屈折后缀剥离（找不到再逐级回退）。 */
export function lemmaForms(raw: string): string[] {
    const w = raw.toLowerCase().replace(/[^a-z'-]/g, "");
    if (!w) return [];
    const forms = [w];
    const push = (s: string) => {
        if (s.length >= 3 && !forms.includes(s)) forms.push(s);
    };
    if (w.endsWith("ies")) push(`${w.slice(0, -3)}y`);
    if (w.endsWith("es")) push(w.slice(0, -2));
    if (w.endsWith("s")) push(w.slice(0, -1));
    if (w.endsWith("ing")) {
        push(w.slice(0, -3));
        push(`${w.slice(0, -3)}e`);
    }
    if (w.endsWith("ed")) {
        push(w.slice(0, -2));
        push(w.slice(0, -1));
    }
    if (w.endsWith("er")) push(w.slice(0, -2));
    if (w.endsWith("ly")) push(w.slice(0, -2));
    return forms;
}

/** 词书检索：精确 > 前缀 > 归一形；返回扁平下标。 */
export function lookupWord(raw: string): number {
    const direct = searchWords(raw.trim())[0];
    if (direct !== undefined && wordLib().curBook().words[direct].w.toLowerCase() === raw.trim().toLowerCase())
        return direct;
    for (const form of lemmaForms(raw)) {
        const hits = searchWords(form);
        for (const h of hits) {
            if (wordLib().curBook().words[h].w.toLowerCase() === form) return h;
        }
        if (hits[0] !== undefined) return hits[0];
    }
    return direct ?? -1;
}

/** 浮出生词卡（查无此词给提示行；加入后写 wordStore：复习队列+星标）。 */
async function showWordPopup(raw: string, cb: AnnoCallbacks): Promise<void> {
    popup?.remove();
    popup = document.createElement("div");
    popup.className = "wengu-wordpop";
    const idx = lookupWord(raw);
    if (idx < 0) {
        popup.innerHTML = `<div class="wengu-wordpop-row">${esc(cb.t("wordNotInBook").replace("{w}", raw))}</div>`;
    } else {
        const e = wordLib().curBook().words[idx];
        popup.innerHTML = `<div class="wengu-wordpop-word">${esc(e.w)}</div>
      <div class="wengu-wordpop-meaning">${esc(e.m)}</div>
      <button class="b3-button b3-button--outline" data-word-add>${svgIcon("iconStar")} ${esc(cb.t("wordAdd"))}</button>`;
        popup.querySelector("[data-word-add]")?.addEventListener("click", async () => {
            const store = cb.wordStore;
            if (!store) return;
            const p = await store.get();
            seedWord(p, idx, 1, 1); // 加入词本=按已学处理（明天首复）
            p.starred[keyOf(idx)] = 1;
            await store.save(p);
            popup?.remove();
            popup = undefined;
        });
    }
    document.body.appendChild(popup);
    const sel2 = document.getSelection();
    const rect = sel2 && !sel2.isCollapsed ? sel2.getRangeAt(0).getBoundingClientRect() : null;
    const left = rect?.left ?? 100;
    const top = rect ? rect.bottom + 8 : 100;
    popup.style.left = `${Math.max(8, Math.min(window.innerWidth - 280, left))}px`;
    popup.style.top = `${Math.max(8, top)}px`;
    document.addEventListener("mousedown", function once(ev: MouseEvent) {
        if (popup && !popup.contains(ev.target as Node)) {
            popup.remove();
            popup = undefined;
            document.removeEventListener("mousedown", once);
        }
    });
}
