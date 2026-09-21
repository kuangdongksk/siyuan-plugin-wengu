/**
 * Jev 转换质检的**报告展示**（Issue #184 需求 3）：转换完成时把「Jev 存疑」
 * 作为转换报告专属的一行显示，并在存疑时补一条站内通知兜底。
 *
 * 两条设计口径：
 *  - **只显示、不落盘**：判定结果随这次运行的内存载荷（`BatchedResult.qc`）
 *    抵达，报告关了即没——不写任何持久化存储（数据演进守则）。
 *  - **零追加**：`qc` 缺键（没配 key / 总开关关 / 判定失败 / 无存疑）时
 *    本模块**一个字符都不写**——转换条与通知的既有文案逐字不变。
 *
 * 展示位置就是页内那个 `[data-status]` 槽：`showStatus` 已把「已入库《…》
 * 共 N 题」写进去，本行**追加在后面**（追加而非另起的理由：状态槽会随
 * 页签重渲染被重放/清掉，另起一个浮层反而会与它在生命周期上打架）。
 * ⚠️ 槽一律从**宿主元素**取（`el.querySelector`），不用全局 `document`：
 * 页签可开多份、插件面板与工作区各有自己的槽，全局取第一个会写错地方。
 */
import { esc } from "../../ui/shared";
import { notifyInfo } from "../../ui/Notify";
import { dedupeSuspects, qcSummary, suspectLabel } from "../../ai/jev/convertChecks";
import type { ConvertQc } from "../service/run/ConvertBatch";

/**
 * 存疑项的可见标注行：**首行是汇总头（复用 `qcSummary`，唯一组装点）**，
 * 其后每项一行「· 哪一项存疑（一句原因）」——逐项展开是为了让用户不用
 * 猜「存疑」指什么；汇总头里的题数由在这里填，**不留字面 `{n}`**。
 */
export function linesOf(t: (k: string) => string, qc: ConvertQc): string[] {
    const head = qcSummary(t, { checked: qc.checked, suspects: qc.suspects });
    return [head, ...dedupeSuspects(qc.suspects).map((s) => `· ${suspectLabel(t, s)}`)];
}

/** 报告行文本（无存疑 → 空串；调用方据此零追加）。 */
export function jevQcLines(t: (k: string) => string, qc: ConvertQc | undefined): string {
    if (!qc || qc.suspects.length === 0) return "";
    return linesOf(t, qc).join("\n");
}

/**
 * 展示一次质检结果：给**宿主元素**的状态槽追加专属行 + 一条站内通知
 * （用户可能已切走，报告行看不见）。`qc` 无键/无存疑时**零动作**。
 */
export function showJevQc(el: HTMLElement | undefined, t: (k: string) => string, qc: ConvertQc | undefined): void {
    const text = jevQcLines(t, qc);
    if (!text) return;
    const slot = el?.querySelector<HTMLElement>("[data-status]");
    if (slot) {
        // 追加而非替换：详情展开在既有状态文案之后（报告专属行）
        const detail = `<span class="wengu-jev-qc">${text
            .split("\n")
            .map((l) => esc(l))
            .join("<br>")}</span>`;
        slot.innerHTML = `${slot.innerHTML}<br>${detail}`;
        slot.removeAttribute("hidden");
    }
    notifyInfo({ key: "notifyJevQc", vars: { n: String(qc?.suspects.length ?? 0) } });
}
