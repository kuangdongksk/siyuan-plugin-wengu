import type { DraftPart, DraftUnit } from "./QuestionDraft";

/**
 * 挤行选项拆行（Issue #131 自 OptionShuffle.unpackPackedSingle 接出）：
 * AI 无视「每个选项一个 @@P opt」把全部选项塞进同一部件时，渲染只给
 * 首行编字母、其余行成续行——落库即「只剩正确选项」。
 *
 * 与旧实现的**唯一差别**：**不碰答案字母**。旧版把答案改写成 A，前提是
 * 「协议保证首行=正确项」（正确项写最前的重排口径）；死形态协议（题干/
 * 答案按原文顺序与字母）下字母指向原文位置，拆行只是把一行拆成多行，
 * 字母语义完全不变——改答案就是凭空判错。
 *
 * 拆法：在同一个 option 部件后**插入同名的后续选项部件**（渲染层按连续
 * 同名部件合并重编字母，见 renderUnit 的 optGroupOf/flushOpts）。单行
 * 部件原样不动（零改动）。
 */

/** 选项部件名（顶层 option / step-k option；slot-opt 是逐空候选池，不拆）。 */
const OPTION_PART = /^option|^step-\d+-option/;

/** 拆一个 quiz 单元里所有「挤行」的选项部件。
 *  **返回新对象**（纯函数口径，与 OptionRefReplace 同款）：无挤行时返回
 *  原对象（引用相等、零开销），调用方手里的 draft 不被改写。 */
export function unpackPackedOptions(d: DraftUnit): DraftUnit {
    if (d.material) return d;
    const out: DraftPart[] = [];
    let hit = false;
    for (const p of d.parts) {
        if (!OPTION_PART.test(p.name)) {
            out.push(p);
            continue;
        }
        const lines = p.text
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
        if (lines.length < 2) {
            out.push(p);
            continue;
        }
        hit = true;
        for (const text of lines) out.push({ name: p.name, text });
    }
    return hit ? { ...d, parts: out } : d;
}
