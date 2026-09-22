import { mintPrefixedId, normalizeType } from "../../types";
import type { QuestionType } from "../../types";
import { KernelQuery } from "../../siyuan/query";
import { parseQuestionKramdown } from "./BankParse";
import type { ParsedQuestion } from "./BankParse";
import type { BankData, QuestionBank, BankSet } from "./QuestionBank";
import type { WenguDoc, WenguMaterial } from "../../types";

/**
 * 题集段（20260903 起转换不再落文档，题集是题库内一等实体）——
 * 函数式友元模式（同 BankRegen/BankMigrate）：接 bank 实例，读写走
 * all()/markDirty()。
 *
 * - **存量零迁移**：records 的 sourceDocId 就是题集 id（旧习题文档 id），
 *   ensureSets 按它分组补齐 sets 条目（标题尽力从仍在的旧文档读一次，
 *   读不到显示短 id）；历史轮次/docStats/影子专题的键因此全部天然延续。
 * - 新转换的题集由 convert/service/output/SetWriter 直写（含有序 qids 与材料）。
 */

/** 题集 id（set- 前缀，风格同 col-/gen-）。 */
export function mintSetId(): string {
    return mintPrefixedId("set-", 4);
}

/** 转换新题的 qid（gen- 前缀，与 addGenerated 同款生成器——bank-only
 *  题没有源块，思源块 id 语义不存在）。 */
export function mintQid(): string {
    return mintPrefixedId("gen-", 6);
}

/** 材料块 id（mat- 前缀；bank.materials 的键，题记录 group 指向它）。 */
export function mintMatId(): string {
    return mintPrefixedId("mat-", 4);
}

/** 短 id 兜底显示（标题读不到的存量题集）。 */
export function setFallbackTitle(id: string): string {
    return `习题集 ${id.slice(-6)}`;
}

/** 聚合视图 id（虚拟专题「全部习题」：所有题集按序合刷）。不落
 *  collections——仅流程层（CollectionFlow/侧栏树）认它，专题管理/清单
 *  天然看不见，删改无门。 */
export const AGGREGATE_ID = "all";

/** 聚合视图的题集顺序：sets 插入序（新转换=完成序，存量推导=记录
 *  落库序）——卷册/章节的先后就是转换先后，跨重载稳定可复现，
 *  **任何聚合都不重排**（题集先后 × 集内 qids 序，两层都不动）。 */
export async function orderedSetIds(bank: QuestionBank): Promise<string[]> {
    return Object.keys((await bank.all()).sets ?? {});
}

/** 题型并集的**唯一计算体**（异步版与同步窥视版同源，口径不许分叉）：
 *  题集题单序 + normalizeType 过滤 + 去重。 */
function typeUnionOf(data: BankData | undefined, setId: string): QuestionType[] {
    if (!data || !setId) return [];
    const out: QuestionType[] = [];
    for (const qid of data.sets?.[setId]?.qids ?? []) {
        const t = normalizeType(data.records[qid]?.type);
        if (t && !out.includes(t)) out.push(t);
    }
    return out;
}

/** 题集既有记录的题型并集（20260910 生成 prompt 题型化）：增量补生成/
 *  续跑跳过前置检测时，用题集先验代替 AI 检测（零 AI 调用）；空集=
 *  无先验，调用方回退全题型。 */
export async function setTypeUnion(bank: QuestionBank, setId: string): Promise<QuestionType[]> {
    return typeUnionOf(await bank.all(), setId);
}

/** 卷级题型并集的**同步窥视版**（Issue #45 标生词的卷级英语判定用）：
 *  判定是选段回调里的高频同步路径（浮条要当场决定出不出现），不能
 *  await——只看已装载缓存（`bank.peek()`），题目未装载时返回空集=
 *  调用方按「非英语」收口（宁缺勿错），随后走 setTypeUnion 异步补正。
 *  与 setTypeUnion 共用 `typeUnionOf`，口径不分叉。 */
export function peekSetTypeUnion(bank: QuestionBank, setId: string): QuestionType[] {
    return typeUnionOf(bank.peek(), setId);
}

/* ── 题集学科（Issue #83）──
 * 题型是**作答形态**、不是**学科**：英语阅读的 single 与数学单选都是
 * single，语文的 essay/trans 也在英语四类形态里——拿「题型并集含英语四类
 * 任一」当语言代理，两个方向都会判错（纯阅读英语卷漏判、语文卷误判）。
 * 故题集补**真实学科字段**（转换首批判定行顺带报出），判定的两级口径见
 * quiz/flow/AnnoScope 的 isEnglishScope：**有学科以学科为准、无学科才回退
 * 题型并集**（存量题集零迁移、逐字节不回归）。
 *
 * ⚠️ **仅服务「标生词」**（语言专属功能）：阅读面/题卡间距阶梯是**材料组
 * 结构**判据、与学科零关系（quiz/flow/ReadingScope）。别把本字段接到任何
 * 视觉判定上——那是 #83 的根因（#81/#82 把阅读面绑在英语判别上）。 */

/** 学科字面归一：去空白/标点、全角冒号顿号等作分隔后取**首个词**——
 *  约定 AI 只报一个学科（「英语」/「数学」/「语文」…），偶发带说明
 *  （「英语（阅读理解）」）时取斜杠前的首段。空/占位（「无」「未知」「-」）
 *  一律归 undefined=**无学科**（回退题型并集，而不是落一个假学科）。
 *  ⚠️ 归一**只做去装饰**，不做别名映射/模糊匹配：学科是开放集（历史、
 *  政治、自控原理…），猜错比不猜更坏（假学科会把判别锁死）。 */
export function normalizeSubject(raw?: string | null): string | undefined {
    // 占位先判**原串**再判首段：拆词会先动斜杠（「N/A」拆完只剩 \`N\`），
    // 顺序反过来就把它当成一个真学科落库、判别被假学科锁死
    const trimmed = (raw ?? "").trim();
    if (isPlaceholderSubject(trimmed)) return undefined;
    // 分隔符：换行/逗号/顿号/分号/竖线/斜杠/各类括号——AI 偶发写
    // 「英语（阅读理解）」/「数学/高数」时取首个学科名
    const head = trimmed
        .split(/[\n\r,，、;；|/（(【[]/)[0]
        ?.replace(/[\s:：.。·—–-]+/g, "")
        .trim();
    return head && !isPlaceholderSubject(head) ? head : undefined;
}

/** 占位/空串 = 无学科（「无」「未知」「N/A」…）。 */
function isPlaceholderSubject(s: string): boolean {
    return !s || /^(无|未知|不确定|未注明|none|unknown|n\/a|-+)$/i.test(s);
}

/** 题集学科解析的唯一计算体（窥视版与直读版同源，口径不分叉）。 */
function subjectOfSet(data: BankData | undefined, setId: string): string | undefined {
    if (!data || !setId) return undefined;
    return normalizeSubject(data.sets?.[setId]?.subject);
}

/** 题集学科的**同步窥视版**（渲染/选段回调里的高频同步路径不能 await，
 *  同 peekSetTypeUnion 的理由）：只看已装载缓存，未装载返回 undefined
 *  =调用方按「无学科」收口（回退题型并集或宁窄勿宽，随消费点）。 */
export function peekSetSubject(bank: QuestionBank, setId: string): string | undefined {
    return subjectOfSet(bank.peek(), setId);
}

/** 全部题集聚合题目（聚合专题刷题列表；空题集自然无贡献）。 */
export async function allSetQuestions(bank: QuestionBank): Promise<ParsedQuestion[]> {
    const out: ParsedQuestion[] = [];
    for (const setId of await orderedSetIds(bank)) out.push(...(await setQuestions(bank, setId)));
    return out;
}

/** 全部题集的材料并集（聚合视图装载；题集顺序拼接）。 */
export async function allSetMaterials(bank: QuestionBank): Promise<WenguMaterial[]> {
    const out: WenguMaterial[] = [];
    for (const setId of await orderedSetIds(bank)) out.push(...(await setMaterials(bank, setId)));
    return out;
}

/** 本会话已试过补标题的题集 id（读不到就不重查；体检应用 set-missing
 *  补建的条目标题留空，靠这里装载时回填——20260909 闭环补齐）。 */
const titleTried = new Set<string>();

/** 推导缺 sets 条目的题集（records 按 sourceDocId 分组；后台调用，
 *  不阻塞装载）。标题从旧习题文档尽力读一次——文档已删则留空；已有
 *  条目标题为空的每会话至多重试一次（题库体检补建/旧次读不到的）。 */
export async function ensureSets(bank: QuestionBank): Promise<number> {
    const data = await bank.all();
    data.sets ??= {};
    const groups = new Map<string, string[]>();
    for (const r of Object.values(data.records)) {
        if (!r.sourceDocId) continue;
        const qids = groups.get(r.sourceDocId) ?? [];
        qids.push(r.qid);
        groups.set(r.sourceDocId, qids);
    }
    let changed = 0;
    for (const [id, qids] of groups) {
        const existing = data.sets[id];
        if (existing?.title) continue;
        if (existing && titleTried.has(id)) continue;
        titleTried.add(id);
        const set: BankSet = existing ?? { id, title: "", qids, createdAt: Date.now() };
        try {
            const row = (
                await KernelQuery.rows<{ content?: string; hpath?: string }>(
                    `SELECT content, hpath FROM blocks WHERE id = '${id}' AND type = 'd' LIMIT 1`
                )
            )[0];
            if (row?.content) set.title = row.content;
            if (row?.hpath) set.hPath = row.hpath; // 侧栏树/聚合标题行用（读不到不阻断）
        } catch (_) {
            // 标题读不到不阻断（已删文档/索引未就绪，显示短 id 兜底）
        }
        if (!existing) {
            data.sets[id] = set;
            changed++; // 新建条目（含标题读不到的空标题）
        } else if (set.title || set.hPath) {
            changed++; // 存量空标题补上了
        }
    }
    if (changed > 0) bank.markDirty();
    return changed;
}

/** 题集的题目（set.qids 序；解析走缓存、统计镜像覆盖、rootId=setId）。 */
export async function setQuestions(bank: QuestionBank, setId: string): Promise<ParsedQuestion[]> {
    const data = await bank.all();
    const set = data.sets?.[setId];
    if (!set) return [];
    const out: ParsedQuestion[] = [];
    for (const qid of set.qids) {
        const r = data.records[qid];
        if (!r) continue;
        const parsed =
            bank.parsedOf(qid, r.hash) ??
            (() => {
                const p = parseQuestionKramdown(r.kramdown, qid, setId);
                if (p) bank.cacheParsed(qid, r.hash, p);
                return p;
            })();
        if (!parsed) continue;
        parsed.rootId = setId; // 缓存命中时也可能是专题模式解析的（无 rootId），归位
        if (r.group) parsed.group = r.group; // 记录字段为组链真相（20260903 审查 P1①）
        parsed.attempts = r.stats.attempts;
        parsed.wrongCount = r.stats.wrongCount;
        parsed.right = r.stats.right;
        parsed.lastAnswer = r.stats.lastAnswer;
        out.push(parsed);
    }
    return out;
}

/** 题集的全部材料（bank.materials；组头渲染与材料组降级 HTML 用）。 */
export async function setMaterials(bank: QuestionBank, setId: string): Promise<WenguMaterial[]> {
    const data = await bank.all();
    return Object.values(data.materials ?? {})
        .filter((m) => m.setId === setId)
        .map((m) => ({ id: m.id, rootId: setId, bodyMd: m.bodyMd, transMd: m.transMd }));
}

/** 按 qid 取一题的解析视图（复习详情等单题消费点；统计镜像随行）。 */
export async function questionOf(bank: QuestionBank, qid: string): Promise<ParsedQuestion | undefined> {
    const data = await bank.all();
    const r = data.records[qid];
    if (!r) return undefined;
    const parsed =
        bank.parsedOf(qid, r.hash) ??
        (() => {
            const p = parseQuestionKramdown(r.kramdown, qid, r.sourceDocId);
            if (p) bank.cacheParsed(qid, r.hash, p);
            return p;
        })();
    if (!parsed) return undefined;
    parsed.rootId = r.sourceDocId;
    if (r.group) parsed.group = r.group; // 记录字段为组链真相（20260903 审查 P1①）
    parsed.attempts = r.stats.attempts;
    parsed.wrongCount = r.stats.wrongCount;
    parsed.right = r.stats.right;
    parsed.lastAnswer = r.stats.lastAnswer;
    return parsed;
}

/** 全部题集的聚合视图（WenguDoc[]，替换 listQuestionDocs 的 SQL 聚合）：
 *  total 按 set.qids（ensureSets 未跑的虚拟分组按记录数）、运行时数字
 *  按记录 stats/docStats 归并——自托管口径不变。 */
export async function setDocsView(bank: QuestionBank): Promise<WenguDoc[]> {
    const data = await bank.all();
    const agg = new Map<string, { title: string; hPath: string; total: number; attempted: number; right: number }>();
    const ensure = (id: string): { title: string; hPath: string; total: number; attempted: number; right: number } => {
        let a = agg.get(id);
        if (!a) {
            a = { title: "", hPath: "", total: 0, attempted: 0, right: 0 };
            agg.set(id, a);
        }
        return a;
    };
    for (const [id, set] of Object.entries(data.sets ?? {})) {
        const a = ensure(id);
        a.title = set.title;
        a.hPath = set.hPath ?? "";
        a.total = set.qids.length;
    }
    for (const r of Object.values(data.records)) {
        if (!r.sourceDocId) continue;
        const a = ensure(r.sourceDocId);
        if (r.stats.attempts > 0) a.attempted++;
        if (r.stats.right === "1") a.right++;
        if (!data.sets?.[r.sourceDocId]) a.total++; // 虚拟分组（推导未落）按记录数
    }
    return [...agg.entries()]
        .map(([id, a]) => ({
            id,
            title: a.title || setFallbackTitle(id),
            hPath: a.hPath,
            total: a.total,
            attempted: a.attempted,
            rightCount: a.right,
            totalTime: data.docStats[id] ?? 0,
        }))
        .sort((x, y) => y.total - x.total);
}

/** 删除一批记录（增量重转换「消失/重生成」的删旧；set.qids/影子专题/
 *  专题引用/哈希索引同步清，材料正文不动——孤儿材料无消费面，无害）。 */
export async function removeRecords(bank: QuestionBank, qids: string[]): Promise<void> {
    if (qids.length === 0) return;
    const data = await bank.all();
    const dead = new Set(qids);
    for (const qid of qids) {
        const r = data.records[qid];
        if (!r) continue;
        if (data.hashed[r.hash] === qid) delete data.hashed[r.hash];
        delete data.records[qid];
        bank.invalidateParse(qid);
    }
    if (data.sets) {
        for (const set of Object.values(data.sets)) {
            if (set.qids.some((q) => dead.has(q))) set.qids = set.qids.filter((q) => !dead.has(q));
        }
    }
    data.collections = data.collections.map((c) =>
        c.qids.some((q) => dead.has(q)) ? { ...c, qids: c.qids.filter((q) => !dead.has(q)) } : c
    );
    bank.markDirty();
}

/** 记录归属的题集 id（无记录返回空；DocOps/跳转降级用）。 */
export async function setOfRecord(bank: QuestionBank, qid: string): Promise<string> {
    const data = await bank.all();
    return data.records[qid]?.sourceDocId ?? "";
}

/** 「查看原文」的跳转目标（20260910 Issue #13）：qid → records.sourceDocId
 *  （题集 id）→ sets.srcId（源讲义文档 id）。20260903 存储收口后题目
 *  bank-only，跳转目标恒为源讲义文档——与知识面板「查看原文」同口径
 *  （KnowPanelCtl.open）。
 *
 *  **唯一判据 = 有无 `set.srcId`**：返回空串即「不渲染该钮」（不出死钮）。
 *  ⚠️ 原先第二级「qid 形态像内核块 id 就跳原块」是给存量块题准备的兜底，
 *  随存量兼容口径一并删除（Issue #214）；「查库失败宁可露钮」的 fail-open
 *  防御语义同源同去。
 *
 *  **只到文档级**：srcKey 是结构键/偏移、无块锚点，不定位卷内题目位置。 */
export async function originDocIdOf(bank: QuestionBank, qid: string): Promise<string> {
    const data = await bank.all();
    const setId = data.records[qid]?.sourceDocId ?? "";
    if (!setId) return "";
    return data.sets?.[setId]?.srcId ?? "";
}
