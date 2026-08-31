import { Dialog } from "siyuan";
import { agentChatOnce } from "../../ai/client";
import { AI_TIMEOUT } from "../../ai/timeouts";
import {
    buildKnowledgeIndex,
    classifyMatchFail,
    type KnowRouteFail,
    type MatchFailKind,
} from "../../convert/service/KnowledgeLink";
import { convertRunActive } from "../../convert/service/ConvertRun";
import { formGroup, formRow, formSwitch } from "../../ui/FormHtml";
import { esc, fmt } from "../../ui/shared";
import type { BankRecord, QuestionBank } from "../data/QuestionBank";
import { knowRootsOf } from "../data/KnowRoots";
import { applyTagToRecord, lexiconOfRoots, linkRecordsByText, parseFreeTags } from "../data/KnowLinkText";
import { routeCache, routeKnowledgeCached } from "../data/RouteCache";
import { routeTextOf } from "./MatchDialog";

/**
 * 生成标签（2026-08-31，侧栏文档右键入口）：对一份习题文档的题单分两相——
 * **核对**：已有 knowledge 标签的题与知识文档小节做归一匹配（零 AI），
 * 命中挂引用，未匹配（标签在知识文档里无对应小节）计数上报；
 * **生成**：没有标签的题 AI 打标签——登记了知识文档时逐题两级路由
 * （标签=命中小节标题、词表受控不造新词），否则整批自由生成（一次
 * AI 调用出编号标签表）。落库走 applyTagToRecord（IAL+记录+引用+源块）。
 */

export interface TagDeps {
    t: (key: string) => string;
    bank: QuestionBank;
    modelId: string;
    /** 习题文档 id（题单范围）。 */
    docId: string;
    docTitle: string;
    onDone?(): void;
}

/** 自由生成单批题数（一次 AI 调用打包的题干数）。 */
const FREE_BATCH = 15;

export async function openTagDialog(deps: TagDeps): Promise<void> {
    const { t } = deps;
    const dialog = new Dialog({
        title: fmt(t("tagTitle"), { doc: deps.docTitle }),
        width: "560px",
        content: `<div class="b3-dialog__content wengu-dialog">
      <div class="wengu-muted">${esc(t("tagHint"))}</div>
      ${formGroup(
          t("tagPhaseGroup"),
          formRow(t("tagGenLabel"), t("tagGenHint"), formSwitch("tag-gen", true, "data-act"))
      )}
      <div class="wengu-status" data-act="tag-status" hidden></div>
    </div>
    <div class="b3-dialog__action">
      <button class="b3-button b3-button--cancel" data-act="tag-cancel">${esc(t("cancel"))}</button>
      <button class="b3-button b3-button--outline" data-act="tag-ok">${esc(t("tagStart"))}</button>
    </div>`,
    });
    const root = dialog.element;
    const status = root.querySelector<HTMLElement>("[data-act='tag-status']");
    const show = (text: string, kind: "ok" | "err" | "muted"): void => {
        if (!status || !status.isConnected) return;
        status.textContent = text;
        status.className = `wengu-status wengu-status-${kind}`;
        status.removeAttribute("hidden");
    };
    const cancelAll = (): void => {
        ctrl?.abort();
        dialog.destroy();
    };
    root.querySelector("[data-act='tag-cancel']")?.addEventListener("click", cancelAll);
    root.querySelector(".b3-dialog__close")?.addEventListener("click", () => ctrl?.abort());
    const okBtn = root.querySelector<HTMLButtonElement>("[data-act='tag-ok']");
    let running = false;
    let ctrl: AbortController | undefined;
    okBtn?.addEventListener("click", () => {
        if (running) {
            ctrl?.abort();
            return;
        }
        if (convertRunActive()) {
            show(t("convertBusy"), "err");
            return;
        }
        running = true;
        ctrl = new AbortController();
        const gen = root.querySelector<HTMLInputElement>("[data-act='tag-gen']")?.checked ?? true;
        void runTag(deps, dialog, gen, ctrl, show, okBtn, () => {
            running = false;
            ctrl = undefined;
        });
    });
}

async function runTag(
    deps: TagDeps,
    dialog: Dialog,
    doGen: boolean,
    ctrl: AbortController,
    show: (text: string, kind: "ok" | "err" | "muted") => void,
    okBtn: HTMLButtonElement,
    onEnd: () => void
): Promise<void> {
    const { t, bank, modelId } = deps;
    okBtn.textContent = t("matchStop");
    show(t("matchPreparing"), "muted");
    try {
        const records = (await bank.recordsOfDoc(deps.docId)).slice();
        if (records.length === 0) throw new Error(t("tagNoQuestions"));
        const tagged = records.filter((r) => r.knowledge);
        const untagged = records.filter((r) => !r.knowledge);
        const roots = await knowRootsOf(bank);
        const lex = roots.length > 0 ? await lexiconOfRoots(roots) : new Map();
        // 阶段一 核对：已有标签 → 归一匹配挂引用（零 AI）。已挂引用的题
        // 记 skip（不动），命中的挂引用，没命中的=标签在知识文档无对应小节
        const verified = await linkRecordsByText(bank, lex, tagged, { signal: ctrl.signal });
        const linked = verified.hit;
        const unmatched = verified.miss;
        // 阶段二 生成：无标签 → AI 打标签（逐题两级路由带按题指纹缓存，
        // 未变的题重跑零 AI 调用）
        let genOk = 0;
        let genMiss = 0;
        const fails: KnowRouteFail[] = [];
        const failCount = new Map<MatchFailKind, number>();
        const cache = routeCache();
        if (doGen && !ctrl.signal.aborted && untagged.length > 0 && dialog.element.isConnected) {
            const index = roots.length > 0 ? await buildKnowledgeIndex(roots) : undefined;
            const useRoute = (index?.chapters.length ?? 0) > 0;
            if (useRoute) {
                for (let i = 0; i < untagged.length; i++) {
                    if (ctrl.signal.aborted || !dialog.element.isConnected) break;
                    const r = untagged[i];
                    show(fmt(t("tagGenRunning"), { c: String(i + 1), n: String(untagged.length) }), "muted");
                    let done = false;
                    try {
                        const secs = await routeKnowledgeCached({
                            text: routeTextOf(r),
                            index: index!,
                            modelId,
                            call: (m) => agentChatOnce(m, modelId, AI_TIMEOUT.quick, ctrl.signal),
                            onFail: (f) => fails.push(f),
                        });
                        if (secs.length > 0) done = await applyTagToRecord(bank, r, secs[0].title, secs);
                    } catch (_) {
                        // 路由失败按未生成，不阻断后续题
                    }
                    if (done) genOk++;
                    else genMiss++;
                }
            } else {
                genOk = await genFreeTags(bank, modelId, untagged, ctrl, show, t);
                genMiss = untagged.length - genOk;
            }
        }
        await bank.flush();
        await cache?.flush();
        for (const f of fails) {
            const k = classifyMatchFail(String(f.error?.message ?? f.error ?? ""));
            failCount.set(k, (failCount.get(k) ?? 0) + 1);
        }
        const topFail = [...failCount.entries()].sort((a, b) => b[1] - a[1])[0];
        const failHint =
            genOk === 0 && genMiss > 0 && topFail
                ? "\n" + fmt(t(`matchFail_${topFail[0]}`), { n: String(topFail[1]) })
                : "";
        show(
            ctrl.signal.aborted
                ? fmt(t("matchAborted"), { h: String(linked + genOk) })
                : fmt(t("tagDone"), {
                      v: String(tagged.length),
                      l: String(linked),
                      u: String(unmatched),
                      g: String(genOk),
                      m: String(genMiss),
                  }) + failHint,
            ctrl.signal.aborted ? "muted" : linked + genOk === 0 ? "err" : "ok"
        );
        if (!ctrl.signal.aborted) window.setTimeout(() => dialog.destroy(), 800);
        deps.onDone?.();
    } catch (e) {
        show(String((e as Error)?.message ?? e), "err");
    } finally {
        okBtn.textContent = t("tagStart");
        onEnd();
    }
}

/** 无知识文档时的整批自由生成：一次 AI 调用出编号标签表，逐题落库。 */
async function genFreeTags(
    bank: QuestionBank,
    modelId: string,
    records: BankRecord[],
    ctrl: AbortController,
    show: (text: string, kind: "ok" | "err" | "muted") => void,
    t: (key: string) => string
): Promise<number> {
    let ok = 0;
    for (let base = 0; base < records.length; base += FREE_BATCH) {
        if (ctrl.signal.aborted) break;
        const batch = records.slice(base, base + FREE_BATCH);
        const list = batch.map((r, i) => `${i + 1}|${routeTextOf(r).slice(0, 300)}`).join("\n");
        show(fmt(t("tagGenRunning"), { c: String(base + 1), n: String(records.length) }), "muted");
        let tags = new Map<number, string>();
        try {
            const reply = await agentChatOnce(
                `你是刷题库的知识点标注器。下面是编号题目的题干节选。给每道题标一个最贴切的知识点标签：不超过 12 字、沿用题目原文的术语、不造新词、不同题可以同标签。
输出格式（每题一行，格式之外不要输出任何文字；没有合适标签的题输出 编号|-）：
1|标签
2|标签

题目：
${list}`,
                modelId,
                AI_TIMEOUT.batch,
                ctrl.signal
            );
            tags = parseFreeTags(reply);
        } catch (_) {
            // 本批生成失败：跳过，下一批继续
        }
        for (let i = 0; i < batch.length; i++) {
            const tag = tags.get(i + 1);
            if (tag && (await applyTagToRecord(bank, batch[i], tag, []))) ok++;
        }
    }
    return ok;
}
