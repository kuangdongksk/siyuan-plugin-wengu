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
import { AI_STOPPED } from "../data/AiSessions";
import type { SessionLogSeg } from "./SessionDetail";
import { fmt } from "../../ui/shared";

/** 流归属说明的形态：转换族 / 六批流（带流名）/ 单调用流（无说明）；
 *  `stopped*` 两态=**已被停止**的记录（Issue #88 设计稿 ai-panel-stopped
 *  屏的 own-note：不再指路「去哪停」，而是交代「已随整批停下、抉择在哪」）。 */
export type FlowOwnership =
    | { kind: "none" }
    | { kind: "convert" }
    | { kind: "batch"; flowKey: string }
    | { kind: "stoppedConvert" }
    | { kind: "stoppedBatch"; flowKey: string };

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
    if (!rec) return { kind: "none" };
    const flowKey = BATCH_KINDS[rec.kind];
    // 被停止（Issue #88）：error 态 + AI_STOPPED 哨兵。与在途态同一张
    // 白名单——非多调用流（判分/伴学…）没有流级停止面，被中止也只当
    // 普通失败，不出归属说明。
    if (rec.status === "error" && rec.error === AI_STOPPED) {
        if (CONVERT_KINDS.has(rec.kind)) return { kind: "stoppedConvert" };
        return flowKey ? { kind: "stoppedBatch", flowKey } : { kind: "none" };
    }
    if (rec.status !== "running") return { kind: "none" };
    if (CONVERT_KINDS.has(rec.kind)) return { kind: "convert" };
    return flowKey ? { kind: "batch", flowKey } : { kind: "none" };
}

/**
 * 该归属形态**有无「抉择」入口**（Issue #88）：只有转换族有保留/丢弃抉择
 * （设计稿 ai-panel-stopped 的归属备注指路「前往页内转换条抉择」）；六个
 * 批流（匹配/标签/重出…）停下就是停下，没有二选一——给它们出这个钮会把
 * 用户引到**转换条**，那是另一条流的入口。
 */
export function decideEntryOf(own: FlowOwnership): boolean {
    return own.kind === "stoppedConvert";
}

/**
 * 归属说明行的**分段文案**（Issue #92 gap-list A7 on top of Issue #88 的
 *  `stopped*` 两态语义）：设计稿的 own-note 是 `<b>首句加粗（归属）</b>` +
 * 正文 + `<span class="at">入口词</span>`（主色强调「停止整批转换」）——
 * **文案分段供给，组件不解析字符串**（同 SessionDetail 的日志分段口径）。
 * 单调用流返回空数组=不渲染。
 *
 * 四段各取一词，代码不拼句：
 *  - `aiOwnHeadConvert` / `aiOwnHeadBatch`（**加粗**；批流派带 `{flow}` 流名）
 *  - `aiOwnBody`（正文，**含开启的引导引号**）
 *  - 入口钮词（主色，复用横幅那一组 `aiFlowStop*`——**动作名即范围**）
 *  - `aiOwnTail`（收尾，**含闭合的引导引号**与句读）
 *
 * 引号/顿号/连接符都是**语言相关写法**（中文「」、英文 “”），故归各自的
 * 模板携带；在代码里拼会把两套写法各钉死一次。
 *
 * ⚠️ **首段的取词必须按 kind 分**（Issue #88 的停止态语义不许被本单冲掉）：
 * `stoppedConvert`/`stoppedBatch` 是在途归属说明的**另一句话**（「已随整批
 * 停下、抉择在哪」），拿 `convert` 的模板套过去会让用户已经停了还被指路
 * 「请去停止」。故 `aiOwnStopped*` 两键进**首段**（加粗位），`aiOwnBody`/
 * `aiOwnTail`（正文与收尾的**结构**，不含停止动作词）两态共用：
 * `aiOwnBody` 的中文引号只在加粗首段以句读收束时才成对（英文侧改全角
 * 逗号收束，见 i18n 注释），`aiOwnTail` 是**句末**收尾、不引住任何词。
 * 入口钮词仍**只属在途态**（停止后的动作是页内抉择，不是「停止整批转换」）。
 */
export function ownershipSegsOf(t: (k: string) => string, own: FlowOwnership): SessionLogSeg[] {
    if (own.kind === "none") return [];
    const stopped = own.kind === "stoppedConvert" || own.kind === "stoppedBatch";
    const batch = own.kind === "batch" || own.kind === "stoppedBatch";
    const head = stopped
        ? batch
            ? fmt(t("aiOwnStoppedBatch"), { flow: t(own.flowKey) })
            : t("aiOwnStoppedConvert")
        : batch
          ? fmt(t("aiOwnHeadBatch"), { flow: t(own.flowKey) })
          : t("aiOwnHeadConvert");
    const segs: SessionLogSeg[] = [
        { text: head, em: false, bold: true },
        { text: t("aiOwnBody"), em: false },
    ];
    if (!stopped) segs.push({ text: t(batch ? "aiFlowStop" : "aiFlowStopBatch"), em: false, accent: true });
    segs.push({ text: t("aiOwnTail"), em: false });
    return segs;
}
