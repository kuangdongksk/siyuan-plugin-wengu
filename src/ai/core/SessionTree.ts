import type { AiSessionRecord } from "../data/AiSessions";
import type { TreeListNode } from "../../ui/TreeListTypes";

/**
 * 会话清单的树化（20260903 改版：种类优先树）：顶层按动作种类一类
 * 一棵树（转换/检测/判题…），种类内按「主题」（组标题/标题第一个
 * 「 · 」后的部分——转换是文档名：高等数学、线代；判题是题干预览）
 * 分第二级，调用行挂最底层。主题层与种类层都只在 ≥2 条时才设节点
 * （单条上提一级，不留空壳）；跨次运行同主题合并——用户视角是
 * 「转换过哪些文档」而非「第几次转换」。类别过滤=记录透镜（非空时
 * 只留该类记录，层级照常收敛，滤空的分支自然消失）。纯函数无副作用
 * （SessionPanelApp 的 $derived 调用），行渲染走 ui/TreeList。
 */

/** 分支视图：main/trailing 片段按 key 查聚合信息用。 */
export interface SessionBranchView {
    /** 节点键：种类=`k:{kind}`，主题=`k:{kind}/{subject}`（键只作整串
     *  比对不解析，主题含「/」无歧义）。 */
    key: string;
    kind: string;
    /** 主题（文档名等；种类级 undefined）。 */
    subject?: string;
    /** 分支下全部记录（头新尾旧；已过类别过滤）。 */
    recs: AiSessionRecord[];
    /** 聚合状态：有 running 记 running，否则有 error 记 error，全 done 才 done。 */
    status: AiSessionRecord["status"];
    /** 分支时间戳=最新成员的 createdAt。 */
    createdAt: number;
}

/** 树化结果：TreeList 节点 + 两个行渲染查找表（同知识面板 idiom）。 */
export interface SessionTreeData {
    nodes: TreeListNode[];
    /** 叶子 key（=记录 id）→ 记录。 */
    recByKey: Map<string, AiSessionRecord>;
    /** 分支 key → 分支视图（种类级与主题级都在）。 */
    branchByKey: Map<string, SessionBranchView>;
}

/** 状态聚合优先级：在途 > 失败 > 完成（分支里还有在途调用就转圈）。 */
function aggStatus(recs: AiSessionRecord[]): AiSessionRecord["status"] {
    if (recs.some((r) => r.status === "running")) return "running";
    if (recs.some((r) => r.status === "error")) return "error";
    return "done";
}

/** 主题提取：组标题（回落标题）第一个「 · 」后的部分——「转换 ·
 *  高等数学」→ 高等数学、「前段检测 · 13/21」→ 13/21（判题等单发
 *  记录组标题缺位时回落标题同法）；无分隔符或截取为空 → undefined
 *  =不设主题层。 */
export function subjectOf(r: AiSessionRecord): string | undefined {
    const s = (r.groupTitle ?? r.title ?? "").trim();
    const i = s.indexOf(" · ");
    if (i < 0) return undefined;
    const out = s.slice(i + 3).trim();
    return out || undefined;
}

/** 叶子显示名：主题分支下的调用行剥尾随「 · 主题」（「转换 · 高等
 *  数学」挂高等数学节点下只显「转换」）；其余原样。 */
function leafName(r: AiSessionRecord, subject: string | undefined): string {
    const t = r.title || "";
    if (subject && t.endsWith(` · ${subject}`)) return t.slice(0, t.length - subject.length - 3);
    return t;
}

/** 登记簿快照 → 树节点（recs 需按 createdAt 降序——store.list() 的
 *  输出序，桶序/桶内序都沿用）。kindLabel：种类显示名（i18n 由宿主
 *  注入，缺省原样显示 kind 键）。 */
export function buildSessionTree(
    recs: AiSessionRecord[],
    filter: string,
    kindLabel: (k: string) => string = (k) => k
): SessionTreeData {
    const recByKey = new Map<string, AiSessionRecord>();
    const branchByKey = new Map<string, SessionBranchView>();
    const leaf = (r: AiSessionRecord, subject?: string): TreeListNode => {
        recByKey.set(r.id, r);
        // hideAction：删除钮走行尾 hover 才显（同旧平铺行口径）
        return { key: r.id, id: r.id, name: leafName(r, subject), kind: "doc", hideAction: true, children: [] };
    };
    const branch = (view: SessionBranchView, children: TreeListNode[]): TreeListNode => {
        branchByKey.set(view.key, view);
        return {
            key: view.key,
            name: view.subject ?? kindLabel(view.kind),
            kind: "branch",
            hideAction: true,
            children,
        };
    };

    const vis = filter ? recs.filter((r) => r.kind === filter) : recs;

    // 种类分桶（vis 头新尾旧 → 桶与桶内都 newest-first）
    const kindOrder: string[] = [];
    const byKind = new Map<string, AiSessionRecord[]>();
    for (const r of vis) {
        let bucket = byKind.get(r.kind);
        if (!bucket) {
            bucket = [];
            byKind.set(r.kind, bucket);
            kindOrder.push(r.kind);
        }
        bucket.push(r);
    }

    const nodes: TreeListNode[] = [];
    for (const kind of kindOrder) {
        const krecs = byKind.get(kind)!;
        const kkey = `k:${kind}`;
        if (krecs.length === 1) {
            nodes.push(leaf(krecs[0])); // 单条种类不设层（判题等单发动作用）
            continue;
        }
        // 主题分桶（≥2 才设层，单条上提到种类下）；无主题的散行垫底
        const subjOrder: string[] = [];
        const bySubject = new Map<string, AiSessionRecord[]>();
        const loose: AiSessionRecord[] = [];
        for (const r of krecs) {
            const s = subjectOf(r);
            if (!s) {
                loose.push(r);
                continue;
            }
            let bucket = bySubject.get(s);
            if (!bucket) {
                bucket = [];
                bySubject.set(s, bucket);
                subjOrder.push(s);
            }
            bucket.push(r);
        }
        const children: TreeListNode[] = [];
        for (const s of subjOrder) {
            const srecs = bySubject.get(s)!;
            const skey = `${kkey}/${s}`;
            children.push(
                srecs.length === 1
                    ? leaf(srecs[0]) // 单条主题上提：保留全名（剥了就丢了文档信息）
                    : branch(
                          {
                              key: skey,
                              kind,
                              subject: s,
                              recs: srecs,
                              status: aggStatus(srecs),
                              createdAt: srecs[0].createdAt,
                          },
                          srecs.map((r) => leaf(r, s))
                      )
            );
        }
        for (const r of loose) children.push(leaf(r));
        nodes.push(
            branch({ key: kkey, kind, recs: krecs, status: aggStatus(krecs), createdAt: krecs[0].createdAt }, children)
        );
    }
    return { nodes, recByKey, branchByKey };
}
