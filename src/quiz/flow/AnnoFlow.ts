import { searchWords } from "../../word/flow/WordLookup";
import { wordLib } from "../../word/service/WordLib";
import { keyOf, type WenguWordProgress } from "../../word/core/WordStore";
import { seedWord } from "../../word/core/WordFsrs";
import { notifyInfo } from "../../ui/Notify";
import { svgIcon } from "../../ui/FormHtml";
import { esc } from "../../ui/shared";
import { pickAnnobarButtons, type BarPicks, type ViewMode } from "./AnnoScope";

/**
 * 材料标注层（M5 线索标注 + E4 生词标记共用）：材料/题干文本里选中
 * 一段后浮出操作条——「标为线索」（当前组内题的定位依据，进会话
 * clues）与「标生词」（词书检索 → 直接加入生词本=写入复习队列+星标）。
 * 只读 Protyle 内用 window.getSelection 实现，不改块内容。
 *
 * 按钮按选择位置分流（Issue #28）：**「标为线索」只在可标区域出现**
 * ——组题的材料面板（[data-mprotyle]）或非组题的题干区
 * （.wengu-qprotyle）；解析区/选项区/作答区里选段只给「标生词」。
 *
 * **做题时不允许查词义**（Issue #36 产品决策）：生词钮从「查生词」改
 * 为「标生词」，点了只入生词本、不弹释义卡——释义要背单词面板里看，
 * 做题当场给释义等于透题。反馈走思源通知（页面无其它可见反馈）。
 *
 * **浮条必须出得来**（Issue #36）：选段长度上限放到 SELECT_MAX（1000，
 * 只挡整页全选那种极端）——旧上限 120 字符会让 144/500 字符的选段
 * **整个不出浮条且毫无提示**，用户只会以为按钮坏了；上限之下正常选段
 * 一律出条（含跨段长选段）。
 *
 * 事件链防御（Issue #36 桌面客户端实锤「点按钮无反应」的加固）：① 浮条
 * 根部**捕获阶段** mousedown 即 stopPropagation，隔离宿主（思源 Electron
 * 客户端）可能挂的全局捕获监听（清选区/吞事件）；② 按钮监听用
 * `pointerdown`（比 mousedown 更早，选区快照更稳）；③ 选区快照兜底
 * `lastSelText`——选区若在某层被清掉，仍能标上用户刚选的那段。
 *
 * **作用域闸（Issue #45，判定纯逻辑在 flow/AnnoScope，带单测）**：
 * ① 模式闸——标注是做题功能，**只有 quiz 模式**出条（预览/复习/学习
 * 零浮条；切模式由 QuizView.hideAnnobar 立即收条，见下 `annoEnabled`）；
 * ② 标生词——生词本是英语功能，按**卷级**判（该卷题型并集含英语四类
 * 任一，见 isEnglishTypes）：「英语阅读也是 single、数学单选也是 single」
 * 题级判不开，只能看卷；聚合/专题混合刷时按**选区起点所在卡**反查源卷
 * （反查失败宁可不出现——宁缺勿错）。卷级判定结果缓存在 add/doc，由
 * QuizView 在装载/切题集时清理（selectionchange 高频回调里不查库）。
 * 两钮都不出 ⇒ 浮条整体不出现（不出空条）。
 */

/** 标注层回调（QuizView 组装：线索进会话，生词进背单词）。 */
export interface AnnoCallbacks {
    t: (k: string) => string;
    /** 选段标为线索；anchorEl=选段起点所在元素（长卷全卡常驻，归属题
     *  要按它反查所在卡，不能按视图「当前题」猜——滚动跟踪有延迟）。 */
    onMarkClue(text: string, anchorEl?: HTMLElement | null): void;
    /** 收一个生词（检索命中即入本；查无此词只通知，见 markWord）。 */
    wordStore?: { get(): Promise<WenguWordProgress>; save(p: WenguWordProgress): Promise<unknown> };
    /** 视图模式（Issue #45 模式闸：只有 "quiz" 放行），拉取式取当前值。 */
    mode(): ViewMode;
    /** 选区起点所在卷是否英语卷（Issue #45 卷级判定；反查失败返回
     *  false=不放行标生词）。实现体做按卷缓存，selectionchange 里不查库。 */
    isEnglishDoc(anchorEl: HTMLElement | null): boolean;
}

let bar: HTMLElement | undefined;

/** 选段长度上限（Issue #36）：防整页全选的极端，其余一律允许标注。 */
export const SELECT_MAX = 1000;

/**
 * 选区快照兜底（Issue #36 #4）：选区可能被宿主客户端在捕获层清掉
 * （`pointerdown` 时读到的已是空串），此时用最近一次非空选区文本兜底。
 * 只在浮条可见期间有效——`hideBar` 一并清掉，避免标到上一轮的陈旧选段。
 */
let lastSelText = "";

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
 *  容器里），在它们里选段只给「标生词」——标成线索等于把答案/干扰项
 *  当定位依据，语义错且剧透。 */
const NON_SOURCE_SELECTOR = ".wengu-static-sol, .wengu-opts, .wengu-option-fallback";

/** 选区是否落在**可标区域**（Issue #28）：组题=材料面板
 *  （`[data-mprotyle]`），非组题=题干区（不在组单元里的
 *  `.wengu-qprotyle`）。解析区/选项区（与题干同容器）不命中——只出
 *  「标生词」；组内题自身的题干也不算（组题的可标范围就是材料，
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
    if (
        !sel ||
        sel.isCollapsed ||
        !text ||
        text.length > SELECT_MAX || // 唯一的长度闸：只挡整页全选（见头注）
        !host.contains(sel.anchorNode)
    ) {
        hideBar();
        return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) {
        hideBar();
        return;
    }
    // 快照当前选区文本：按钮监听里选区被清时用它兜底（#4）
    lastSelText = text;
    // 分流只看**选区起点**（拖选方向不定，起点决定用户从哪片区域拉起）；
    // anchor 在控件/浮层里（不可选区）不出现「标为线索」；卷级判定同样
    // 按起点所在卡反查（聚合混合刷各卡按各自源卷）
    const anchorEl = sel.anchorNode instanceof HTMLElement ? sel.anchorNode : (sel.anchorNode?.parentElement ?? null);
    const picks = pickAnnobarButtons({
        mode: cb.mode(), // Issue #45 模式闸：非 quiz 直接收条
        isCluable: isCluableNode(sel.anchorNode),
        english: cb.isEnglishDoc(anchorEl),
    });
    if (!picks.show) {
        hideBar(); // 两钮都不出=空条，整体不出现（非英语卷在解析区选段即此）
        return;
    }
    const el = getBar(cb, picks);
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - 220, rect.left + rect.width / 2 - 100))}px`;
    el.style.top = `${Math.max(8, rect.top - 40)}px`;
}

function getBar(cb: AnnoCallbacks, picks: BarPicks): HTMLElement {
    if (bar?.isConnected) {
        bar.replaceChildren(...barChildren(cb, picks));
        return bar;
    }
    bar = document.createElement("div");
    bar.className = "wengu-annobar";
    // 捕获阶段就把按下事件收在浮条自己身上（#4 防御）：宿主客户端可能
    // 在 document 捕获层挂「按下即清选区/关浮层」的全局监听，事件照常
    // 冒泡到它就会在按钮监听前把选区清掉——表现为「点了没反应」。
    bar.addEventListener("mousedown", (ev) => ev.stopPropagation(), true);
    document.body.appendChild(bar);
    bar.replaceChildren(...barChildren(cb, picks));
    return bar;
}

function barChildren(cb: AnnoCallbacks, picks: BarPicks): HTMLElement[] {
    const buttons: HTMLElement[] = [];
    /** 按钮按下的统一取词：选区在（优先）→ 快照兜底（#4）。 */
    const pickText = (): string => document.getSelection()?.toString().trim() || lastSelText;
    if (picks.clue) {
        const clue = document.createElement("button");
        clue.className = "wengu-annobar-btn";
        clue.innerHTML = `${svgIcon("iconInfo")} ${esc(cb.t("clueMark"))}`;
        // pointerdown（非 mousedown）：更早拿到选区快照，且宿主若在某层
        // 清选区，我们已经在它之前把文本取走了（#4）
        clue.addEventListener("pointerdown", (ev) => {
            ev.preventDefault(); // 不清选区
            const sel = document.getSelection();
            const text = pickText();
            const anchorNode = sel?.anchorNode ?? null;
            const anchorEl = anchorNode instanceof HTMLElement ? anchorNode : (anchorNode?.parentElement ?? null);
            hideBar();
            if (text) cb.onMarkClue(text, anchorEl);
        });
        buttons.push(clue);
    }
    if (picks.word) {
        const word = document.createElement("button");
        word.className = "wengu-annobar-btn";
        word.innerHTML = `${svgIcon("iconList")} ${esc(cb.t("wordMark"))}`;
        word.addEventListener("pointerdown", (ev) => {
            ev.preventDefault();
            const text = pickText();
            hideBar();
            if (text) void markWord(text, cb);
        });
        buttons.push(word);
    }
    return buttons;
}

export function hideBar(): void {
    bar?.remove();
    bar = undefined;
    lastSelText = ""; // 快照只对「当前这条浮条」有效，别标到陈旧选段
}

/* ── 词形归一 + 词书检索（标生词用） ── */

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

/* ── 标生词：词形归一 → 词书检索 → 直接加入生词本（Issue #36） ── */

/**
 * 标一个生词（浮条「标生词」）：词书检索命中即直接写入生词本
 * （复习队列 + 星标，与背单词面板同一 store），**不弹释义卡**——
 * 做题当场给释义等于透题；反馈走思源通知（页面别处看不见结果）。
 * 查无此词只通知，不写库。
 */
async function markWord(raw: string, cb: AnnoCallbacks): Promise<void> {
    const idx = lookupWord(raw);
    if (idx < 0) {
        notifyInfo({ key: "wordNotInBook", vars: { w: raw } });
        return;
    }
    const store = cb.wordStore;
    if (!store) return;
    const p = await store.get();
    seedWord(p, idx, 1, 1); // 加入词本=按已学处理（明天首复）
    p.starred[keyOf(idx)] = 1;
    await store.save(p);
    notifyInfo({ key: "wordAdded", vars: { w: wordLib().curBook().words[idx].w } });
}
