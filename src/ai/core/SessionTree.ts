import type { AiSessionRecord } from "../data/AiSessions";
import { AI_STOPPED } from "../data/AiSessions";
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
    /** 聚合状态：有 running 记 running，否则有 error 记 error，全 done 才 done。
     *  ⚠️ 这是**状态词**（running/done/error），不是色类名——组行**不渲染色点**
     *  （设计稿 tg1/tg2 只有「caret + 名字」，色点与徽标只属于叶子行），故
     *  组件不上 `is-{status}` 这种拼法（状态词与色名族不同名，拼出来是死规则）。 */
    status: AiSessionRecord["status"];
    /** 分支时间戳=最新成员的 createdAt。 */
    createdAt: number;
}

/** 树化结果：TreeList 节点 + 三个行渲染查找表（同知识面板 idiom）。 */
export interface SessionTreeData {
    nodes: TreeListNode[];
    /** 叶子 key（=记录 id）→ 记录。 */
    recByKey: Map<string, AiSessionRecord>;
    /** 分支 key → 分支视图（种类级与主题级都在）。 */
    branchByKey: Map<string, SessionBranchView>;
    /** 叶子 key → 行视图（状态点/徽标/行名；Issue #88 设计稿还原）。 */
    leafViewByKey: Map<string, SessionLeafView>;
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
    kindLabel: (k: string) => string = (k) => k,
    t: (k: string) => string = (k) => k
): SessionTreeData {
    const recByKey = new Map<string, AiSessionRecord>();
    const branchByKey = new Map<string, SessionBranchView>();
    const leafViewByKey = new Map<string, SessionLeafView>();
    const leaf = (r: AiSessionRecord, subject?: string): TreeListNode => {
        recByKey.set(r.id, r);
        const name = leafName(r, subject);
        leafViewByKey.set(r.id, leafViewOf(r, name, t));
        // hideAction：删除钮走行尾 hover 才显（同旧平铺行口径）
        return { key: r.id, id: r.id, name, kind: "doc", hideAction: true, children: [] };
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
    return { nodes, recByKey, branchByKey, leafViewByKey };
}

/**
 * 叶子行的**视图形态**（Issue #88，纯函数带单测）：树行 = 状态点 + 任务名
 * + 状态徽标（设计稿 `ai-panel-*` 的 `.leaf`）。
 *
 * 为什么单拎出来：设计稿要求「40 条记录一眼看出哪批失败哪批成功」，而
 * 旧行只有类别章 + 标题 + 时间——状态只藏在图标色里。这里把「点色 / 徽标
 * 词 / 徽标色 / 行名」一次算清，组件只按字段渲染（组件零判断）。
 */
export interface SessionLeafView {
    /** 状态点色类（`is-run` / `is-done` / `is-fail` / `is-stop`）。 */
    dotCls: string;
    /** 状态徽标色类（同上一组）。 */
    badgeCls: string;
    /** 状态词（已取词：进行中 / 已完成 / 失败 / 已停止）。 */
    badgeText: string;
    /** 徽标是否带转圈（只有 running）。 */
    spin: boolean;
    /** 行名（任务名；空则回落记录 title）。 */
    name: string;
}

/** 展示态（**比 record.status 多一档**）：记录只有 running/done/error 三态，
 *  而「用户中止」在存档里与真失败同为 error（见 AI_STOPPED），展示上却是
 *  设计稿 `ai-panel-stopped` 的琥珀色 stopped——故先折算成展示态再取色/取词。 */
type LeafState = "run" | "done" | "fail" | "stop";

/** 记录 → 展示态：error 且哨兵是 AI_STOPPED 即「停止」（不被中止/报错混同）。 */
export function leafStateOf(r: AiSessionRecord): LeafState {
    if (r.status === "running") return "run";
    if (r.status === "done") return "done";
    return r.error === AI_STOPPED ? "stop" : "fail";
}

/** 展示态 → 色类与词键（设计稿的 dot 与 badge 一族共用同一组色名）。 */
const STATUS_VIEW: Record<LeafState, { cls: string; key: string; spin: boolean }> = {
    run: { cls: "run", key: "aiStatusRunning", spin: true },
    done: { cls: "done", key: "aiStatusDone", spin: false },
    fail: { cls: "fail", key: "aiStatusError", spin: false },
    stop: { cls: "stop", key: "aiStatusStopped", spin: false },
};

/** 叶子行视图（见 {@link SessionLeafView}）；subject 在位时行名已剥尾随主题。
 *  排队等槽（Issue #76）是**瞬时展示态**，不在树行里另发一个后缀（设计稿的
 *  叶子行只有「点 + 任务名 + 徽标」三件）——它在详情正文的进行态行里出
 *  （`SessionDetail.pending`），细粒度信息归右栏。 */
export function leafViewOf(r: AiSessionRecord, name: string, t: (k: string) => string): SessionLeafView {
    const v = STATUS_VIEW[leafStateOf(r)];
    return {
        dotCls: v.cls,
        badgeCls: v.cls,
        badgeText: t(v.key),
        spin: v.spin,
        name: name || r.title,
    };
}

/** 二级组行行名（设计稿 tg2=「类别 · 文档名」组合行；主题在位即组合，
 *  缺省回落类别名——单条种类上提的叶子也走这条，名字里带上文档信息）。 */
export function groupRowName(kind: string, subject: string | undefined, kindLabel: (k: string) => string): string {
    const k = kindLabel(kind);
    return subject ? `${k} · ${subject}` : k;
}
