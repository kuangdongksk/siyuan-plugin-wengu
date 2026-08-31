import { mountSvelteApp, type MountedSvelteApp } from "../../ui/mountApp";
import QuizCardApp from "../component/QuizCardApp.svelte";
import GroupUnitApp from "../component/GroupUnitApp.svelte";
import type { CardHtmlModel } from "./CardParts";
import type { CardInitCtx } from "./CardState";
import type { DrillUnit } from "./DrillUnits";
import type { AnswerHost } from "../flow/AnswerFlow";
import { esc } from "../../ui/shared";

/**
 * 题卡挂载编排（6-4a 渲染层组件化，6-4b 作答态收敛）：静态分片管线
 * 逐单元以组件挂载替代 insertAdjacentHTML 字符串插入——组件根顶替
 * 原字符串输出（追加到容器尾，DOM 契约逐字一致），renderOneUnitHtml/
 * renderCardHtml/renderSlotsCardHtml 字符串渲染退役。卡初始态上下文
 * （interactive/locked/restore）由调用方整卷一次算好随挂载传入，
 * 作答/判分经 flow/* 写组件内 CardUi 响应态（6-4b 三写收敛）。
 *
 * 长卷分片节奏（帧预算 yield）由调用方 renderStaticChunked 保持：
 * 本模块每单元同步挂载一次，stale 检查在挂载前（无 await 间隙），
 * 整壳重建（detachCardApps → innerHTML 覆盖）不会漏卸组件——
 * innerHTML 覆盖不触发 Svelte 卸载（暗雷 §7），卸载必须显式。
 */

/** 本壳已挂的题卡/组单元组件（renderQuizShellFor 整壳重建前与
 *  QuizView.destroy 兜底统一卸载）。 */
let apps: MountedSvelteApp[] = [];

/** 卸载全部题卡组件（整壳重建/视图销毁前必调）。 */
export function detachCardApps(): void {
    for (const a of apps) a.unmount();
    apps = [];
}

/** 挂载一个渲染单元到容器尾（静态分片管线逐片调用）。
 *  单元渲染失败给占位卡，不拖垮整个列表（旧 tryCard 同策）。 */
export function mountDrillUnit(
    container: HTMLElement,
    u: DrillUnit,
    m: CardHtmlModel,
    ctx: CardInitCtx,
    host: AnswerHost
): void {
    try {
        if (u.kind === "single") {
            apps.push(mountSvelteApp(QuizCardApp, container, { q: u.q!, idx: u.idx!, m, ctx, host }));
        } else {
            apps.push(
                mountSvelteApp(GroupUnitApp, container, {
                    qs: u.qs ?? [],
                    mid: u.mid ?? "",
                    t: m.t,
                    m,
                    material: u.material,
                    ctx,
                    host,
                    onActive: (idx: number): void => host.onActiveQ?.(idx),
                })
            );
        }
    } catch (e) {
        container.insertAdjacentHTML("beforeend", errorCardHtml(e));
    }
}

/** 占位卡：单卡渲染失败的兜底（与旧 tryCard 输出同构）。 */
function errorCardHtml(e: unknown): string {
    return `<div class="wengu-card"><div class="wengu-status wengu-status-err">${esc(
        String((e as Error)?.message ?? e)
    )}</div></div>`;
}
