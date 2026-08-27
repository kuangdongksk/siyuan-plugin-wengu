import { fillOneStep } from "../render/CardHtml";
import { typeKey } from "../render/CardParts";
import { mdFragmentHtml, renderMathIn } from "../service/ProtyleHost";
import { optionIsRight } from "../service/QuestionGrading";
import { svgIcon } from "../../ui/FormHtml";
import type { WenguQuestion, WenguStep } from "../../types";
import { LETTERS, optionDisplayMd } from "../../types";
import { esc, fmt } from "../../ui/shared";

/**
 * 预览模式（mode="preview"）：复用做题界面的题卡渲染，装载后把
 * 每张卡装饰成「只读揭示态」——作答位移除、正确项描绿、答案/解析
 * 全展开；「模糊答案」开关给保密场景（模糊答案区+隐去正确项描色，
 * 点答案区可单卡揭示）。每卡带「快捷复制」：题干/选项/答案/解析拼
 * markdown 写入剪贴板，供粘贴到思源 AI 对话（类内置「添加到智能体
 * 对话」）。模糊开关为模块级状态，重渲染不丢。
 */

/** 模糊答案开关（保密模式）：模块级，跨重渲染保持。 */
let secret = false;

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
}

/** 预览工具行：题量 + 模糊答案开关 + 退出预览。 */
function previewToolbarHtml(t: (k: string) => string, count: number): string {
    return `<div class="wengu-pv-tools">
  <span class="wengu-muted">${esc(fmt(t("pvSummary"), { n: String(count) }))}</span>
  <button class="b3-button b3-button--outline${secret ? " wengu-pv-secret-on" : ""}" data-act="pv-secret">${svgIcon(
      "iconEye"
  )} ${esc(t("pvBlurToggle"))}</button>
  <button class="b3-button b3-button--outline" data-act="pv-exit">${esc(t("pvExit"))}</button>
</div>`;
}

/** 单卡装饰：卡头加复制钮 → 摘作答件 → 揭示多步/正确项 → 答案区。 */
function decorateOneCard(card: HTMLElement, q: WenguQuestion, t: (k: string) => string): void {
    card.querySelector(".wengu-card-head")?.insertAdjacentHTML(
        "beforeend",
        `<button class="wengu-side-iconbtn wengu-pv-copybtn" data-act="pv-copy" title="${esc(
            t("pvCopyTitle")
        )}">${svgIcon("iconCopy")}</button>`
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
        renderMathIn(card);
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
        fillOneStep(el, step);
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

/** 工具行/复制/单卡揭示/退出的事件绑定（root 每次重渲染后重新调）。 */
function bindPreviewEvents(
    root: HTMLElement,
    list: WenguQuestion[],
    t: (k: string) => string,
    onExit: () => void
): void {
    root.querySelector("[data-act='pv-exit']")?.addEventListener("click", () => onExit());
    root.querySelector("[data-act='pv-secret']")?.addEventListener("click", (ev) => {
        secret = !secret;
        root.classList.toggle("wengu-pv-secret", secret);
        (ev.currentTarget as HTMLElement).classList.toggle("wengu-pv-secret-on", secret);
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
        // 保密模式：点答案区单卡揭示
        const ans = target.closest<HTMLElement>("[data-pv-ans]");
        if (ans && root.classList.contains("wengu-pv-secret")) {
            ans.closest(".wengu-card")?.classList.add("wengu-pv-open");
        }
    });
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
