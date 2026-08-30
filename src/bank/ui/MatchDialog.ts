import { Dialog } from "siyuan";
import { agentChatOnce } from "../../ai/client";
import { AI_TIMEOUT } from "../../ai/timeouts";
import {
    buildKnowledgeIndex,
    classifyMatchFail,
    injectKnowledgeRefs,
    routeKnowledgeDiag,
    stripKnowledgeRefs,
    type KnowRouteFail,
    type MatchFailKind,
} from "../../convert/service/KnowledgeLink";
import { KernelBlock } from "../../siyuan/block";
import { KernelDoc } from "../../siyuan/doc";
import { convertRunActive } from "../../convert/service/ConvertRun";
import { formGroup, formOption, formRow, formSelect, formSwitch } from "../../ui/FormHtml";
import { esc, fmt } from "../../ui/shared";
import { parseQuestionKramdown } from "../data/BankParse";
import type { BankRecord, QuestionBank } from "../data/QuestionBank";
import { mergeRecordKpRefs } from "../data/KnowRoots";

/**
 * 知识文档 × 存量题库匹配（20260828）：知识面板文档行「匹配」入口——
 * 选一份已入库的习题文档（题库源卷，存量/新建同权），对其题目逐题走
 * 转换同款两级 AI 路由（routeKnowledge），把「相关知识点」块引用确定
 * 性注入题库记录（strip+inject=替换语义，默认跳过已关联题），源文档块
 * 尽力同步（题库为主记录，模式同 RegenDialog）。内核调用全程串行；AI
 * 路由走独立会话（agentChatOnce，逐题 await 天然串行）。
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
    const info = await KernelDoc.infoOf(options.map((o) => o.docId));
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
    // 取消/X 销毁同时中止在途：原只 destroy，循环靠 isConnected 在
    // 下一轮才断——在途那发 AI 路由与 pending 队列任务照跑完（挂账清偿）
    const cancelAll = (): void => {
        ctrl?.abort();
        dialog.destroy();
    };
    root.querySelector("[data-act='match-cancel']")?.addEventListener("click", cancelAll);
    root.querySelector(".b3-dialog__close")?.addEventListener("click", () => ctrl?.abort());
    // 单一点击处理器：运行中=停止（abort）、空闲=开始——多次开始不叠
    // 监听；运行期间按钮保持可点（disabled 会让「停止」点不动）
    const okBtn = root.querySelector<HTMLButtonElement>("[data-act='match-ok']");
    let running = false;
    let ctrl: AbortController | undefined;
    okBtn?.addEventListener("click", () => {
        if (running) {
            ctrl?.abort();
            return;
        }
        // 转换运行中不开第二条内核写流（updateBlock 与转换 append 并发
        // 互吞响应，20260829 审查）
        if (convertRunActive()) {
            show(t("convertBusy"), "err");
            return;
        }
        const src = root.querySelector<HTMLSelectElement>("[data-act='match-src']")?.value ?? "";
        if (!src) return;
        const skip = root.querySelector<HTMLInputElement>("[data-act='match-skip']")?.checked ?? true;
        running = true;
        ctrl = new AbortController();
        void runMatch(deps, dialog, src, skip, ctrl, show, okBtn, () => {
            running = false;
            ctrl = undefined;
        });
    });
}

async function runMatch(
    deps: MatchDeps,
    dialog: Dialog,
    srcDocId: string,
    skipLinked: boolean,
    ctrl: AbortController,
    show: (text: string, kind: "ok" | "err" | "muted") => void,
    okBtn: HTMLButtonElement,
    onEnd: () => void
): Promise<void> {
    const { t, bank, modelId } = deps;
    okBtn.textContent = t("matchStop");
    show(t("matchPreparing"), "muted");
    try {
        const index = await buildKnowledgeIndex([deps.knowDocId]);
        if (index.chapters.length === 0) throw new Error(t("matchNoIndex"));
        const records = (await bank.recordsOfDoc(srcDocId)).slice();
        let hit = 0;
        let miss = 0;
        let skip = 0;
        // 失败诊断（20260829「0 命中无线索」）：routeKnowledgeDiag 上报每次
        // AI 调用失败，跑完 hit=0 时按类别给状态栏一句人话（模型失效/超时/
        // 网络），不再被 catch 静默吞成「未命中」。
        const fails: KnowRouteFail[] = [];
        const failCount = new Map<MatchFailKind, number>();
        for (let i = 0; i < records.length; i++) {
            if (ctrl.signal.aborted || !dialog.element.isConnected) break;
            const r = records[i];
            if (skipLinked && r.kpRefs.length > 0) {
                skip++;
                continue;
            }
            let refs: { id: string; title: string }[] = [];
            try {
                // 独立会话路由（20260830）：每题一次性 sessionID，逐题 await
                const routed = await routeKnowledgeDiag(
                    routeTextOf(r),
                    index,
                    {
                        call: (m) => agentChatOnce(m, modelId, AI_TIMEOUT.quick, ctrl.signal),
                    },
                    (f) => fails.push(f)
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
        // 汇总失败类别（路由失败原因归类计数，hit=0 时挑最多的一类提示）
        for (const f of fails) {
            const k = classifyMatchFail(String(f.error?.message ?? f.error ?? ""));
            failCount.set(k, (failCount.get(k) ?? 0) + 1);
        }
        const topFail = [...failCount.entries()].sort((a, b) => b[1] - a[1])[0];
        const failHint =
            hit === 0 && miss > 0 && topFail ? "\n" + fmt(t(`matchFail_${topFail[0]}`), { n: String(topFail[1]) }) : "";
        show(
            ctrl.signal.aborted
                ? fmt(t("matchAborted"), { h: String(hit) })
                : fmt(t("matchDone"), { h: String(hit), m: String(miss), s: String(skip) }) + failHint,
            ctrl.signal.aborted ? "muted" : hit === 0 && failHint ? "err" : "ok"
        );
        if (!ctrl.signal.aborted) window.setTimeout(() => dialog.destroy(), 800);
        deps.onDone?.();
    } catch (e) {
        show(String((e as Error)?.message ?? e), "err");
    } finally {
        okBtn.textContent = t("matchStart");
        onEnd();
    }
}
