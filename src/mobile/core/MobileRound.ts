import { baseQid, type WenguQuestion } from "../../types";
import { newSessionId, type WenguSession } from "../../quiz/service/HistoryStore";
import { shuffleListForDisplay } from "../../quiz/render/CardDisplayShuffle";
import { setQuestions } from "../../bank/data/BankSets";
import type { MobileDrill } from "./MobileDrill";

/**
 * 移动端**轮次生命周期**（Issue #158 起，20260917 #167 扩「恢复」；
 * 函数式友元，接 drill 实例读写 `d.ui`，同 `MobileAnswering` 口径）。
 *
 * ## 为什么单开一片
 * 空轮静默关轮（对齐桌面 `RoundReport.closeEmptyRound`）与「未完成轮恢复」
 * 的说明一写就长，而 `MobileDrill.ts` 是**无豁免、500 行红线**的编排文件。
 * 按语义把「起轮 / 恢复 / 关轮」这一域整体放在此处，`MobileDrill` 只留
 * 薄转发（`restoreResumeFor` / `start` / `resumeRound` / `retryWrong` /
 * `closeEmptyRound`）。
 *
 * ⚠️ 状态写入仍只经 `d.ui`（Svelte 5 `$state` 深代理），别在别处另存一份。
 */

/** 本轮会话计时起点（秒粒度由 startedAt 推）的唯一机关。 */
type Ticker = {
    startTicker(): void;
    stopTicker(): void;
};

/** 题干里常驻的会话快照字段（开轮与恢复两侧共用，避免两处漂移）。
 *  返回类型标 `WenguSession` 的子集——不加注解时空数组会被判隐式 any。 */
function sessionCore(d: MobileDrill, sessionId: string): Omit<WenguSession, "startedAt" | "scopeIds" | "elapsedSec"> {
    return {
        id: sessionId,
        docId: d.ui.home.activeSetId,
        mode: d.ui.setup.timing,
        revealMode: d.ui.setup.reveal,
        stepsMode: "offline" as const,
        answered: 0,
        correct: 0,
        results: [],
    };
}

/** 首道未作答题的下标（Issue #167 A3）：恢复落点；全答满时回第 1 题。 */
export function firstUnansweredIdx(d: MobileDrill): number {
    const answered = resultsByQid(d.ui.session);
    const i = d.ui.list.findIndex((q) => !answered.has(q.id));
    return i < 0 ? 0 : i;
}

/** 会话结果按整题聚合（多步题记的是 qid#k）。 */
function resultsByQid(s: WenguSession | undefined): Set<string> {
    return new Set((s?.results ?? []).map((r) => baseQid(r.qid)));
}

/**
 * 「未完成轮」判据（**唯一实现**，Issue #167）：「有作答且未收卷」——
 * 只看 `endedAt`（Issue #12 B3 口径），`answered` 按块 id 去重（多步/逐空
 * 题记的是 `qid#k`），> 0 防空轮。恢复卡、开轮、切片用例三处都取它。
 */
export function isUnfinishedSession(s: WenguSession): boolean {
    return !s.endedAt && resultsByQid(s).size > 0;
}

/** 一条会话在恢复卡上要的料（编排层预解好，组件零重复计算）。 */
export interface MobileResumeView {
    /** 目标题集标题（取不到 id 时回落 activeSetTitle）。 */
    title: string;
    /** 已答题数（按块 id 去重）。 */
    answered: number;
    /** 本轮题数（scopeIds 快照长度；无快照 = **目标题集**的题数）。 */
    total: number;
}

/** 恢复卡视图料（纯计算，不写状态）。
 *  ⚠️ `list` 必须是**该会话所属题集**的题清单——恢复卡跨卷显示时
 *  `ui.fullList` 还是当前激活卷的，拿它当分母是错的（Issue #167 A2）。 */
export function resumeViewOf(d: MobileDrill, s: WenguSession, list: WenguQuestion[]): MobileResumeView {
    const ids = scopeIdSet(s);
    return {
        title: d.ui.home.sets.find((x) => x.id === s.docId)?.title || d.ui.home.activeSetTitle,
        answered: resultsByQid(s).size,
        total: ids ? ids.size : list.length,
    };
}

/** 该轮的题清单快照（`null` = 无快照 ⇒ 全量兜底，存量轮零迁移）。 */
function scopeIdSet(s: WenguSession): Set<string> | null {
    return s.scopeIds && s.scopeIds.length > 0 ? new Set(s.scopeIds) : null;
}

/** 全库未完成轮，`docId → 最近一条`（收卷的轮不算；无作答的空轮不算）。
 *  `docIds` 给定时只收这些题集——**清单里没有的题集（已删）不出恢复卡**。 */
async function unfinishedByDoc(d: MobileDrill, docIds: Set<string>): Promise<Map<string, WenguSession>> {
    const all = (await d.deps.history?.allSessions?.()) ?? [];
    const out = new Map<string, WenguSession>();
    for (const s of all) {
        // 升序 ⇒ 后写覆盖 = 该卷最近一条
        if (docIds.has(s.docId) && isUnfinishedSession(s)) out.set(s.docId, s);
    }
    return out;
}

/** 该卷的未完成轮能否直接用：快照（若有）在**该卷的题清单**里查得到题。
 *  题面分叉（题集被换/被清）时不算可继续，免得恢复出一张空卷。 */
function resumable(d: MobileDrill, s: WenguSession, list: WenguQuestion[]): boolean {
    const ids = scopeIdSet(s);
    return !ids || list.some((q) => ids.has(q.id));
}

/** 未完成轮探测（Issue #167 A1 + A1b）：**扫全库取最近一条**。
 *
 *  ⚠️ 原实现只看激活题集的 `docSessions` **最后一条**，两条缺口：
 *  未完成轮不在首个题集时恢复卡完全不出现（多套题常态）；目标题集存在
 *  **更新的已收卷轮**时，取「最后一条」的旧口径把它挤掉（边界 A）。
 *  全库探测 + 只收未完成轮两处都堵死。
 *
 *  取哪一条：全库未完成轮里 **`startedAt` 最大**的那条（「继续上次」＝最近
 *  一次断点；同刻取后出现的那条），恢复卡是全局一张（设计稿屏 ① 置顶单卡），
 *  卡上显示目标题集标题、分母按**目标题集**算。
 *
 *  ⚠️ **探测只读**：绝不改写 `activeSetId`（切卷只发生在用户点恢复卡那一步
 *  ——`resumeRound`）。原写法在探测里顺手 `selectSet` 过去，后果是用户
 *  点题集 A 会被静默弹到卷 B：开刷面板的题集行「点不动」，连「返回题集」
 *  也被弹走，等于把选卷入口废掉。 */
export async function restoreResumeFor(d: MobileDrill): Promise<void> {
    const docIds = new Set(d.ui.home.sets.map((x) => x.id));
    const map = await unfinishedByDoc(d, docIds);
    // 候选按 startedAt 倒序；取第一个「快照在本卷题清单里查得到题」的
    const ids = [...map.keys()].sort((a, b) => map.get(b)!.startedAt - map.get(a)!.startedAt);
    let s: WenguSession | undefined;
    let list: WenguQuestion[] = [];
    for (const id of ids) {
        const cand = map.get(id)!;
        // 跨卷清单现读**只为**判可继续与算分母（不切卷面）
        const candList = await setQuestionsOf(d, id);
        if (resumable(d, cand, candList)) {
            [s, list] = [cand, candList];
            break;
        }
    }
    d.ui.resume = s;
    d.ui.resumeView = s ? resumeViewOf(d, s, list) : undefined;
}

/** 某题集的题清单：激活卷直接用已装载的 `ui.fullList`（零成本），
 *  跨卷才按 id 现读（bank 缓存命中，不走解析）。 */
async function setQuestionsOf(d: MobileDrill, setId: string): Promise<WenguQuestion[]> {
    if (setId === d.ui.home.activeSetId) return d.ui.fullList;
    const bank = d.deps.bank;
    return bank ? await setQuestions(bank, setId) : [];
}

/**
 * 开轮 / 恢复（Issue #167 主入口；`MobileDrill.start` 只转发）。
 *
 * - `progress === "continue"` 且有恢复卡：**恢复卡自带的会话直接恢复**，
 *   恢复路径**不得二次探测**（边界 A：目标题集有更新的已收卷轮时会把它
 *   抹掉，「继续」退化成新开）；
 * - 其余为 fresh：按「本次题数」裁剪并**写 scopeIds 快照**（只有裁剪生效
 *   时才写，全量不写——与桌面 `scope === "all"` 不写同口径）。
 *
 * 展示层选项洗牌（Issue #131）：洗的是副本、scope 传会话 id（排列同轮
 * 恒定，否则恢复的字母指错项）；记账按 id 走。
 */
export function startRound(d: MobileDrill, progress: "fresh" | "continue"): void {
    // 恢复路径要先装载目标题集（`selectSet` 会重探测）——故先把会话抓在手里。
    // ⚠️ 只认**属于当前激活题集**的那条：跨卷会话的题清单还没装载，
    // 直接恢复会拿错卷的 fullList 洗出一张错卷（跨卷一律走 resumeRound）
    const r = d.ui.resume;
    const s = progress === "continue" && r?.docId === d.ui.home.activeSetId ? r : undefined;
    if (s) {
        d.ui.setup.reveal = s.revealMode === "after" ? "after" : "instant";
        d.ui.setup.timing = s.mode;
        const ids = scopeIdSet(s);
        d.ui.list = shuffleListForDisplay(ids ? d.ui.fullList.filter((q) => ids.has(q.id)) : [...d.ui.fullList], {
            scope: s.id,
        });
        d.ui.session = s;
    } else {
        beginFreshRound(d);
    }
    d.initRoundCards();
    d.ui.qIdx = s ? firstUnansweredIdx(d) : 0; // A3：恢复到首道未作答
    d.ui.matOpen = false;
    d.ui.drawer = false;
    d.ui.confirmEnd = false;
    d.ui.endPickedN = null;
    d.ui.screen = "drill";
    d.ui.elapsedSec = d.ui.session?.elapsedSec ?? 0;
    // ⚠️ 恢复路径**不许**再 upsert：upsert 是「按 id 整段换对象」，重放一份
    // 刚读出来的旧快照会把**同 id 那条的新态盖回去**（陈旧覆盖），且恢复
    // 本身零字段变化、白写一遍整文件。会话已是权威现场，无需回写。
    if (!s) void d.deps.history?.upsert(d.ui.session!);
    d.startTicker();
}

/**
 * 恢复卡点击入口（**异步**，Issue #167 A1）：跨题集时先装载目标题集
 * （复用 `selectSet` 的装载段），再以**恢复卡携带的会话**开轮——
 * 顺序不能反：先 `start` 会把当前卷面（错的题集）洗进 list。
 */
export async function resumeRound(d: MobileDrill): Promise<void> {
    const s = d.ui.resume;
    if (!s) return;
    // 边界 B：目标题集在探测之后被删（清单里已无此 id）就不恢复——
    // 装载段装不出题面，硬开会得到一张空卷
    if (!d.ui.home.sets.some((x) => x.id === s.docId)) {
        d.ui.resume = undefined;
        d.ui.resumeView = undefined;
        return;
    }
    if (s.docId !== d.ui.home.activeSetId) await d.selectSet(s.docId, { silent: true });
    d.ui.resume = s; // 装载段重探测可能换过一条，恢复卡自带的那条才是权威
    startRound(d, "continue");
}

/** fresh 开轮（无恢复时）：裁剪 → 铸会话 id → 洗牌 → 落库。 */
function beginFreshRound(d: MobileDrill): void {
    const full = d.ui.fullList;
    const n = d.ui.setup.count > 0 ? Math.min(d.ui.setup.count, full.length) : full.length;
    const culled = n > 0 && n < full.length; // 「本次题数」真的裁掉了题
    const src = full.slice(0, n);
    const sessionId = newSessionId(); // 会话 id 先铸：它同时是洗牌种子
    d.ui.list = shuffleListForDisplay(src, { scope: sessionId });
    d.ui.session = {
        ...sessionCore(d, sessionId),
        startedAt: Date.now(),
        scope: "all",
        // 题清单快照：只有 count 裁剪生效时才写（全量与桌面同口径不写）；
        // 不写 = 存量行为（恢复侧 ids 为空走全量兜底），零迁移、不 bump version
        scopeIds: culled ? src.map((q) => q.id) : undefined,
        elapsedSec: 0,
    };
}

/**
 * 空轮静默关轮（Issue #158）：与桌面 `RoundReport.closeEmptyRound` **四步
 * 同语义**，按移动端状态机落地——不落库、不出报告、清会话回可开新轮。
 *
 * 1. **抹 + 清会话**：`start` 一开轮就 `history.upsert`（那是「未完成轮可
 *    继续」的依托，探测只收有作答的轮），空轮必须把它 `removeSession`
 *    **删掉**才算「history 里不留该轮」——只清内存那条仍留在盘上（桌面
 *    同款教训：不删，统计总览轮次数虚增）；
 * 2. **停表**：不停走秒的 interval 会把已关轮的秒数继续写进旧会话对象；
 * 3. **退态**：关确认弹层 + 清本轮卡片态（报告屏/题号抽屉都按 `cards` 渲染，
 *    残留旧态会在下一轮开刷前被画出来）；
 * 4. **回开刷面板**：`screen = "home"`，并重探测未完成轮——上面那条已被删，
 *    不会再被认成「可继续」。
 *
 * ⚠️ 空轮判据（`answered <= 0`）由调用方 `MobileDrill.requestEnd` 持有；
 * 本函数只管执行体。移动端收卷入口**只有 `requestEnd` 一个**，别在别处再写
 * 一份 `answered <= 0`（桌面那笔：入口各写一份必漏，`finishNow` 就是漏的）。
 */
export function closeEmptyRound(d: MobileDrill & Ticker): void {
    const dropped = d.ui.session?.id;
    d.ui.session = undefined;
    d.ui.resume = undefined;
    d.ui.resumeView = undefined;
    // ⚠️ 光清内存删不掉 `start` 已 upsert 的那条 0 作答记录（探测只收有作答的轮，
    // 故它落到真实库就是统计多一轮）
    if (dropped) void d.deps.history?.removeSession(dropped);
    d.stopTicker();
    d.ui.confirmEnd = false;
    d.ui.cards = [];
    d.ui.list = [];
    d.ui.qIdx = 0;
    d.ui.elapsedSec = 0;
    d.ui.drawer = false;
    d.ui.matOpen = false;
    d.ui.screen = "home";
    // 回开刷面板：重探测未完成轮（口径与 backHome 同——silent 不闪屏）
    void d.selectSet(d.ui.home.activeSetId, { silent: true }).catch((): void => undefined);
}

/**
 * 「错题再练一轮」（报告屏入口）：以本轮错题为范围**开新轮**。
 *
 * 与 fresh 开轮同口径的两条：**现洗副本**（`shuffleListForDisplay`，
 * Issue #131——死形态下正确项恒在首位＝剧透）、**scope 传新会话 id**
 * （排列同轮恒定，否则恢复的字母指错项）。记账仍按 id 走
 * （`scope: "wrong"` + `scopeIds` 快照）。
 */
export function retryWrongRound(d: MobileDrill & Ticker): void {
    const s = d.ui.session;
    if (!s) return;
    const wrong = new Set(s.results.filter((r) => !r.ok).map((r) => baseQid(r.qid)));
    if (wrong.size === 0) return;
    const subset = d.ui.list.filter((q) => wrong.has(q.id));
    const sessionId = newSessionId();
    d.ui.list = shuffleListForDisplay(subset, { scope: sessionId });
    d.ui.setup.reveal = "instant";
    d.ui.session = {
        ...sessionCore(d, sessionId),
        startedAt: Date.now(),
        revealMode: "instant",
        scope: "wrong",
        scopeIds: subset.map((q) => q.id),
        elapsedSec: 0,
    };
    d.initRoundCards();
    d.ui.qIdx = 0;
    d.ui.confirmEnd = false;
    d.ui.drawer = false;
    d.ui.matOpen = false;
    d.ui.screen = "drill";
    d.ui.elapsedSec = 0;
    void d.deps.history?.upsert(d.ui.session);
    d.startTicker();
}
