/**
 * 记录 → 流归属说明（Issue #77，纯逻辑带单测）：记录详情**一律不再渲染
 * 停止钮**，改出一行「这条记录属于哪条流、要停去上方横幅」的说明。
 *
 * 三条口径：
 *  1. **多调用流的记录**（整卷/批量转换、六批流）：出归属说明行，指向上方
 *     横幅（那里的停止钮才是有效入口）；
 *  2. **单调用流**（判分/伴学/出题/索引路由等）：**不出任何停止 UI**
 *     ——它们本就没有有效的流级停止面（track 无 onSid 或流是单发调用），
 *     现状即维持；
 *  3. 非 running（done/error）：无需说明（没有「正在跑」可停）。
 *
 * 判定只看 kind 与 status，不读 DOM、不碰注册表——面板重载/换流都不影响
 * 口径，且可被单测逐格锁死。
 */

import type { AiSessionRecord } from "../data/AiSessions";
import { fmt } from "../../ui/shared";

/** 流归属说明的形态：转换族 / 六批流（带流名）/ 单调用流（无说明）。 */
export type FlowOwnership = { kind: "none" } | { kind: "convert" } | { kind: "batch"; flowKey: string };

/** 六批流 + 转换族的 kind 白名单（ai/data/AiSessions 的 kind 值）。
 *  convert=整卷/批量转换族（横幅带批次号）；其余六个=批流（横幅带流名）。
 *  ⚠️ 新增 kind 必须同步此表——漏加即退化成「无说明」（宁缺勿错，但不该
 *  让新批流悄悄丢掉说明行）。 */
const CONVERT_KINDS = new Set(["convert", "detect"]);
const BATCH_KINDS: Record<string, string> = {
    route: "aiFlowTitleMatch",
    tag: "aiFlowTitleTag",
    regen: "aiFlowTitleRegen",
    outline: "aiFlowTitleOutline",
};

/**
 * 记录 → 归属性判定。判定只看 kind 与 status：不编造批次号（登记簿里没有
 * 这个字段，硬凑「第 i 批」反而误导），转换族一律出通用口径文案。
 */
export function flowOwnershipOf(rec: AiSessionRecord | undefined): FlowOwnership {
    if (!rec || rec.status !== "running") return { kind: "none" };
    if (CONVERT_KINDS.has(rec.kind)) return { kind: "convert" };
    const flowKey = BATCH_KINDS[rec.kind];
    return flowKey ? { kind: "batch", flowKey } : { kind: "none" };
}

/** 归属说明行的成品文案（i18n 已解析；单调用流返回空串=不渲染）。 */
export function ownershipTextOf(t: (k: string) => string, own: FlowOwnership): string {
    if (own.kind === "convert") return t("convertStoppedHint");
    if (own.kind === "batch") return fmt(t("aiFlowOwningBatch"), { flow: t(own.flowKey) });
    return "";
}
