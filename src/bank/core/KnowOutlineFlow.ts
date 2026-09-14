import { fmt } from "../../ui/shared";
import { beginAiFlow, endAiFlow, progressAiFlow } from "../../ai/core/FlowRegistry";
import { flowBar } from "../../ai/core/FlowBannerUi";

/**
 * AI 索引（归纳大纲）的流级横幅接线（Issue #77）：索引不由 ConvertRun 起
 * （它是面板控制器自建 controller 的串行循环），故在这里自起一条流—
 * begin 挂「再点=中止」的同一处 ctrl，end 由收口段调（**逐篇与整批都必达**）。
 *
 * 单独成文件的原因：KnowPanelCtl 已越过 500 行红线（只加不拆），横幅
 * 接线逻辑放它里面只会继续胀；这里给一对极小的 begin/end，控制器各一行。
 */

/** 索引流的横幅 id（同时只跑一份，固定 id）。 */
export const OUTLINE_FLOW_ID = "outline";

/** 单流态载荷（bar + 富统计「已索引 i 之 n 篇」；多篇才有，单篇索引
 *  无可呈现的推进量——设计稿「单流态 = bar + stats + 停止钮」）。 */
function payloadOf(
    t: (k: string) => string,
    done: number,
    total: number
): { stats: { fields: { hint: string; value: string; tail: string }[] }; bar: ReturnType<typeof flowBar> } | undefined {
    if (total <= 1) return undefined;
    const label = fmt(t("aiFlowOutlineProgress"), { i: String(done), n: String(total) });
    return {
        stats: {
            fields: [
                {
                    hint: t("aiFlowStatIndexed"),
                    value: String(done),
                    tail: `/${total} ${t("aiFlowUnitItem")}`,
                },
            ],
        },
        bar: flowBar((done / total) * 100, label),
    };
}

/** 起流（batch=篇数>1 时进度按「已索引 i/n 篇」呈现；单篇索引只剩流名 +
 *  停止钮——它本就是一次调用，无推进量可报）。 */
export function beginOutlineFlow(t: (k: string) => string, total: number, stop: () => void): void {
    beginAiFlow({
        id: OUTLINE_FLOW_ID,
        title: t("aiFlowTitleOutline"),
        progress: total > 1 ? fmt(t("aiFlowOutlineProgress"), { i: "0", n: String(total) }) : undefined,
        stop,
    });
    progressOutlineFlow(t, 0, total);
}

/** 推进「已索引 i/n 篇」（单篇索引无此摘要，静默）。 */
export function progressOutlineFlow(t: (k: string) => string, done: number, total: number): void {
    const payload = payloadOf(t, done, total);
    if (!payload) return;
    progressAiFlow(
        OUTLINE_FLOW_ID,
        fmt(t("aiFlowOutlineProgress"), { i: String(done), n: String(total) }),
        undefined,
        payload
    );
}

/** 收口（收尾段必达；不在途的 id 静默忽略——幂等）。 */
export function endOutlineFlow(): void {
    endAiFlow(OUTLINE_FLOW_ID);
}

/** 逐篇执行体的结果累计（面板侧 OutlineRun 的形状由调用方镜像）。 */
export interface OutlineFlowRun {
    ok: number;
    skip: number;
    fail: number;
    count: number;
    lastErr: string;
}

/**
 * 逐篇串行执行 + 流级横幅（Issue #77）：**手动「索引」与导入后自动补索引
 * 两路共用同一份**（控制器只传「跑一篇」的 worker，不再自己写循环）。
 *
 * 横幅由 finally 收口——每条收口路径（正常/中止/失败/异常）都必达。
 * 逐篇串行（fetchSyncPost 串行约束）、可中止（ctrl.signal）、空文档计入
 * 跳过、部分失败不打断；全灭与否由调用方判。对每篇 callback 给「已索引
 * i/n 篇」推进口。
 */
export async function runOutlineFlow(
    t: (k: string) => string,
    ids: string[],
    ctrl: AbortController,
    perDoc: (docId: string, onProgress: (done: number) => void) => Promise<number>
): Promise<OutlineFlowRun> {
    const run: OutlineFlowRun = { ok: 0, skip: 0, fail: 0, count: 0, lastErr: "" };
    beginOutlineFlow(t, ids.length, () => ctrl.abort());
    try {
        for (let i = 0; i < ids.length; i++) {
            if (ctrl.signal.aborted) break;
            progressOutlineFlow(t, i, ids.length);
            try {
                run.count += await perDoc(ids[i], (done) => progressOutlineFlow(t, done, ids.length));
                run.ok++;
            } catch (e) {
                if (ctrl.signal.aborted) break;
                const msg = String((e as Error)?.message ?? e);
                if (msg.includes("doc has no content"))
                    run.skip++; // 空文档（目录壳）
                else {
                    run.fail++;
                    run.lastErr = msg;
                }
            }
        }
        return run;
    } finally {
        endOutlineFlow();
    }
}
