import { errText } from "./../../ui/shared";
import { agentChatOnce, newAiGroupId, type AiAbort } from "../../ai/client";
import { launchAiFlow } from "../../ai/flow";
import { notifyError, notifyInfo } from "../../ui/Notify";
import { AI_TIMEOUT } from "../../ai/timeouts";
import {
    buildKnowledgeIndex,
    classifyMatchFail,
    type KnowRouteFail,
    type MatchFailKind,
} from "../../convert/service/knowledge/KnowledgeLink";
import { knowTreesOf } from "../data/KnowTrees";
import { setFallbackTitle } from "../data/BankSets";
import { KernelDoc } from "../../siyuan/doc";
import { convertRunActive } from "../../convert/service/run/ConvertRun";
import { formGroup, formOption, formRow, formSelect, formSwitch } from "../../ui/FormHtml";
import { openWenguDialog } from "../../ui/Dialog";
import { esc, fmt } from "../../ui/shared";
import { parseQuestionKramdown } from "../data/BankParse";
import type { BankRecord, QuestionBank } from "../data/QuestionBank";
import { recordsOfDoc } from "../data/BankRegen";
import { applyRefsToRecord } from "../data/KnowLinkText";
import { routeCache, routeKnowledgeBatchCached } from "../data/RouteCache";

/**
 * 知识文档 × 存量题库匹配（20260828）：知识面板文档行「匹配」入口——
 * 选一份已入库的习题文档（题库源卷，存量/新建同权），对其题目逐题走
 * 转换同款两级 AI 路由（带按题指纹缓存，未变的题重跑零 AI 调用），把
 * 「相关知识点」块引用确定性注入题库记录（strip+inject=替换语义，默认
 * 跳过已关联题），源文档块尽力同步（题库为主记录，模式同 RegenDialog）。
 * 内核调用全程串行；AI 路由走独立会话（agentChatOnce，逐题 await 天然
 * 串行）。
 *
 * 20260905 起点击开始即关窗（弹窗去阻塞改造）：后台流经 launchAiFlow
 * 单飞，进度与「停止」在 AI 会话面板（track 实时登记），终态走思源
 * 通知——产物保留已落部分，中止不清偿。
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
    const data = await bank.all();
    const options = sourceDocOptions(Object.values(data.records));
    const info = await KernelDoc.infoOf(options.map((o) => o.docId));
    // 题集标题三级解析：存量卷（sourceDocId=旧习题文档 id）走内核文档活
    // 标题；20260903 pivot 起转换题集是库内实体（set-* 源 id，无内核文档）
    // 读 bank.sets；两头皆无兜底短 id——裸 id 直出即本弹窗踩坑形态
    const sets = data.sets ?? {};
    const titleOf = (id: string): string => info.get(id)?.title ?? sets[id]?.title ?? setFallbackTitle(id);
    const { dialog, root } = openWenguDialog({
        title: fmt(t("matchTitle"), { doc: deps.knowTitle }),
        body: `
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
                                            t: titleOf(o.docId),
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
    `,
        actions: [
            { id: "match-cancel", label: t("cancel") },
            { id: "match-ok", label: t("matchStart"), variant: "outline", disabled: options.length === 0 },
        ],
    });
    root.querySelector("[data-act='match-cancel']")?.addEventListener("click", () => dialog.destroy());
    root.querySelector("[data-act='match-ok']")?.addEventListener("click", () => {
        // 转换运行中不开第二条内核写流（updateBlock 与转换并发互吞，20260829 审查）
        if (convertRunActive()) {
            notifyError(deps.t("convertBusy"));
            return;
        }
        const src = root.querySelector<HTMLSelectElement>("[data-act='match-src']")?.value ?? "";
        if (!src) return;
        const skip = root.querySelector<HTMLInputElement>("[data-act='match-skip']")?.checked ?? true;
        dialog.destroy(); // 点击即关窗：后台流，终态走通知
        launchAiFlow((stop) => runMatch(deps, src, skip, stop));
    });
}

async function runMatch(deps: MatchDeps, srcDocId: string, skipLinked: boolean, stop: AiAbort): Promise<void> {
    const { t, bank, modelId } = deps;
    try {
        const index = await buildKnowledgeIndex([deps.knowDocId], await knowTreesOf(bank));
        if (index.chapters.length === 0) throw new Error(t("matchNoIndex"));
        const records = (await recordsOfDoc(bank, srcDocId)).slice();
        // 动作分组（AI 会话面板树归并）：本次匹配的路由调用挂同组
        const group = { id: newAiGroupId(), title: `匹配 · ${records.length} 题` };
        let hit = 0;
        let miss = 0;
        let skip = 0;
        // 失败诊断（20260829「0 命中无线索」）：路由失败上报，跑完 hit=0 时
        // 按类别给状态栏一句人话（模型失效/超时/网络），不再被静默吞成「未命中」。
        const fails: KnowRouteFail[] = [];
        const failCount = new Map<MatchFailKind, number>();
        const cache = routeCache();
        // 预过滤：skipLinked 跳过已关联题，其余批量路由（20260909 起按批
        // 两级路由替代逐题——一批一次调用、逐题指纹缓存，未变的题重跑零 AI）
        const toRoute: BankRecord[] = [];
        for (const r of records) {
            if (skipLinked && r.kpRefs.length > 0) skip++;
            else toRoute.push(r);
        }
        if (toRoute.length > 0) {
            const texts = toRoute.map((r) => routeTextOf(r));
            const refsPerQ = await routeKnowledgeBatchCached({
                texts,
                index,
                modelId,
                call: (m) =>
                    agentChatOnce(m, modelId, AI_TIMEOUT.batch, stop.signal, {
                        kind: "route",
                        title: `匹配路由 · ${texts.length} 题`,
                        group,
                        onSid: stop.onSid,
                    }),
                onFail: (f) => fails.push(f),
                signal: stop.signal,
            });
            for (let i = 0; i < toRoute.length; i++) {
                if (stop.signal.aborted) break;
                const r = toRoute[i];
                const refs = refsPerQ[i] ?? [];
                if (refs.length > 0) {
                    // strip+inject 落库 + 源块尽力同步（批量关联共用同一原语）
                    if (await applyRefsToRecord(bank, r, refs)) hit++;
                    else miss++;
                } else miss++;
            }
        }
        await bank.flush();
        await cache?.flush();
        // 汇总失败类别（路由失败原因归类计数，hit=0 时挑最多的一类提示）
        for (const f of fails) {
            const k = classifyMatchFail(String(f.error?.message ?? f.error ?? ""));
            failCount.set(k, (failCount.get(k) ?? 0) + 1);
        }
        const topFail = [...failCount.entries()].sort((a, b) => b[1] - a[1])[0];
        const failHint =
            hit === 0 && miss > 0 && topFail ? "\n" + fmt(t(`matchFail_${topFail[0]}`), { n: String(topFail[1]) }) : "";
        if (stop.signal.aborted) {
            notifyInfo(fmt(t("matchAborted"), { h: String(hit) }));
        } else if (hit === 0 && failHint) {
            notifyError(fmt(t("matchDone"), { h: String(hit), m: String(miss), s: String(skip) }) + failHint);
        } else {
            notifyInfo(fmt(t("matchDone"), { h: String(hit), m: String(miss), s: String(skip) }) + failHint);
        }
        deps.onDone?.();
    } catch (e) {
        notifyError(stop.signal.aborted ? t("aiFlowAborted") : errText(e));
    }
}
