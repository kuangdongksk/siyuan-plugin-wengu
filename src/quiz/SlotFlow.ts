import type { AnswerHost } from "./AnswerFlow";
import { statusIcon } from "../ui/FormHtml";
import { mdFragmentHtml, renderMathIn } from "./ProtyleHost";
import { checkAllDone } from "./AnswerFlow";
import { gradeSlot, recordSlotsResult, slotOptionIsRight } from "./QuestionService";
import type { WenguSessionResult } from "./HistoryStore";
import type { WenguQuestion } from "../types";
import { LETTERS, optionDisplayMd, QuestionType, slotQid } from "../types";
import { esc } from "../ui/shared";

/**
 * slots 题作答流程（E2，与 StepsFlow 平行）：完形/新题型逐空独立判分
 * （每空一条会话记录 qid#k，同 steps 口径），全部作答完写整题账
 * （right=全空对）并揭示。slots 不参与 after 统一揭示——逐空反馈
 * 依赖即时判分（同 steps 的取舍）。
 */

/** 绑定一张 slots 卡（AnswerFlow.bindCardEvents 按 hasSlots 分派）。 */
export function bindSlotsCard(host: AnswerHost, card: HTMLElement, q: WenguQuestion): void {
    card.dataset.graded = "0";
    if (q.type === QuestionType.Match) {
        bindMatch(host, card, q);
        return;
    }
    bindCloze(host, card, q);
}

/* ── 完形：空号条 + 当前空选项（一次一空，提交后自动跳下一空） ── */

function bindCloze(host: AnswerHost, card: HTMLElement, q: WenguQuestion): void {
    const slots = q.slots ?? [];
    let cur = firstUnanswered(card, slots.length);
    const strip = [...card.querySelectorAll<HTMLElement>("[data-slotbtn]")];
    const optRow = card.querySelector<HTMLElement>("[data-slot-opts]");
    const stemEl = card.querySelector<HTMLElement>("[data-slot-stem]");
    const render = () => {
        fillClozeSlot(stemEl, optRow, slots[cur], cur, host);
        strip.forEach((b, i) => b.classList.toggle("wengu-slotbtn-cur", i === cur));
        const done = slotsDone(card, slots.length);
        const curBtn = card.querySelector<HTMLElement>("[data-slot-submit]");
        if (curBtn) curBtn.hidden = done >= slots.length;
    };
    strip.forEach((b) =>
        b.addEventListener("click", () => {
            if (b.dataset.locked === "1") return;
            cur = Number(b.dataset.slotbtn ?? 0);
            render();
        })
    );
    card.querySelector("[data-act='slot-submit']")?.addEventListener("click", () => {
        const chosen = optRow?.querySelector<HTMLElement>(".wengu-slot-opt.wengu-slot-selected");
        const letter = chosen?.dataset.letter ?? "";
        if (!letter) {
            showSlotNote(card, host.t("noAnswer"));
            return;
        }
        const ok = gradeSlot(slots[cur], letter);
        settleSlot(host, card, q, cur, letter, ok, slots.length);
        markClozeOptions(optRow, slots[cur], letter);
        strip[cur]?.classList.add(ok ? "wengu-slotbtn-right" : "wengu-slotbtn-wrong");
        strip[cur]?.setAttribute("data-locked", "1");
        cur = firstUnanswered(card, slots.length);
        render();
    });
    render();
}

/** 当前空的引导语与选项（Lute 渲染后填占位）。 */
function fillClozeSlot(
    stemEl: HTMLElement | null,
    optRow: HTMLElement | null,
    slot: { optionMd: string[] },
    k: number,
    host: AnswerHost
): void {
    if (stemEl) stemEl.textContent = host.t("slotNO").replace("{n}", String(k + 1));
    if (!optRow) return;
    optRow.innerHTML = slot.optionMd
        .map(
            (_, i) =>
                `<button class="wengu-slot-opt" data-letter="${LETTERS[i] ?? ""}">
          <span class="wengu-slot-letter">${LETTERS[i] ?? ""}</span>
          <span class="wengu-slot-text" data-opt-text></span>
        </button>`
        )
        .join("");
    for (const opt of optRow.querySelectorAll<HTMLElement>(".wengu-slot-opt")) {
        const idx = LETTERS.indexOf(opt.dataset.letter ?? "");
        const text = opt.querySelector<HTMLElement>("[data-opt-text]");
        if (text && slot.optionMd[idx]) text.innerHTML = mdFragmentHtml(optionDisplayMd(slot.optionMd[idx]));
        opt.addEventListener("click", () => {
            if (optRow.dataset.locked === "1") return;
            optRow.querySelectorAll(".wengu-slot-opt").forEach((o) => o.classList.remove("wengu-slot-selected"));
            opt.classList.add("wengu-slot-selected");
        });
    }
    renderMathIn(optRow);
}

/** 判分后描色：正确项绿、误选红、锁定本空选项。 */
function markClozeOptions(
    optRow: HTMLElement | null,
    slot: { optionMd: string[]; answer: string },
    letter: string
): void {
    if (!optRow) return;
    optRow.dataset.locked = "1";
    for (const opt of optRow.querySelectorAll<HTMLElement>(".wengu-slot-opt")) {
        const idx = LETTERS.indexOf(opt.dataset.letter ?? "");
        if (slotOptionIsRight(slot, idx)) opt.classList.add("wengu-slot-right");
        else if (opt.dataset.letter === letter) opt.classList.add("wengu-slot-wrong");
        (opt as HTMLButtonElement).disabled = true;
    }
}

/* ── 新题型：候选池只读 + 每槽一行（下拉选字母提交） ── */

function bindMatch(host: AnswerHost, card: HTMLElement, q: WenguQuestion): void {
    const slots = q.slots ?? [];
    for (const btn of card.querySelectorAll<HTMLElement>("[data-act='match-submit']")) {
        btn.addEventListener("click", () => {
            const k = Number(btn.dataset.k ?? 0);
            const row = card.querySelector<HTMLElement>(`[data-matchrow="${k}"]`);
            const sel = row?.querySelector<HTMLSelectElement>("[data-matchsel]");
            const letter = (sel?.value ?? "").toUpperCase();
            if (!letter) {
                showSlotNote(card, host.t("noAnswer"));
                return;
            }
            const ok = gradeSlot(slots[k], letter);
            settleSlot(host, card, q, k, letter, ok, slots.length);
            if (row) {
                row.classList.add(ok ? "wengu-match-right" : "wengu-match-wrong");
                row.dataset.locked = "1";
            }
            if (sel) sel.disabled = true;
            btn.setAttribute("hidden", "");
        });
    }
}

/* ── 共用：单空记账 + 整题收口 ── */

function settleSlot(
    host: AnswerHost,
    card: HTMLElement,
    q: WenguQuestion,
    k: number,
    letter: string,
    ok: boolean,
    total: number
): void {
    host.recordAnswer(slotQid(q.id, k), letter, ok);
    card.dataset[`slot${k}`] = ok ? "1" : "0";
    card.dataset[`slotLetter${k}`] = letter;
    markNum(host, q, ok);
    showSlotNote(card, ok ? host.t("correct") : host.t("slotWrong").replace("{L}", (q.slots ?? [])[k]?.answer ?? ""));
    if (slotsDone(card, total) >= total) void finishSlots(host, card, q);
}

/** 全部空作答完：整题记账 + 揭示 + 收口检查。 */
async function finishSlots(host: AnswerHost, card: HTMLElement, q: WenguQuestion): Promise<void> {
    const slots = q.slots ?? [];
    const letters = slots.map((_, k) => card.dataset[`slotLetter${k}`] ?? "");
    const oks = slots.map((_, k) => card.dataset[`slot${k}`] === "1");
    const allOk = await recordSlotsResult(q, letters, oks);
    card.dataset.graded = "1";
    card.classList.add("wengu-graded");
    card.querySelectorAll("button, select, input, textarea").forEach((n) => ((n as HTMLButtonElement).disabled = true));
    const result = card.querySelector<HTMLElement>("[data-result]");
    if (result) {
        const right = oks.filter(Boolean).length;
        result.innerHTML = `${statusIcon(allOk ? "right" : "wrong")}${
            allOk
                ? esc(host.t("correct"))
                : esc(host.t("slotsSummary").replace("{r}", String(right)).replace("{n}", String(slots.length)))
        }`;
        result.removeAttribute("hidden");
        result.classList.add(allOk ? "wengu-right" : "wengu-wrong");
    }
    checkAllDone(host);
}

/** 恢复继续：按会话 qid#k 还原逐空状态（StepsFlow.restoreStepsCard 平行）。 */
export function restoreSlotsCard(
    host: AnswerHost,
    card: HTMLElement,
    q: WenguQuestion,
    results: WenguSessionResult[]
): void {
    const slots = q.slots ?? [];
    const prefix = `${q.id}#`;
    const done = new Map<number, { letter: string; ok: boolean }>();
    for (const r of results) {
        if (!r.qid.startsWith(prefix)) continue;
        const k = Number(r.qid.slice(prefix.length));
        if (Number.isInteger(k) && k >= 0 && k < slots.length) done.set(k, { letter: r.submitted, ok: r.ok });
    }
    if (done.size === 0) return;
    card.dataset.graded = "1";
    for (const [k, v] of done) {
        card.dataset[`slot${k}`] = v.ok ? "1" : "0";
        card.dataset[`slotLetter${k}`] = v.letter;
        const btn = card.querySelector<HTMLElement>(`[data-slotbtn="${k}"]`);
        btn?.classList.add(v.ok ? "wengu-slotbtn-right" : "wengu-slotbtn-wrong");
        const row = card.querySelector<HTMLElement>(`[data-matchrow="${k}"]`);
        if (row) {
            row.classList.add(v.ok ? "wengu-match-right" : "wengu-match-wrong");
            const sel = row.querySelector<HTMLSelectElement>("[data-matchsel]");
            if (sel) {
                sel.value = v.letter;
                sel.disabled = true;
            }
            row.querySelector("[data-act='match-submit']")?.setAttribute("hidden", "");
        }
    }
    card.querySelectorAll("button, select, input, textarea").forEach((n) => ((n as HTMLButtonElement).disabled = true));
    card.classList.add("wengu-graded");
}

/* ── 小件 ── */

function slotsDone(card: HTMLElement, total: number): number {
    let n = 0;
    for (let k = 0; k < total; k++) if (card.dataset[`slot${k}`] !== undefined) n++;
    return n;
}

function firstUnanswered(card: HTMLElement, total: number): number {
    for (let k = 0; k < total; k++) if (card.dataset[`slot${k}`] === undefined) return k;
    return Math.max(0, total - 1);
}

function showSlotNote(card: HTMLElement, text: string): void {
    const note = card.querySelector<HTMLElement>("[data-note]");
    if (!note) return;
    note.textContent = text;
    note.removeAttribute("hidden");
}

function markNum(host: AnswerHost, q: WenguQuestion, ok: boolean): void {
    const n = host.questions().indexOf(q) + 1;
    const btn = host.container().querySelector<HTMLElement>(`.wengu-num[data-num="${n}"]`);
    if (!btn) return;
    btn.classList.remove("wengu-num-answered");
    btn.classList.toggle("wengu-num-right", ok);
    btn.classList.toggle("wengu-num-wrong", !ok);
}
