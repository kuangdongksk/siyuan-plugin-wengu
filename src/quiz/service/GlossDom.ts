import { esc } from "../../ui/shared";
import { splitGlossBlock } from "../../convert/service/gloss/GlossEntry";
import type { GlossEntry, GlossSplit } from "../../convert/service/gloss/GlossEntry";

/**
 * 词表区（`@@G` 行）的**渲染与解析契约**（Issue #30 引入，Issue #53 三期
 * 收尾后本文件只剩这件事）：
 *
 * - `splitGloss`：材料正文 →「正文 + 尾部词表区」拆分（`@@G` 行从正文里
 *   摘掉、连续空行折叠）；
 * - `dataGlossTableHtml`：词条 → 词表区 DOM（`ul.wengu-gloss`）；
 * - `glossTableHtml`：同类入口的**原文**形态（先拆再渲染）。
 *
 * **正文词形联动（wrap）整体迁入统一装饰出口** `quiz/service/MaterialDecorate`
 * （Issue #52 二期就地迁入施工代码、三期删净旧路径）：词形联动不再是独立的
 * 后处理 owner，而是装饰编排里的第 ③ 步——这是权威坐标系的必然要求（施工
 * 必须发生在权威节点表收集之后、线索 mark 之前），也让「词表 → 线索」的
 * 挂载顺序从**调用侧约定**变成**实现保证**。
 *
 * ⚠️ 本文件**零装饰层依赖**（只 import convert 域的纯解析 + ui 的转义）：
 * 词表区是基础渲染产物的一部分，装饰层反过来 import 它——依赖单向，
 * 别在这里 import MaterialDecorate（会成环）。
 */

/** 材料正文 →「正文 + 尾部词表区」拆分（**契约转出**：业务侧不再直接
 *  import convert 域的词表解析）。 */
export function splitGloss(bodyMd: string | undefined): GlossSplit {
    return splitGlossBlock(bodyMd);
}

/**
 * 词表区渲染（**DOM 契约**）：`@@G` 行的规范 DOM 是 `ul.wengu-gloss`，
 * 词条行 `li.wengu-gloss-item` 内含词形/音标/释义三段。
 *
 * `ul.wengu-gloss` 是装饰层**非权威区**名单的成员（词表行不是原文正文）
 * 与**落格守卫**名单的成员（不许被包 mark）——类名改动必须同步装饰层，
 * 见 `MaterialDecorate.NON_CANON_SELECTOR` / `NO_WRAP_SELECTOR`。
 */
export function dataGlossTableHtml(entries: GlossEntry[]): string {
    if (entries.length === 0) return "";
    const items = entries
        .map((e) => {
            const word = `<span class="wengu-gloss-word">${esc(e.word)}</span>`;
            const ph = e.phonetic ? `<span class="wengu-gloss-ph">${esc(e.phonetic)}</span>` : "";
            const mn = e.meaning ? `<span class="wengu-gloss-mn">${esc(e.meaning)}</span>` : "";
            return `<li class="wengu-gloss-item">${word}${ph}${mn}</li>`;
        })
        .join("");
    return `<ul class="wengu-gloss" data-gloss>${items}</ul>`;
}

/** 材料正文 → 词表区 HTML（同契约的**原文**入口：先拆正文/词表再渲染）。 */
export function glossTableHtml(materialMd: string | undefined): string {
    return dataGlossTableHtml(splitGlossBlock(materialMd).entries);
}
