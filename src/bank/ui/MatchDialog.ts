import { Dialog } from "siyuan";
import { agentChat } from "../../ai/client";
import { enqueueAi } from "../../ai/queue";
import { AI_TIMEOUT } from "../../ai/timeouts";
import {
    buildKnowledgeIndex,
    injectKnowledgeRefs,
    routeKnowledge,
    stripKnowledgeRefs,
} from "../../convert/service/KnowledgeLink";
import { KernelBlock } from "../../siyuan/block";
import { formGroup, formOption, formRow, formSelect, formSwitch } from "../../ui/FormHtml";
import { esc, fmt } from "../../ui/shared";
import { parseQuestionKramdown } from "../data/BankParse";
import type { BankRecord, QuestionBank } from "../data/QuestionBank";
import { mergeRecordKpRefs } from "../data/KnowRoots";
import { docInfoOf } from "./KnowledgePanel";

/**
 * 知识文档 × 存量题库匹配（20260828）：知识面板文档行「匹配」入口——
 * 选一份已入库的习题文档（题库源卷，存量/新建同权），对其题目逐题走
 * 转换同款两级 AI 路由（routeKnowledge），把「相关知识点」块引用确定
 * 性注入题库记录（strip+inject=替换语义，默认跳过已关联题），源文档块
 * 尽力同步（题库为主记录，模式同 RegenDialog）。内核调用全程串行；AI
 * 路由过共享队列（enqueueAi，无 sessionID 的 "" 会话锁）。
 */

export interface MatchDeps {
    t: (key: string) => string;
    bank: QuestionBank;
    /** 路由用模型（跟随转换侧选择）。 */
    modelId: string;
    /** 知识文档行（匹配目标）。 */
    knowDocId: string;
    knowTitle: string;
    /** 收尾刷新（面板重渲染）。 */
    onDone?(): void;
}

/** 题库源卷候选（按题数降序；纯函数）。 */
export function sourceDocOptions(records: BankRecord[]): { docId: string; count: number }[] {
    const acc = new Map<string, number>();
    for (const r of records) {
        if (!r.sourceDocId) continue;
        acc.set(r.sourceDocId, (acc.get(r.sourceDocId) ?? 0) + 1);
    }
    return [...acc.entries()].map(([docId, count]) => ({ docId, count })).sort((a, b) => b.count - a.count);
}

/** 路由输入：题干+选项优先（题干为空退整段 kramdown），截长防超时。 */
export function routeTextOf(r: BankRecord): string {
    const parsed = parseQuestionKramdown(r.kramdown, r.qid);
    const text = parsed ? `${parsed.stemMd}\n${parsed.optionMd.join("\n")}` : "";
    return (text.trim() || r.kramdown).slice(0, 2000);
}

export async function openMatchDialog(deps: MatchDeps): Promise<void> {
    const { t, bank } = deps;
    const options = sourceDocOptions(Object.values((await bank.all()).records));
    const info = await docInfoOf(options.map((o) => o.docId));
    const dialog = new Dialog({
        title: fmt(t("matchTitle"), { doc: deps.knowTitle }),
        width: "560px",
        content: `<div class="b3-dialog__content wengu-dialog">
      <div class="wengu-muted">${esc(fmt(t("matchHint"), { doc: deps.knowTitle }))}</div>
      ${
          options.length > 0
              ? formGroup(
                    t("matchGroup"),
                    formRow(
                        t("matchSrcLabel"),
                        t("matchSrcHint"),
                        formSelect(
                            "match-src",
                            options
                                .map((o) =>
                                    formOption(
                                        o.docId,
                                        fmt(t("matchOptLabel"), {
                                            t: info.get(o.docId)?.title ?? o.docId,
                                            n: String(o.count),
                                        }),
                                        o === options[0]
                                    )
                                )
                                .join(""),
                            "data-act"
                        )
                    ) + formRow(t("matchSkipLabel"), t("matchSkipHint"), formSwitch("match-skip", true, "data-act"))
                )
              : `<div class="wengu-status wengu-status-err">${esc(t("matchNoSrc"))}</div>`
      }
      <div class="wengu-status" data-act="match-status" hidden></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="match-cancel">${esc(t("cancel"))}</button>
      <button class="b3-button b3-button--outline" data-act="match-ok"${options.length > 0 ? "" : " disabled"}>${esc(
          t("matchStart")
      )}</button>
    </div>`,
    });
    const root = dialog.element;
    const status = root.querySelector<HTMLElement>("[data-act='match-status']");
    const show = (text: string, kind: "ok" | "err" | "muted"): void => {
        if (!status || !status.isConnected) return;
        status.textContent = text;
        status.className = `wengu-status wengu-status-${kind}`;
        status.removeAttribute("hidden");
    };
    root.querySelector("[data-act='match-cancel']")?.addEventListener("click", () => dialog.destroy());
    root.querySelector<HTMLButtonElement>("[data-act='match-ok']")?.addEventListener("click", (ev) => {
        const btn = ev.currentTarget as HTMLButtonElement;
        const src = root.querySelector<HTMLSelectElement>("[data-act='match-src']")?.value ?? "";
        const skip = root.querySelector<HTMLInputElement>("[data-act='match-skip']")?.checked ?? true;
        if (src) void runMatch(deps, dialog, src, skip, show, btn);
    });
}

async function runMatch(
    deps: MatchDeps,
    dialog: Dialog,
    srcDocId: string,
    skipLinked: boolean,
    show: (text: string, kind: "ok" | "err" | "muted") => void,
    okBtn: HTMLButtonElement
): Promise<void> {
    const { t, bank, modelId } = deps;
    okBtn.disabled = true;
    okBtn.textContent = t("matchStop");
    const ctrl = new AbortController();
    okBtn.addEventListener("click", () => ctrl.abort());
    show(t("matchPreparing"), "muted");
    try {
        const index = await buildKnowledgeIndex([deps.knowDocId]);
        if (index.chapters.length === 0) throw new Error(t("matchNoIndex"));
        const records = (await bank.recordsOfDoc(srcDocId)).slice();
        let hit = 0;
        let miss = 0;
        let skip = 0;
        for (let i = 0; i < records.length; i++) {
            if (ctrl.signal.aborted || !dialog.element.isConnected) break;
            const r = records[i];
            if (skipLinked && r.kpRefs.length > 0) {
                skip++;
                continue;
            }
            let refs: { id: string; title: string }[] = [];
            try {
                // 过共享队列串行：与判分/复盘等 "" 会话调用互斥，不抢内核
                const routed = await enqueueAi(() =>
                    routeKnowledge(routeTextOf(r), index, {
                        call: (m) => agentChat(m, modelId, AI_TIMEOUT.quick, ctrl.signal),
                    })
                );
                refs = [...routed.values()].map((s) => ({ id: s.id, title: s.title }));
            } catch (_) {
                // 路由失败按未命中，不阻断后续题
            }
            if (ctrl.signal.aborted) break;
            if (refs.length > 0) {
                const merged = [...r.kpRefs];
                for (const x of refs) if (!merged.some((m) => m.id === x.id)) merged.push(x);
                const next = injectKnowledgeRefs(stripKnowledgeRefs(r.kramdown), merged);
                if (next !== r.kramdown) {
                    await bank.replaceRecordKramdown(r.qid, next);
                    await mergeRecordKpRefs(bank, r.qid, refs);
                    try {
                        await KernelBlock.update({ id: r.qid, dataType: "markdown", data: next });
                    } catch (_) {
                        // 源块同步失败：题库已是主记录
                    }
                    hit++;
                } else miss++;
            } else miss++;
            show(
                fmt(t("matchRunning"), {
                    c: String(i + 1),
                    n: String(records.length),
                    h: String(hit),
                    m: String(miss),
                    s: String(skip),
                }),
                "muted"
            );
        }
        await bank.flush();
        show(
            ctrl.signal.aborted
                ? fmt(t("matchAborted"), { h: String(hit) })
                : fmt(t("matchDone"), { h: String(hit), m: String(miss), s: String(skip) }),
            ctrl.signal.aborted ? "muted" : "ok"
        );
        okBtn.textContent = t("matchStart");
        okBtn.disabled = false;
        if (!ctrl.signal.aborted) window.setTimeout(() => dialog.destroy(), 800);
        deps.onDone?.();
    } catch (e) {
        show(String((e as Error)?.message ?? e), "err");
        okBtn.textContent = t("matchStart");
        okBtn.disabled = false;
    }
}
