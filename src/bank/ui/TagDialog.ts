import { errText } from "./../../ui/shared";
import { agentChatOnce, newAiGroupId, type AiAbort } from "../../ai/client";
import { launchAiFlow } from "../../ai/flow";
import { freeTagPrompt } from "../../ai/prompts/gen";
import { notifyError, notifyInfo } from "../../ui/Notify";
import { AI_TIMEOUT } from "../../ai/timeouts";
import {
    buildKnowledgeIndex,
    classifyMatchFail,
    type KnowRouteFail,
    type MatchFailKind,
} from "../../convert/service/KnowledgeLink";
import { convertRunActive } from "../../convert/service/ConvertRun";
import { formGroup, formRow, formSwitch } from "../../ui/FormHtml";
import { openWenguDialog } from "../../ui/Dialog";
import { esc, fmt } from "../../ui/shared";
import type { BankRecord, QuestionBank } from "../data/QuestionBank";
import { recordsOfDoc } from "../data/BankRegen";
import { knowRootsOf } from "../data/KnowRoots";
import { applyTagToRecord, lexiconOfRoots, linkRecordsByText, parseFreeTags } from "../data/KnowLinkText";
import { knowTreesOf } from "../data/KnowTrees";
import { routeCache, routeKnowledgeBatchCached } from "../data/RouteCache";
import { routeTextOf } from "./MatchDialog";

/**
 * 生成标签（2026-08-31，侧栏文档右键入口）：对一份习题文档的题单分两相——
 * **核对**：已有 knowledge 标签的题与知识文档小节做归一匹配（零 AI），
 * 命中挂引用，未匹配（标签在知识文档里无对应小节）计数上报；
 * **生成**：没有标签的题 AI 打标签——登记了知识文档时逐题两级路由
 * （标签=命中小节标题、词表受控不造新词），否则整批自由生成（一次
 * AI 调用出编号标签表）。落库走 applyTagToRecord（IAL+记录+引用+源块）。
 *
 * 20260905 起点击开始即关窗（弹窗去阻塞改造）：后台流经 launchAiFlow
 * 单飞，进度与「停止」在 AI 会话面板，终态走思源通知。
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
    const { dialog, root } = openWenguDialog({
        title: fmt(t("tagTitle"), { doc: deps.docTitle }),
        body: `
      <div class="wengu-muted">${esc(t("tagHint"))}</div>
      ${formGroup(t("tagPhaseGroup"), formRow(t("tagGenLabel"), t("tagGenHint"), formSwitch("tag-gen", true, "data-act")))}
    `,
        actions: [
            { id: "tag-cancel", label: t("cancel") },
            { id: "tag-ok", label: t("tagStart"), variant: "outline" },
        ],
    });
    root.querySelector("[data-act='tag-cancel']")?.addEventListener("click", () => dialog.destroy());
    root.querySelector("[data-act='tag-ok']")?.addEventListener("click", () => {
        if (convertRunActive()) {
            notifyError(deps.t("convertBusy"));
            return;
        }
        const gen = root.querySelector<HTMLInputElement>("[data-act='tag-gen']")?.checked ?? true;
        dialog.destroy(); // 点击即关窗：后台流，终态走通知
        launchAiFlow((stop) => runTag(deps, gen, stop));
    });
}

async function runTag(deps: TagDeps, doGen: boolean, stop: AiAbort): Promise<void> {
    const { t, bank, modelId } = deps;
    try {
        const records = (await recordsOfDoc(bank, deps.docId)).slice();
        if (records.length === 0) throw new Error(t("tagNoQuestions"));
        const tagged = records.filter((r) => r.knowledge);
        const untagged = records.filter((r) => !r.knowledge);
        const roots = await knowRootsOf(bank);
        const lex = roots.length > 0 ? await lexiconOfRoots(roots, await knowTreesOf(bank)) : new Map();
        // 阶段一 核对：已有标签 → 归一匹配挂引用（零 AI）。已挂引用的题
        // 记 skip（不动），命中的挂引用，没命中的=标签在知识文档无对应小节
        const verified = await linkRecordsByText(bank, lex, tagged, { signal: stop.signal });
        const linked = verified.hit;
        const unmatched = verified.miss;
        // 阶段二 生成：无标签 → AI 打标签（逐题两级路由带按题指纹缓存，
        // 未变的题重跑零 AI 调用）
        let genOk = 0;
        let genMiss = 0;
        const fails: KnowRouteFail[] = [];
        const failCount = new Map<MatchFailKind, number>();
        const cache = routeCache();
        if (doGen && !stop.signal.aborted && untagged.length > 0) {
            const index = roots.length > 0 ? await buildKnowledgeIndex(roots, await knowTreesOf(bank)) : undefined;
            const useRoute = (index?.chapters.length ?? 0) > 0;
            // 动作分组（AI 会话面板树归并）：路由生成/自由生成分批挂同组
            const group = { id: newAiGroupId(), title: `生成标签 · ${untagged.length} 题` };
            if (useRoute) {
                // 20260909 起按批两级路由替代逐题——一批一次调用、逐题指纹
                // 缓存，未变的题重跑零 AI 调用
                const texts = untagged.map((r) => routeTextOf(r));
                const refsPerQ = await routeKnowledgeBatchCached({
                    texts,
                    index: index!,
                    modelId,
                    call: (m) =>
                        agentChatOnce(m, modelId, AI_TIMEOUT.batch, stop.signal, {
                            kind: "route",
                            title: `标签路由 · ${texts.length} 题`,
                            group,
                            onSid: stop.onSid,
                        }),
                    onFail: (f) => fails.push(f),
                    signal: stop.signal,
                });
                for (let i = 0; i < untagged.length; i++) {
                    if (stop.signal.aborted) break;
                    const r = untagged[i];
                    const secs = refsPerQ[i] ?? [];
                    const done = secs.length > 0 ? await applyTagToRecord(bank, r, secs[0].title, secs) : false;
                    if (done) genOk++;
                    else genMiss++;
                }
            } else {
                genOk = await genFreeTags(bank, modelId, untagged, stop, group);
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
        if (stop.signal.aborted) {
            notifyInfo(fmt(t("matchAborted"), { h: String(linked + genOk) }));
        } else {
            const summary = fmt(t("tagDone"), {
                v: String(tagged.length),
                l: String(linked),
                u: String(unmatched),
                g: String(genOk),
                m: String(genMiss),
            });
            if (linked + genOk === 0 && failHint) notifyError(summary + failHint);
            else notifyInfo(summary + failHint);
        }
        deps.onDone?.();
    } catch (e) {
        notifyError(stop.signal.aborted ? t("aiFlowAborted") : errText(e));
    }
}

/** 无知识文档时的整批自由生成：一次 AI 调用出编号标签表，逐题落库。 */
async function genFreeTags(
    bank: QuestionBank,
    modelId: string,
    records: BankRecord[],
    stop: AiAbort,
    /** 动作分组（AI 会话面板树归并）：与本弹窗其他 AI 调用挂同组。 */
    group: { id: string; title: string }
): Promise<number> {
    let ok = 0;
    for (let base = 0; base < records.length; base += FREE_BATCH) {
        if (stop.signal.aborted) break;
        const batch = records.slice(base, base + FREE_BATCH);
        const list = batch.map((r, i) => `${i + 1}|${routeTextOf(r).slice(0, 300)}`).join("\n");
        let tags = new Map<number, string>();
        try {
            const reply = await agentChatOnce(freeTagPrompt(list), modelId, AI_TIMEOUT.batch, stop.signal, {
                kind: "tag",
                title: `自由生成标签 · ${batch.length} 题`,
                group,
                onSid: stop.onSid,
            });
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
