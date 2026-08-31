import { agentChatOnce } from "../../ai/client";
import { AI_TIMEOUT } from "../../ai/timeouts";
import { KernelDoc } from "../../siyuan/doc";
import { KernelQuery } from "../../siyuan/query";

/**
 * 知识树大纲归纳（docs/knowledge-tree.md □1，20260831）：结构单薄的
 * 章节文档 → AI 归纳成 h1~h3 知识点大纲（h1=知识大类、h2=方法·解法、
 * h3=细分）→ 落盘独立树文档 `{章节标题}·知识树`（与原文同目录，原文
 * 一字不动；同名已存在先入回收站=覆盖式重建）。产物由调用方登记进
 * knowRoots，面板即按 h1~h6 层级树展示；登记根词表（lexiconOfRoots）
 * 随之包含树节点标题，打标链路（导入即关联/生成标签/匹配路由）直接
 * 受益。AI 通道走 agentChatOnce 独立会话（可指定模型/可中止）。
 */

/** 章节正文输入的字符预算：预算内全量喂；超限按标题段压缩（保结构
 *  不保全文——归纳大纲靠标题+浏览，长文全量直喂不稳也不省）。 */
const CHAPTER_BUDGET = 24000;
/** 压缩时段数上限（超长讲义截断，尾部注明）。 */
const MAX_SECTIONS = 80;
/** 压缩时段配额上下限（每标题段保留的字数）。 */
const SEG_MIN = 200;
const SEG_MAX = 1200;

/** 归纳 prompt（纯函数导出供单测）。层级约定与 buildSectionTree 的
 *  就近挂靠语义对齐；禁空标题；方法层要求穷尽。 */
export function buildOutlinePrompt(content: string): string {
    return `你是知识点大纲整理器。把下面的章节内容归纳成一棵知识点大纲树，输出 markdown，只含标题与极简说明。
层级约定（严格）：
# 知识大类（如：求极限 / 微分方程 / 级数）
## 具体方法或解法（如：洛必达法则 / 等价无穷小代换 / 夹逼准则；一阶线性 / 伯努利方程 / 傅里叶级数展开）
### 更细分（适用条件 / 典型陷阱 / 步骤要点；确无细分则省略整级）
规则：
1. 最高从 # 开始；不要输出章节名本身当标题；层级最深 ###。
2. 每个标题必须实义，禁止「其他」「概述」「总结」这类空标题。
3. 方法层要穷尽内容中实际讲到的方法与解法，不要只挑两三个。
4. 每个叶标题下至多一行 30 字内的补充说明（可整篇省略）。
5. 只输出 markdown 标题树，格式之外不要输出任何文字。

章节内容：
${content}`;
}

/** AI 回复 → 大纲 markdown（剥代码围栏、开场白话与空行分隔的收尾白话
 *  段；标题下紧跟的说明行保留。无有效标题行抛错。纯函数导出供单测）。 */
export function extractOutlineMd(reply: string): string {
    let s = reply.trim();
    // 围栏可能前后带白话（非整串锚定）：取第一个围栏对的内容
    const fence = /```[a-zA-Z]*[ \t]*\n([\s\S]*?)\n?```/.exec(s);
    if (fence) s = fence[1].trim();
    const lines = s.split(/\r?\n/);
    const first = lines.findIndex((l) => /^#{1,3}\s+\S/.test(l));
    if (first < 0) throw new Error("outline reply has no headings");
    // 剥尾部白话：按空行分段，末段不含标题行则整段剥（重复到末段含标题）
    const paras = lines
        .slice(first)
        .join("\n")
        .split(/\n\s*\n/);
    while (paras.length > 1 && !/^#{1,3}\s+\S/m.test(paras[paras.length - 1])) paras.pop();
    return paras.join("\n\n").trim();
}

/** 块行 → 大纲输入文本（纯函数供单测）：标题块带 # 级别前缀、正文块
 *  原样；预算内全量 join，超限按标题段压缩——每段保前 quota 字符
 *  （quota=budget/段数，clamp 到 [SEG_MIN, SEG_MAX]），段数超上限截断
 *  并尾部注明。整篇无标题时按总长截断。 */
export function chapterTextOf(
    rows: { type: string; subtype?: string; content: string }[],
    budget = CHAPTER_BUDGET
): string {
    const lines = rows
        .map((r): string => {
            const c = (r.content ?? "").trim();
            if (!c) return "";
            if (r.type === "h") {
                const lv = Math.min(6, Math.max(1, Number(r.subtype?.replace("h", "")) || 1));
                return `${"#".repeat(lv)} ${c}`;
            }
            return c;
        })
        .filter(Boolean);
    if (lines.join("\n").length <= budget) return lines.join("\n\n");
    // 超预算：以标题行为界切段；段数受预算×配额下限与上限双重约束
    // （SEG_MIN×段数会撑爆预算时先截段数，总量始终 ≤ ~budget）
    const segs: string[][] = [];
    for (const ln of lines) {
        if (ln.startsWith("#") || segs.length === 0) segs.push([]);
        segs[segs.length - 1].push(ln);
    }
    const maxSegs = Math.min(MAX_SECTIONS, Math.max(1, Math.floor(budget / SEG_MIN)));
    const truncated = segs.length > maxSegs;
    const use = truncated ? segs.slice(0, maxSegs) : segs;
    const quota = Math.min(SEG_MAX, Math.max(SEG_MIN, Math.floor(budget / use.length)));
    const out = use.map((seg) => {
        const text = seg.join("\n\n");
        return text.length > quota ? `${text.slice(0, quota)}…` : text;
    });
    if (truncated) out.push(`（原文过长：共 ${segs.length} 段，以上仅取前 ${use.length} 段）`);
    return out.join("\n\n");
}

/** rowsMap 行别名。 */
type Row = Map<string, string>;

/** 拉文档的标题+正文块（sort 保序；rowsMapAll 自动分页）。 */
async function docBlocks(docId: string): Promise<Row[]> {
    return KernelQuery.rowsMapAll(
        `SELECT type, subtype, content FROM blocks WHERE root_id = '${docId}' AND type IN ('h','p','l','b','c','t','i','s','m','html','embed') ORDER BY sort`
    );
}

/** 树文档标题后缀（面板展示与词表对齐用约定名）。 */
export const OUTLINE_SUFFIX = "·知识树";

/**
 * 归纳并落盘知识树文档。返回新文档 id 与标题（调用方登记 knowRoots）。
 * 任何一步失败抛错（调用方提示）；转换写窗口由调用方闸（convertRunActive）。
 */
export async function generateKnowledgeOutline(
    docId: string,
    modelId: string,
    signal: AbortSignal
): Promise<{ docId: string; title: string }> {
    const root = (
        await KernelQuery.rowsMap(`SELECT box, hpath, content FROM blocks WHERE id = '${docId}' AND type = 'd' LIMIT 1`)
    )[0];
    if (!root?.get("box")) throw new Error("source doc not found");
    const hpath = root.get("hpath") || "";
    const title = root.get("content") || hpath.split("/").filter(Boolean).pop() || docId;
    const content = chapterTextOf(
        (await docBlocks(docId)).map((r) => ({
            type: r.get("type") ?? "p",
            subtype: r.get("subtype") ?? undefined,
            content: r.get("content") ?? "",
        }))
    );
    if (!content.trim()) throw new Error("doc has no content");
    const reply = await agentChatOnce(buildOutlinePrompt(content), modelId, AI_TIMEOUT.long, signal, {
        kind: "outline",
        title: `建知识树 · ${title}`,
    });
    const md = extractOutlineMd(reply);
    // 落盘路径=原文 hPath + 后缀（同目录；createDocWithMd 按 hPath 定位）
    const treeTitle = `${title}${OUTLINE_SUFFIX}`;
    const treePath = `${hpath}${OUTLINE_SUFFIX}`;
    // 覆盖式重建：同名旧树文档先入回收站（可恢复）
    const old = (
        await KernelQuery.rowsMap(
            `SELECT id FROM blocks WHERE type = 'd' AND box = '${root.get("box")}' AND hpath = '${treePath.replace(/'/g, "''")}' LIMIT 1`
        )
    )[0];
    if (old?.get("id")) await KernelDoc.remove(old.get("id"));
    const res = await KernelDoc.createByMd(root.get("box"), treePath, md);
    if (res.code !== 0 || !res.data) throw new Error(res.msg || "createDocWithMd failed");
    return { docId: String(res.data), title: treeTitle };
}
