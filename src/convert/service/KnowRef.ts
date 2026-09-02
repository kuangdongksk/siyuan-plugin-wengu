import { KernelQuery } from "../../siyuan/query";

/**
 * 知识点引用的注入与生成后处理（自 KnowledgeLink 拆出压 500 行红线，
 * 20260831）：「相关知识点：((id "标题")) …」引用行是模块内唯一真相
 * ——行协议渲染（QuestionDraft.renderUnit 把 kpRefs 并入解析块）、
 * 事后匹配/标签落库（strip+inject 的替换语义，KnowLinkText 共用）与
 * 单题重生成（RegenDialog.injectKnowledgeRefs）同走这一份格式；
 * sectionKramdown 供单题重生成喂小节正文。纯文本与 SQL，无 AI 调用。
 */

/** 引用文本消毒：去引号/换行，限长（块引用静态锚文本）。 */
function refTitle(title: string): string {
    return title
        .replace(/["<>\n\r]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 50);
}

/** 生成「相关知识点」引用行（转换渲染/事后匹配共用，反链面板可见的
 *  同格式）。带块引用前缀（> ），调用方按需剥除。 */
export function knowledgeRefLine(refs: { id: string; title: string }[]): string {
    return `> 相关知识点：${refs.map((h) => `((${h.id} "${refTitle(h.title)}"))`).join(" ")}`;
}

/** 剥掉题目 kramdown 里已有的「相关知识点」引用行（事后匹配重挂前先清旧，
 *  与 injectKnowledgeRefs 配对成「替换」语义；纯函数）。连行尾换行一起
 *  吞——只删内容留空行会让 SOLUTION_RE 失配，inject 走容器尾兜底再补
 *  一个 solution 块，原 IAL 悬空（20260828 审查：重跑匹配越跑越坏）。 */
export function stripKnowledgeRefs(kd: string): string {
    return kd.replace(/^[ \t]*>[ \t]*相关知识点：.*(?:\r?\n)?/gm, "").replace(/\n{3,}/g, "\n\n");
}

/** 把知识点引用行注入题目 kramdown 的解析块尾（无解析块补独立块）。
 *  重新生成/针对性生成用：AI 不写引用，确定性注入。 */
export function injectKnowledgeRefs(kd: string, refs: { id: string; title: string }[]): string {
    if (refs.length === 0) return kd;
    const line = knowledgeRefLine(refs);
    const sol = SOLUTION_RE.exec(kd);
    if (sol) {
        return kd.replace(SOLUTION_RE, (_m, quote: string, ial: string) => `\n${quote}\n${line}\n${ial}`);
    }
    const close = kd.lastIndexOf("}}}");
    if (close < 0) return kd;
    return kd.slice(0, close) + `${line}\n{: custom-plugin-wengu-part="solution"}\n\n` + kd.slice(close);
}

/** 取知识点小节的正文（标题块 id → 该标题下到下一个同级/更高级标题
 *  之前的块内容，SQL 按 sort 顺序拼接；供重新生成/针对性生成喂正文）。 */
export async function sectionKramdown(headingId: string, maxChars = 3000): Promise<string> {
    const head = (
        await KernelQuery.rowsMap(
            `SELECT root_id, subtype FROM blocks WHERE id = '${headingId}' AND type = 'h' LIMIT 1`
        )
    )[0];
    if (!head) return "";
    const myLevel = Number(head.get("subtype")?.replace("h", "")) || 2;
    const rows = await KernelQuery.rowsMapAll(
        `SELECT id, subtype, type, content FROM blocks WHERE root_id = '${head.get("root_id")}' AND type IN ('h','p','l','b','c','t','i','s','m','html','embed') ORDER BY sort`
    );
    let started = false;
    const out: string[] = [];
    for (const r of rows) {
        const isHead = r.get("type") === "h";
        if (started && isHead) {
            const lv = Number(r.get("subtype")?.replace("h", "")) || 1;
            if (lv <= myLevel) break; // 同级或更高级标题：小节结束
        }
        if (r.get("id") === headingId) {
            started = true;
            continue;
        }
        if (started && out.join("\n").length + r.get("content").length > maxChars) break;
        if (started) out.push(r.get("content"));
    }
    return out.join("\n\n");
}

/** 解析引述块（多行 > 引用 + 紧随的 part="solution" IAL 行）。引用与
 *  IAL 之间容忍空行——历史上被 strip 留空行污染过的记录由此重新匹配，
 *  inject 重写为紧邻形态即自愈（20260828 审查）。 */
const SOLUTION_RE =
    /\n[ \t]*(>[^\n]*(?:\n[ \t]*>[^\n]*)*)\n(?:[ \t]*\n)*[ \t]*(\{:[^\n]*custom-plugin-wengu-part="solution"[^\n]*\})/;
