import { Dialog } from "siyuan";
import { agentChat } from "./AgentClient";
import { extractBatchQuestions } from "./ConvertService";
import { formOption } from "./FormHtml";
import { injectKnowledgeRefs, sectionKramdown } from "./KnowledgeLink";
import type { QuestionBank } from "./QuestionBank";
import type { WeakTopRow, WeaknessStore } from "./WeaknessStore";
import { esc } from "./ui";

/**
 * 针对性生成（⑥）：从薄弱画像出发生成加练题，两种模式——
 * A 错题变式（默认，以该点错得最多的真题为模板改数字/换条件，质量稳，
 *   答案可对照原题）；B 概念辨析（依小节正文出概念/判断题，避开 AI
 *   自算答案的计算大题）。每题生成后跑一次自检（AI 重做校验答案），
 *   不过就丢弃。产物确定性注回知识点引用，落成《薄弱加练·M.d》专题。
 * 串行调用、单次上限 5 题，防 30s 超时与 token 失控。
 */

const GEN_TIMEOUT_MS = 300_000;
const MAX_PER_RUN = 5;

export interface WeakDrillDeps {
    t: (key: string) => string;
    bank: QuestionBank;
    weakness: WeaknessStore;
    modelId: string;
    /** 完成后刷新侧栏专题。 */
    onDone(): void;
}

export function openWeakDrill(deps: WeakDrillDeps, rows: WeakTopRow[]): void {
    const { t } = deps;
    const dialog = new Dialog({
        title: t("drillTitle"),
        width: "560px",
        content: `<div class="b3-dialog__content wengu-dialog wengu-col-dialog">
      <div class="wengu-muted">${esc(t("drillHint"))}</div>
      <div class="wengu-col-list" data-act="drill-rows"><div class="wengu-muted">…</div></div>
      <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
        <span class="wengu-side-label">${esc(t("drillModeLabel"))}</span>
        <select class="b3-select" data-act="drill-mode">${
            formOption("variant", t("drillModeVariant"), true) + formOption("concept", t("drillModeConcept"), false)
        }</select>
        <span class="wengu-side-label">${esc(t("drillCountLabel"))}</span>
        <select class="b3-select" data-act="drill-count">${[1, 2, 3, 4, 5]
            .map((n, i) => formOption(String(n), String(n), i === 2))
            .join("")}</select>
      </div>
      <div class="wengu-status" data-act="drill-status" hidden></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="drill-cancel">${esc(t("cancel"))}</button>
      <button class="b3-button b3-button--outline" data-act="drill-ok">${esc(t("drillGenBtn"))}</button>
    </div>`,
    });
    const root = dialog.element;
    const rowsBox = root.querySelector<HTMLElement>("[data-act='drill-rows']");
    const status = root.querySelector<HTMLElement>("[data-act='drill-status']");
    const selected = new Set<string>(rows.slice(0, 3).map((r) => r.key));
    if (rowsBox) {
        rowsBox.innerHTML = rows
            .map(
                (r) =>
                    `<label class="wengu-col-row"><input type="checkbox" data-key="${esc(r.key)}"${
                        selected.has(r.key) ? " checked" : ""
                    }><span class="wengu-col-row-title" title="${esc(r.aiNote ?? r.title)}">${esc(r.title)}</span>
        <span class="wengu-meta">${esc(String(r.wrong))}</span></label>`
            )
            .join("");
        for (const cb of rowsBox.querySelectorAll<HTMLInputElement>("input[type='checkbox']")) {
            cb.addEventListener("change", () => {
                if (cb.checked) selected.add(cb.dataset.key ?? "");
                else selected.delete(cb.dataset.key ?? "");
            });
        }
    }
    const show = (text: string, kind: "ok" | "err" | "muted") => {
        if (!status) return;
        status.textContent = text;
        status.className = `wengu-status wengu-status-${kind}`;
        status.removeAttribute("hidden");
    };
    root.querySelector("[data-act='drill-cancel']")?.addEventListener("click", () => dialog.destroy());
    root.querySelector("[data-act='drill-ok']")?.addEventListener("click", () => {
        const mode = (root.querySelector<HTMLSelectElement>("[data-act='drill-mode']")?.value ?? "variant") as
            "variant" | "concept";
        const count = Math.min(
            MAX_PER_RUN,
            Number(root.querySelector<HTMLSelectElement>("[data-act='drill-count']")?.value ?? 3) || 3
        );
        void runDrill(
            deps,
            rows.filter((r) => selected.has(r.key)),
            mode,
            count,
            show,
            dialog
        );
    });
}

async function runDrill(
    deps: WeakDrillDeps,
    rows: WeakTopRow[],
    mode: "variant" | "concept",
    count: number,
    show: (text: string, kind: "ok" | "err" | "muted") => void,
    dialog: Dialog
): Promise<void> {
    const { t, bank, modelId } = deps;
    if (rows.length === 0) return;
    const title = `薄弱加练·${new Date().getMonth() + 1}.${new Date().getDate()}`;
    await bank.ensureCollection(title);
    const perPoint = Math.max(1, Math.ceil(count / rows.length));
    let made = 0;
    let attempt = 0;
    try {
        for (const row of rows) {
            let madeHere = 0;
            while (madeHere < perPoint && made < count && attempt < count * 3) {
                attempt++;
                show(`${t("drillRunning")} ${made}/${count} · ${row.title}`, "muted");
                const kd = await generateOne(deps, row, mode, modelId);
                if (!kd) continue;
                const kpId = row.key.startsWith("kp:") ? row.key.slice(3) : "";
                const refs = kpId ? [{ id: kpId, title: row.title }] : [];
                const final = injectKnowledgeRefs(kd, refs);
                const qid = await bank.addGenerated(final, refs, title);
                await bank.appendToCollection(title, qid);
                madeHere++;
                made++;
            }
            if (made >= count) break;
        }
        await bank.flush();
        show(`${made} ${t("drillDone")}`, "ok");
        deps.onDone();
        window.setTimeout(() => dialog.destroy(), 800);
    } catch (e) {
        show(`${t("convertAiFailed")}${String((e as Error)?.message ?? e)}`, "err");
    }
}

/** 生成一题并自检；失败/不过检返回空串。 */
async function generateOne(
    deps: WeakDrillDeps,
    row: WeakTopRow,
    mode: "variant" | "concept",
    modelId: string
): Promise<string> {
    const { bank } = deps;
    const kpId = row.key.startsWith("kp:") ? row.key.slice(3) : "";
    const section = kpId ? await sectionKramdown(kpId) : "";
    let template = "";
    if (mode === "variant") {
        const records = await bank.recordsByKeys([row.key]);
        const wrongMost =
            records.filter((r) => r.stats.wrongCount > 0).sort((a, b) => b.stats.wrongCount - a.stats.wrongCount)[0] ??
            records[0];
        template = wrongMost?.kramdown ?? "";
        if (!template) return ""; // 变式必须有真题模板
    }
    const prompt =
        mode === "variant"
            ? `你是考研刷题的变式出题助手。以原题（该生做错）为模板，改数字/换条件/反向提问出一道同知识点的变式题。
要求：结构、题型与原题一致；新数据必须凑巧（答案干净可验算）；正确答案与解析自洽完整。
只输出一个题目超级块的 kramdown（{{{row … }}} + 容器属性行 custom-plugin-wengu-q="1" 和 custom-plugin-wengu-type），格式之外不要输出任何文字。

【原题（做错 ${row.wrong} 次，主要错因：${row.topCause ?? "未知"}）】
${template}`
            : `你是考研刷题的概念辨析出题助手。依据知识点小节出一道概念/辨析题（单选或判断），针对该生的薄弱错因。
要求：只考概念辨析（不考计算）；干扰项来自常见误解；正确答案与解析自洽。
只输出一个题目超级块的 kramdown（{{{row … }}} + 容器属性行 custom-plugin-wengu-q="1" 和 custom-plugin-wengu-type），格式之外不要输出任何文字。

【知识点：${row.title}（做错 ${row.wrong} 次，主要错因：${row.topCause ?? "未知"}${row.aiNote ? `；AI 批注：${row.aiNote}` : ""}）】
${section}`;
    const reply = await agentChat(prompt, modelId, GEN_TIMEOUT_MS);
    const qs = extractBatchQuestions(reply).filter((x) => x.includes('part="stem"'));
    if (qs.length === 0) return "";
    const kd = qs[0];
    // 自检：AI 重做校验答案（不过检丢弃——数学计算题的保险丝）
    const check = await agentChat(
        `你是解题验算助手。独立解下面的题，再与题内给出的答案比对。只输出一行：
VERIFY: yes 或 no（答案与解析自洽为 yes；算不平/矛盾为 no）

${kd}`,
        modelId,
        180_000
    );
    if (!/VERIFY\s*[:：]\s*(yes|是)/i.test(check)) return "";
    return kd;
}
