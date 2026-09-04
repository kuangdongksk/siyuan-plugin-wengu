import { typeKey } from "../render/CardParts";
import { mdFragmentHtml, renderMathWhenVisible } from "../service/ProtyleHost";
import { optionIsRight } from "../service/QuestionGrading";
import { svgIcon } from "../../ui/FormHtml";
import { qidHasBlock } from "../../bank/data/BankSets";
import type { WenguQuestion, WenguStep } from "../../types";
import { LETTERS, optionDisplayMd } from "../../types";
import { esc, fmt } from "../../ui/shared";
import { focusQuestion, revealGroupQuestion } from "./MaterialFlow";
import { matchIndices } from "./PreviewSearch";

/**
 * 预览模式（mode="preview"）：复用做题界面的题卡渲染，装载后把
 * 每张卡装饰成「只读揭示态」——作答位移除、正确项描绿、答案/解析
 * 全展开；「模糊答案」开关给保密场景（模糊答案区+隐去正确项描色，
 * 点答案区可单卡揭示）。每卡带「快捷复制」：题干/选项/答案/解析拼
 * markdown 写入剪贴板，供粘贴到思源 AI 对话（类内置「添加到智能体
 * 对话」）；存量题另带「查看原块」（siyuan:// 协议定位原块）。
 * 模糊开关为模块级状态，重渲染不丢。
 *
 * 搜题：工具行关键词框（匹配逻辑在 PreviewSearch），输入即过滤——
 * 未命中单卡隐藏、材料组整组零命中才隐藏（材料共享的组是整体，
 * 有命中时切显首个命中题）；回车在命中序列上循环定位滚动，Esc
 * 清除还原。搜索词模块级（重渲染恢复），退出预览清零。
 */

/** 模糊答案开关（保密模式）：模块级，跨重渲染保持。 */
let secret = false;

/** 搜题词与回车定位游标（词变更归零；退出预览/换文档清零——模块级
 *  状态只在同一次预览会话内续用，跨会话残留会把新卷误过滤，20260903
 *  审查 P2）。 */
let searchTerm = "";
let jumpAt = 0;

/** 清零搜题态（QuizView.switchMode 离开预览/selectDoc 换卷时调）。 */
export function resetPreviewSearch(): void {
    searchTerm = "";
    jumpAt = 0;
}

/** 渲染后装饰入口：加作用域类/工具行，逐卡转预览态，绑事件
 *  （onExit＝退出预览回做题，头部切换器已删，工具行承担退路）。 */
export function decoratePreview(
    root: HTMLElement,
    list: WenguQuestion[],
    t: (k: string) => string,
    onExit: () => void
): void {
    root.classList.add("wengu-pv");
    root.classList.toggle("wengu-pv-secret", secret);
    root.querySelector(".wengu-body")?.insertAdjacentHTML("beforebegin", previewToolbarHtml(t, list.length));
    for (const card of Array.from(root.querySelectorAll<HTMLElement>(".wengu-card"))) {
        const q = list.find((x) => x.id === card.dataset.qid);
        if (q) decorateOneCard(card, q, t);
    }
    bindPreviewEvents(root, list, t, onExit);
    applySearch(root, list, t); // 重渲染恢复搜题态（空词=纯回显题量，零动作）
}

/** 预览工具行：题量 + 搜题框 + 模糊答案开关 + 退出预览。 */
function previewToolbarHtml(t: (k: string) => string, count: number): string {
    return `<div class="wengu-pv-tools">
  <span class="wengu-muted" data-pv-count>${esc(fmt(t("pvSummary"), { n: String(count) }))}</span>
  <span class="wengu-pv-search" title="${esc(t("pvSearchTitle"))}">${svgIcon(
      "iconSearch"
  )}<input class="b3-text-field" type="text" data-act="pv-search" placeholder="${esc(
      t("pvSearch")
  )}" value="${esc(searchTerm)}"></span>
  <button class="b3-button b3-button--outline${secret ? " wengu-pv-secret-on" : ""}" data-act="pv-secret">${svgIcon(
      "iconEye"
  )} ${esc(t("pvBlurToggle"))}</button>
  <button class="b3-button b3-button--outline" data-act="pv-exit">${esc(t("pvExit"))}</button>
</div>`;
}

/** 单卡装饰：卡头加复制钮与「查看原块」钮 → 摘作答件 → 揭示多步/
 *  正确项 → 答案区。「查看原块」只在存量题（qid=内核块 id）出——
 *  bank-only 题（新版转换 gen- id）无块可跳，不渲染死钮。 */
function decorateOneCard(card: HTMLElement, q: WenguQuestion, t: (k: string) => string): void {
    card.querySelector(".wengu-card-head")?.insertAdjacentHTML(
        "beforeend",
        `<button class="wengu-side-iconbtn wengu-pv-copybtn" data-act="pv-copy" title="${esc(
            t("pvCopyTitle")
        )}">${svgIcon("iconCopy")}</button>` +
            (qidHasBlock(q.id)
                ? `<button class="wengu-side-iconbtn wengu-pv-originbtn" data-act="pv-origin" title="${esc(
                      t("pvOriginTitle")
                  )}">${svgIcon("iconLink")}</button>`
                : "")
    );
    for (const sel of [
        "[data-act='submit']",
        "[data-self]",
        ".wengu-thought-toggle",
        ".wengu-thought",
        "[data-result]",
        "[data-note]",
        "[data-ai-comment]",
        "[data-field='mine']",
        ".wengu-wordcount",
        ".wengu-judge",
        ".wengu-slots",
    ]) {
        card.querySelectorAll(sel).forEach((n) => n.remove());
    }
    markRightChips(q, card);
    revealSteps(q, card, t);
    const ansHtml = answerSectionHtml(q, t);
    const stem = card.querySelector(".wengu-qprotyle");
    if (ansHtml && stem) {
        stem.insertAdjacentHTML("afterend", ansHtml);
        // 长卷预览整卷同步 KaTeX 会冻结——惰性到卡片接近视口（与静态
        // 填充同策略；观察锚点即卡本身）
        renderMathWhenVisible(card);
    }
}

/** 选择题字母 chip：正确项描绿（保密模式下由 CSS 隐去描色）。 */
function markRightChips(q: WenguQuestion, card: HTMLElement): void {
    for (const chip of card.querySelectorAll<HTMLElement>(".wengu-chip")) {
        const idx = LETTERS.indexOf(chip.dataset.letter ?? "");
        if (idx >= 0 && optionIsRight(q, idx)) chip.classList.add("wengu-chip-right");
    }
}

/** 多步卡：全部步骤展开、引导语/选项填充、正确项描绿、步答案揭示。 */
function revealSteps(q: WenguQuestion, card: HTMLElement, t: (k: string) => string): void {
    const steps = q.steps ?? [];
    for (const el of Array.from(card.querySelectorAll<HTMLElement>(".wengu-step"))) {
        const step = steps[Number(el.dataset.step ?? 0)];
        if (!step) {
            el.remove();
            continue;
        }
        el.removeAttribute("hidden");
        // 步骤引导语/选项在组件挂载时已填充（6-4b），此处不再重灌
        el.querySelector("[data-act='step-next']")?.remove();
        markStepOptions(step, el);
        const result = el.querySelector<HTMLElement>("[data-step-result]");
        if (result && step.answer) {
            result.innerHTML = `${esc(t("answerLabel"))}${mdFragmentHtml(step.answer)}`;
            result.removeAttribute("hidden");
        }
    }
}

/** 步选项正确项描绿（步答案是纯字母集合才按字母匹配）。 */
function markStepOptions(step: WenguStep, el: HTMLElement): void {
    const raw = (step.answer ?? "").trim().toUpperCase();
    if (!/^[A-Z]+$/.test(raw)) return;
    for (const opt of el.querySelectorAll<HTMLElement>(".wengu-step-opt")) {
        if (raw.includes(opt.dataset.letter ?? "")) opt.classList.add("wengu-step-opt-right");
    }
}

/** 答案/解析区（steps 的步答案在卡内逐步展示，这里只放题级答案）。 */
function answerSectionHtml(q: WenguQuestion, t: (k: string) => string): string {
    const sec = (title: string, bodyHtml: string) =>
        `<div class="wengu-pv-sec"><div class="wengu-pv-sec-title">${esc(title)}</div>${bodyHtml}</div>`;
    const parts: string[] = [];
    if (q.answer) {
        parts.push(sec(t("reviewSecAnswer"), `<div class="wengu-pv-ansbody">${mdFragmentHtml(q.answer)}</div>`));
    }
    const slots = (q.slots ?? []).filter((s) => s.answer);
    if (slots.length > 0) {
        const rows = slots
            .map((s, k) => {
                const idx = LETTERS.indexOf(s.answer);
                const text = idx >= 0 && s.optionMd[idx] !== undefined ? optionDisplayMd(s.optionMd[idx]) : "";
                return `<div class="wengu-pv-slot">${k + 1}. ${esc(s.answer)}${text ? ` ${esc(text)}` : ""}</div>`;
            })
            .join("");
        parts.push(sec(t("reviewSecAnswer"), rows));
    }
    if (q.solutionMd) {
        parts.push(sec(t("reviewSecSolution"), `<div class="wengu-pv-ansbody">${mdFragmentHtml(q.solutionMd)}</div>`));
    }
    return parts.length ? `<div class="wengu-pv-ans" data-pv-ans>${parts.join("")}</div>` : "";
}

/** 工具行/搜题/复制/单卡揭示/退出的事件绑定（root 每次重渲染后重新调）。 */
function bindPreviewEvents(
    root: HTMLElement,
    list: WenguQuestion[],
    t: (k: string) => string,
    onExit: () => void
): void {
    root.querySelector("[data-act='pv-exit']")?.addEventListener("click", () => {
        searchTerm = "";
        jumpAt = 0;
        onExit();
    });
    root.querySelector("[data-act='pv-secret']")?.addEventListener("click", (ev) => {
        secret = !secret;
        root.classList.toggle("wengu-pv-secret", secret);
        (ev.currentTarget as HTMLElement).classList.toggle("wengu-pv-secret-on", secret);
    });
    // 搜题：输入即过滤（游标归零，下轮回车从首个命中起）；回车循环
    // 定位；Esc 清词还原全量
    const input = root.querySelector<HTMLInputElement>("[data-act='pv-search']");
    input?.addEventListener("input", () => {
        searchTerm = input.value;
        jumpAt = 0;
        applySearch(root, list, t);
    });
    input?.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
            ev.preventDefault();
            jumpToMatch(root, list);
        } else if (ev.key === "Escape") {
            searchTerm = "";
            jumpAt = 0;
            input.value = "";
            applySearch(root, list, t);
        }
    });
    root.querySelector(".wengu-body")?.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement;
        const copy = target.closest<HTMLElement>("[data-act='pv-copy']");
        if (copy) {
            const card = copy.closest<HTMLElement>(".wengu-card");
            const q = list.find((x) => x.id === card?.dataset.qid);
            if (q) void copyQuestionText(q, t);
            return;
        }
        // 查看原块：siyuan:// 协议开思源并定位原块（钮只在存量题渲染）
        const origin = target.closest<HTMLElement>("[data-act='pv-origin']");
        if (origin) {
            const card = origin.closest<HTMLElement>(".wengu-card");
            const q = list.find((x) => x.id === card?.dataset.qid);
            if (q) window.open(`siyuan://blocks/${q.id}`);
            return;
        }
        // 保密模式：点答案区单卡揭示
        const ans = target.closest<HTMLElement>("[data-pv-ans]");
        if (ans && root.classList.contains("wengu-pv-secret")) {
            ans.closest(".wengu-card")?.classList.add("wengu-pv-open");
        }
    });
}

/** 应用搜题过滤：未命中单卡隐藏；材料组整组零命中才隐藏，有命中
 *  时组切显首个命中题（不滚动——逐键过滤不能逐键跳视口）；空词
 *  还原全量并回显题量。 */
function applySearch(root: HTMLElement, list: WenguQuestion[], t: (k: string) => string): void {
    const term = searchTerm.trim();
    const hits = matchIndices(list, searchTerm);
    const hitIds = new Set(hits.map((i) => list[i].id));
    for (const card of Array.from(root.querySelectorAll<HTMLElement>(".wengu-card-list > .wengu-card"))) {
        if (card.dataset.idx === undefined) continue; // 渲染失败占位卡不参与过滤
        card.classList.toggle("wengu-pv-hide", term !== "" && !hitIds.has(card.dataset.qid ?? ""));
    }
    for (const unit of Array.from(root.querySelectorAll<HTMLElement>(".wengu-gunit"))) {
        const firstAt = term === "" ? -1 : list.findIndex((q) => q.group === unit.dataset.mid && hitIds.has(q.id));
        unit.classList.toggle("wengu-pv-hide", term !== "" && firstAt < 0);
        if (firstAt >= 0) revealGroupQuestion(firstAt);
    }
    const countEl = root.querySelector<HTMLElement>("[data-pv-count]");
    if (countEl) {
        countEl.textContent = term
            ? fmt(t("pvSearchHit"), { n: String(hits.length), m: String(list.length) })
            : fmt(t("pvSummary"), { n: String(list.length) });
    }
}

/** 回车定位：在命中序列上循环前进（组题经 focusQuestion 切显并滚到
 *  组单元，散题滚到卡）。词为空或零命中时零动作。 */
function jumpToMatch(root: HTMLElement, list: WenguQuestion[]): void {
    const hits = matchIndices(list, searchTerm);
    if (hits.length === 0) return;
    focusQuestion(root, hits[jumpAt % hits.length]);
    jumpAt += 1;
}

/** 题目 → markdown 文本（复制给 AI 对话用；题干/选项/答案/解析）。 */
export function questionToMd(q: WenguQuestion, t: (k: string) => string): string {
    const lines: string[] = [];
    const head = [q.type ? t(typeKey(q.type)) : "", q.knowledge ?? ""].filter(Boolean).join(" · ");
    if (head) lines.push(`【${head}】`);
    if (q.stemMd) lines.push(q.stemMd);
    (q.optionMd ?? []).forEach((md, i) => lines.push(`${LETTERS[i] ?? ""}. ${optionDisplayMd(md)}`));
    for (const [i, s] of (q.steps ?? []).entries()) {
        lines.push(`\n${i + 1}. ${s.stemMd}`);
        s.optionMd.forEach((md, k) => lines.push(`   ${LETTERS[k] ?? ""}. ${optionDisplayMd(md)}`));
        if (s.answer) lines.push(`   → ${s.answer}`);
    }
    for (const [k, s] of (q.slots ?? []).entries()) {
        const idx = LETTERS.indexOf(s.answer);
        const text = idx >= 0 && s.optionMd[idx] !== undefined ? optionDisplayMd(s.optionMd[idx]) : "";
        lines.push(`${k + 1}. ${s.answer}${text ? ` ${text}` : ""}`);
    }
    if (q.answer) lines.push(`\n【${t("reviewSecAnswer")}】\n${q.answer}`);
    if (q.solutionMd) lines.push(`\n【${t("reviewSecSolution")}】\n${q.solutionMd}`);
    return lines.join("\n");
}

/** 快捷复制：markdown 写剪贴板 + 轻提示。 */
export async function copyQuestionText(q: WenguQuestion, t: (k: string) => string): Promise<void> {
    const text = questionToMd(q, t);
    let ok: boolean;
    try {
        await navigator.clipboard.writeText(text);
        ok = true;
    } catch (_) {
        ok = legacyCopy(text);
    }
    toast(ok ? t("pvCopied") : t("pvCopyFail"));
}

/** clipboard API 不可用时的兜底（隐藏 textarea + execCommand）。 */
function legacyCopy(text: string): boolean {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
}

/** 轻提示（右下角浮层，1.8s 自散；不依赖内核 showMessage）。 */
function toast(text: string): void {
    const div = document.createElement("div");
    div.className = "wengu-pv-toast";
    div.textContent = text;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 1800);
}
