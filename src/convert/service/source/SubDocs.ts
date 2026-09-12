import { KernelQuery } from "../../../siyuan/query";

/**
 * 批量转换的源文档发现（Issue #37）：文件夹式文档（思源文档当目录用，
 * 自身空、子文档有货）场景下，转换弹窗选中它时要把**子树文档**列出来
 * 一次串行转完。
 *
 * 口径与 KnowIndex.captureRoot 的后代查询同源（同笔记本 `path LIKE`
 * 递归），但**只取文档 id/标题，不碰标题块**——批量转换只关心「转哪几
 * 篇」，预览清单与队列标题都够用，零多余 SQL。
 *
 * 三处硬约束：
 *  - **SQL 无 LIMIT 静默截 64 行**（AGENTS.md 内核坑）：后代走
 *    `rowsAll` 分页，不能裸 rows 一把梭；
 *  - **顺序**：源的「文件树顺序」不是 `ORDER BY sort`（导入语料上
 *    sort/created 全退化，返回任意序）——这里按 **hpath 字典序**排，
 *    与文件树展示序一致且确定性（队列执行顺序可预期、可复现）；
 *  - **判空口径**（Issue #42）：只有正文非空的块才算货（详见 isEmptyDoc），
 *    且**空壳中间层不入队列**（详见 middleLayerIds）。
 */

/** 一份待转换的源文档（批量队列的元素）。 */
export interface SubDocRef {
    id: string;
    title: string;
    /** 标题路径（列表展示与去重用；查不到时为空）。 */
    hPath?: string;
}

/** 子文档清单（含根自身）。rootEmpty=根自身无内容（文件夹式文档）。 */
export interface SubDocPlan {
    /** 根文档自身。 */
    root: SubDocRef;
    /** 后代文档（不含根），按 hPath 字典序。 */
    children: SubDocRef[];
    /** 根自身是否为空文档（无标题内容——文件夹式文档的判据）。 */
    rootEmpty: boolean;
}

const DOC_ID_RE = /^\d{14}-[a-z0-9]+$/i;

/** SQL 行（KernelQuery 工厂的 rowsMap 行别名）。 */
type DocRow = Map<string, string>;

/** 取文档行（id/box/path/content/hpath）。查不到/非文档返回 null。 */
async function docRow(docId: string): Promise<DocRow | null> {
    try {
        const rows = await KernelQuery.rowsMap(
            `SELECT id, box, path, content, hpath FROM blocks WHERE id = '${docId}' AND type = 'd' LIMIT 1`
        );
        const row = rows[0];
        if (row?.get("id")) return row;
    } catch (_) {
        // SQL 失败=查无此文档，调用方按「无从发现子文档」降级
    }
    return null;
}

/** 待判空的文档 id 列表 → 「有无正文」的 SQL 片段（Map 的 key 保住原始
 *  id 形态）。IN 列表 + CROSS JOIN 取值表：一次查询判定整批候选。
 *  候选为空返回 ""（调用方直接跳过查询）。
 *  ⚠️ 行里的 `d` 是 CROSS JOIN 的取值表别名，不是文档列——Select 里显式
 *  起 `AS docId`，避免与 `blocks` 的同名列（无）混淆。 */
function probeSql(ids: string[]): string {
    const uniq = Array.from(new Set(ids.filter((id) => !!id)));
    if (uniq.length === 0) return "";
    const values = uniq.map((id) => `SELECT '${id}' AS d`).join(" UNION ALL ");
    return `SELECT p.d AS docId FROM (${values}) p
            JOIN blocks b ON b.root_id = p.d
            WHERE b.type != 'd' AND ${HAS_TEXT_SQL} LIMIT 1`;
}

/** 判空口径（Issue #42 真机踩坑）：**只有正文去空白后非空的块才算货**。
 *
 *  MinerU 等导入器产出的壳文档**全部带一个空段落块**（`content=''` 的 `p`），
 *  旧判据「`root_id` 下有无任何非 doc 块」在真机上恒为「非空」→ 空壳判据永
 *  不成立 → `buildBatchQueue` 的自动展开条件 `rootEmpty && children>0` 落空，
 *  文件夹式文档永远走单篇流程报「文档内容为空」（Issue #37 的批量转换对嵌套
 *  树全军覆没的根因）。
 *
 *  ⚠️ SQLite `TRIM(x)` **只去空格**，换行/制表符要显式处理——先用
 *  REPLACE 把 `\n` `\t` `\r` 换成空格再 TRIM，否则「只含换行的段落」会被
 *  误判成有正文。
 *
 *  从「有无块」放宽到「有无正文」是**保守方向**（更少文档被判空 → 更少自动
 *  展开），故两个消费点（判空、中间层剔除）包一层 try：单点查询失败一律按
 *  「非空」处置，不阻断流程、不乱提示。 */
const HAS_TEXT_SQL = "TRIM(REPLACE(REPLACE(REPLACE(b.content, char(10), ' '), char(13), ' '), char(9), ' ')) != ''";

/** 单点判空：文档是否「无正文内容」（空段落不算货）。查询失败按非空。 */
async function isEmptyDoc(docId: string): Promise<boolean> {
    const sql = probeSql([docId]);
    if (!sql) return true;
    try {
        const rows = await KernelQuery.rowsMap(sql);
        return rows.length === 0;
    } catch (_) {
        return false; // 查询失败按非空（不乱提示「将转换子文档」）
    }
}

/** 批量判空（中间层剔除用）：只对前缀命中的候选发起，查到的即为「空壳」。 */
async function emptyOf(ids: string[]): Promise<Set<string>> {
    const sql = probeSql(ids);
    if (!sql) return new Set();
    try {
        const rows = await KernelQuery.rowsMap(sql);
        return new Set(rows.map((r) => r.get("docId")).filter((id) => !!id));
    } catch (_) {
        return new Set(); // 失败按「都不空」（保守：不剔除任何中间层）
    }
}

/**
 * 探查一份源文档的子文档清单（批量转换入口调用）。
 * 根查不到 → undefined（调用方按普通单篇流程报「找不到文档」）。
 * 无子文档 → children 为空、rootEmpty 照实报（弹窗据此决定是否露提示）。
 * `includeRoot=false`（「连同子文档」勾选态）不改变本返回值——调用方
 * 自己决定队列是否带上根。
 */
export async function planSubDocs(docIdRaw: string): Promise<SubDocPlan | undefined> {
    const docId = (docIdRaw ?? "").trim();
    if (!DOC_ID_RE.test(docId)) return undefined;
    const root = await docRow(docId);
    if (!root?.get("box")) return undefined;
    const box = root.get("box");
    const dir = root.get("path").replace(/\.sy$/, "");
    let childRows: DocRow[];
    try {
        // 全量分页（无 LIMIT 会静默截 64 行）；hpath 字典序=文件树序
        childRows = await KernelQuery.rowsMapAll(
            `SELECT id, content, hpath FROM blocks
             WHERE type = 'd' AND box = '${box}' AND path LIKE '${dir}/%.sy'`
        );
    } catch (_) {
        childRows = []; // 后代查询失败降级为「无子文档」，不阻断单篇转换
    }
    const children: SubDocRef[] = childRows
        .map((r) => ({
            id: r.get("id"),
            title: r.get("content") || r.get("hpath") || r.get("id"),
            hPath: r.get("hpath") || undefined,
        }))
        .filter((c) => !!c.id)
        .sort((a, b) => (a.hPath ?? a.title).localeCompare(b.hPath ?? b.title));
    const rootRef: SubDocRef = {
        id: docId,
        title: root.get("content") || root.get("hpath") || docId,
        hPath: root.get("hpath") || undefined,
    };
    // 中间层（本身是目录、下头还有别的队列成员）先按标题路径确定性选出，
    // 再只对这一小撮候选问一次 SQL：**空壳才剔除**，有真实内容的照常入队。
    const middle = middleLayerIds([rootRef, ...children]);
    const emptyMiddle = await emptyOf(middle);
    return {
        root: rootRef,
        children: children.filter((c) => !emptyMiddle.has(c.id)),
        rootEmpty: children.length > 0 ? await isEmptyDoc(docId) : false,
    };
}

/** 去首尾斜杠（目录前缀与包含判定的公共归一）。 */
function trimSlashes(s: string): string {
    let out = s;
    while (out.startsWith("/")) out = out.slice(1);
    while (out.endsWith("/")) out = out.slice(0, -1);
    return out;
}

/**
 * 中间层候选（纯函数，带单测）：**hPath 是其他成员 hPath 的目录前缀**
 * （`<被打平后的候选 hPath>/` 开头）的那些文档——扁平列表里它们是目录，
 * 不是叶子源。返回**去重**后的 id 列表（判定只做一次）。
 *
 * 单调性：hPath 去尾斜杠后若比最长候选还长，绝不可能是别人的前缀 → 跳过。
 * 只回候选，**剔不剔除由调用方按「是否空壳」定**（有真实内容的中间层
 * 照常入队——比如「上篇」下既有正文也有子文档）。
 */
export function middleLayerIds(refs: SubDocRef[]): string[] {
    const items = refs
        .map((r) => ({
            id: r.id,
            key: trimSlashes(r.hPath ?? ""),
        }))
        .filter((it) => !!it.id);
    let longest = 0;
    for (const it of items) longest = Math.max(longest, it.key.length);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const it of items) {
        if (!it.key || it.key.length >= longest) continue;
        const prefix = it.key + "/";
        if (!items.some((o) => o !== it && o.key.startsWith(prefix))) continue;
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        out.push(it.id);
    }
    return out;
}

/**
 * 组装批量队列（纯函数，带单测）。三条口径：
 *  - 勾选「连同子文档」→ 根 + 全部后代（根在前）；
 *  - 未勾选且根非空 → 只跑根自身（普通单篇转换的默认行为）；
 *  - 未勾选且根是**空壳**（文件夹式文档）→ 只跑后代（对空根白跑一趟
 *    只会报「文档内容为空」，展开到子文档才是用户点它的本意）。
 * 空壳根**永不入队**：它的转换注定零产物，塞进去只多一行「失败」噪音。
 * 队列为空=调用方回落单篇流程（把报错交给它）。
 */
export function buildBatchQueue(plan: SubDocPlan, includeRoot: boolean): SubDocRef[] {
    const expand = includeRoot || (plan.rootEmpty && plan.children.length > 0);
    if (!expand) return plan.rootEmpty ? [] : [plan.root];
    const queue: SubDocRef[] = plan.rootEmpty ? [] : [plan.root];
    queue.push(...plan.children);
    return queue;
}

/**
 * 队列是否值得起（纯函数，带单测）：队列与「单篇流程 = 就转源自身」
 * 等价时退化回单篇（长度 0 或 1 且那唯一一篇就是源本身）。
 *
 * ⚠️ **空壳文件夹只有 1 个子文档时也必须走队列**（队列唯一元素 ≠ 源
 * 自身）：源是空壳，转它只会报「文档内容为空」白跑一趟，而用户点这个
 * 文件夹的本意就是转子文档——退化成单篇等于白干。
 */
export function isBatchQueue(queue: SubDocRef[], srcDocId: string): boolean {
    if (queue.length > 1) return true;
    return queue.length === 1 && queue[0].id !== srcDocId;
}
