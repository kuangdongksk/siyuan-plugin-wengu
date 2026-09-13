import { errText } from "./../../ui/shared";
import { judgeClue } from "../service/AiJudge";
import { getGroupQi, renderClueRow } from "./MaterialFlow";
import { clueOwnerQid, isGroupCurrentPick } from "./ClueMark";
import { clickChipForDelete, disarmClueChip } from "./ClueMarkDom";
import { canonSlice, pushClueRange, removeClueRange, type CanonRange } from "../service/ClueCanon";
import { canonMapOf, redecorateClues, type ClueAnchor, type ClueResolved } from "../service/MaterialDecorate";
import type { WenguSession } from "../service/HistoryStore";
import type { WenguMaterial, WenguQuestion } from "../../types";
import { esc } from "../../ui/shared";

/**
 * 线索标注（M5 定位能力训练，Issue #28 通用化；Issue #52 二期锚点改造）：
 * 在**可标区域**里选中一段 → 浮条「标为线索」→ 存进会话 `clues`
 * （qid→选段数组，纯文本锚点不写块）+ 平行 `clueRanges`（权威坐标）→
 * 原文高亮（mark 按坐标施工）+ chips 展示 → 答完题可「AI 复核」输出
 * hit/near/miss（错因二分：定位错 vs 理解错）。
 *
 * 二期口径（设计稿附录 D2/D3/D6）：
 * - **锚点在浮条 pointerdown 那一刻一次求取**（Range 还活着）→ 经 CanonMap
 *   换算权威坐标；端点在非权威区钳到最近边界，钳不出走降级链；
 * - **chips 文本 = 权威切片**（不再用 `getSelection().toString()`，
 *   上标噪音天然消失）；
 * - 删除线索两数组（`clues`/`clueRanges`）**同下标同步**；
 * - **渲染不回写坐标**（渲染是高频只读路径）；存量线索惰性升格——仅用户
 *   再次操作该题线索时才持久化坐标。
 *
 * 可标区域两态（组题行为不变）：
 * - 组题（q.group）：材料正文（`.wengu-gmat`）内选段，chips 挂组单元底部
 *   `[data-clues]`（现状）；
 * - 非组题（政治材料题/语文阅读等题干自带长文本）：题干区
 *   （`.wengu-qprotyle`）内选段，chips 挂卡内题干与作答区之间的槽。
 *
 * 高亮与 chips 都过同一条后处理（redecorateClues / renderClueRow），三处
 * 挂载时机（材料填充后 / 题干挂载后 / 会话恢复后）统一由
 * `refreshClueMarkFor(root)` 调用，禁复制第二份。
 */

/** ClueFlow 需要的宿主能力（QuizView 组装，全部薄取值器）。 */
export interface ClueHost {
    t(k: string): string;
    el: HTMLElement;
    currentSession(): WenguSession | undefined;
    /** 当前题（组内当前题由 MaterialFlow 切换时同步 activeQIdx）。 */
    currentQuestion(): WenguQuestion | undefined;
    /** 按 qid 找题（长卷全卡常驻：非当前题卡上的 chip 要删自己的线索）。 */
    questionById(qid: string): WenguQuestion | undefined;
    /** 整卷题表（组内共享槽只认组内当前题，需按材料归组）。 */
    questions?(): WenguQuestion[];
    /** 材料正文（AI 复核的输入；非组题为 undefined）。 */
    materialOf(q: WenguQuestion): WenguMaterial | undefined;
    /** 会话变更落库。 */
    persist(): void;
    /** AI 复核使用的模型 id（可选：缺省取空=智能体默认）。 */
    aiModelId?(): string;
}

/** 卡内线索 chips 槽元素（非组题；渲染在题干与作答区之间）。 */
function cardClueSlot(el: HTMLElement, qid: string): HTMLElement | null {
    return el.querySelector<HTMLElement>(`.wengu-card[data-qid="${qid}"] [data-clues]`);
}

/** 组单元底部槽（组题；组内切题时刷当前题的 chips）。 */
function groupClueSlot(el: HTMLElement, group: string): HTMLElement | null {
    return el.querySelector<HTMLElement>(`.wengu-gunit[data-mid="${group}"] [data-clues]`);
}

/** 某题的 chips 槽（组题=组单元底部，非组题=卡内槽）。 */
function clueSlotOf(host: ClueHost, q: WenguQuestion): HTMLElement | null {
    return q.group ? groupClueSlot(host.el, q.group) : cardClueSlot(host.el, q.id);
}

/** 某题的可标/装饰根（组题=材料面板，非组题=题干区）。 */
export function markRootOf(host: ClueHost, q: WenguQuestion): HTMLElement | null {
    if (q.group) {
        const unit = host.el.querySelector<HTMLElement>(`.wengu-gunit[data-mid="${q.group}"]`);
        return unit?.querySelector<HTMLElement>("[data-mprotyle]") ?? null;
    }
    return host.el.querySelector<HTMLElement>(`.wengu-card[data-qid="${q.id}"] .wengu-qprotyle`);
}

/** 被操作题：按被点元素反查归属题（长卷全卡常驻，非当前题卡的 chip
 *  删除与「AI 复核」都点得到，两路共用）；组题行只渲染组内当前题、
 *  无 qid 可查，回落当前题。 */
function ownerQuestion(host: ClueHost, el: HTMLElement): WenguQuestion | undefined {
    const qid = clueOwnerQid({
        cardQid: el.closest<HTMLElement>(".wengu-card")?.dataset.qid,
        currentQid: host.currentQuestion()?.id,
    });
    return qid ? host.questionById(qid) : undefined;
}

/** 该题是否「组内当前题」：组题的材料面板与底部 chips 槽**组内共享**
 *  （组内一次只显示一题），只有当前显示的那题能刷——详见
 *  ClueMark.isGroupCurrentPick 的两级判据。非组题恒真。 */
function isGroupCurrent(host: ClueHost, q: WenguQuestion): boolean {
    if (!q.group) return true;
    const card = host.el.querySelector<HTMLElement>('.wengu-card[data-qid="' + q.id + '"]');
    const members = (host.questions?.() ?? []).filter((x) => x.group === q.group);
    return isGroupCurrentPick({
        grouped: true,
        // 卡未渲染（材料缺失降级/尚未挂载）时 visible=undefined ⇒ 不拦
        visible: card ? !card.hasAttribute("hidden") : undefined,
        groupQi: members.length > 1 ? getGroupQi(q.group) : undefined,
        myQi: members.length > 1 ? members.findIndex((x) => x.id === q.id) : undefined,
    });
}

/** 该题当前会话里的线索（无则空数组）。 */
function cluesOf(host: ClueHost, q: WenguQuestion): string[] {
    return host.currentSession()?.clues?.[q.id] ?? [];
}

/** 线索存储面（`clues` + 平行 `clueRanges`）——结构收窄，便于纯单测直喂。 */
export interface ClueStore {
    clues?: Record<string, string[]>;
    clueRanges?: Record<string, ({ s: number; e: number } | undefined)[]>;
}

/** 该题线索的存储锚点（文本 + 可选权威坐标；下标与 clues 严格对齐）。 */
export function anchorsOf(session: ClueStore | undefined, qid: string): ClueAnchor[] {
    const texts = session?.clues?.[qid] ?? [];
    const ranges = session?.clueRanges?.[qid];
    return texts.map((text, i) => {
        const r = ranges?.[i];
        return r ? { text, range: { s: r.s, e: r.e } } : { text };
    });
}

/**
 * 高亮 + chips 的**唯一后处理**（Issue #28 验收：三处时机都过它）：
 * 材料填充后 / 题干挂载后 / 会话恢复后。幂等——高亮先摘旧 mark 再重铺
 * （按坐标施工，失败降级文本匹配），chips 整行重渲染。
 */
export function refreshClueMarkFor(host: ClueHost, q: WenguQuestion): ClueResolved[] {
    if (!isGroupCurrent(host, q)) return [];
    const s = host.currentSession();
    const clues = cluesOf(host, q);
    const resolved = redecorateClues(markRootOf(host, q), anchorsOf(s, q.id));
    const slot = clueSlotOf(host, q);
    if (slot) renderClueRow(slot, host.t, clues);
    return resolved;
}

/**
 * **惰性升格**（D3）：把该题「本帧解析出的坐标」持久化进 `clueRanges`。
 *
 * 只在**用户显式操作该题线索**（新增/删除）时调用——渲染是高频只读路径，
 * **渲染自身不回写**坐标（否则每次重铺都写盘）。因此：
 * - 该题从未升格（无 `clueRanges[qid]`）⇒ 不建（继续全走文本匹配降级）；
 * - 已升格 ⇒ 把仍是 `undefined` 的位补齐（`clues` 与 `clueRanges` 下标
 *   严格对齐，**不许重排**）；
 * - `resolved` 与 `anchorsOf` **逐位对齐**（`planClueMarks` 保证跳过的位
 *   占空），长度不符即整体放弃（宁缺勿错）。
 */
function upgradeClueRanges(host: ClueHost, q: WenguQuestion, resolved: ClueResolved[]): boolean {
    const s = host.currentSession();
    const ranges = s?.clueRanges?.[q.id];
    const clues = s?.clues?.[q.id] ?? [];
    if (!s || !ranges || resolved.length !== clues.length) return false;
    let changed = false;
    for (let i = 0; i < clues.length; i++) {
        const r = resolved[i]?.range;
        if (!r || ranges[i]) continue;
        ranges[i] = { s: r.s, e: r.e };
        changed = true;
    }
    return changed;
}

/** 整壳重渲染/材料填充后的全量补齐：逐题刷（题量在单卷内可控，
 *  且只有挂了线索的题需要 mark——一次性遍历避免漏题的时序坑）。 */
export function refreshAllClueMarks(host: ClueHost, list: WenguQuestion[]): void {
    for (const q of list) {
        if ((host.currentSession()?.clues?.[q.id]?.length ?? 0) > 0) refreshClueMarkFor(host, q);
    }
}

/**
 * 选中浮层「标为线索」入口（AnnoFlow 回调进来）。
 *
 * 二期（D2）：`anchorEl` 是选段起点所在卡（归属题反查沿用），`range` 是
 * 浮条 pointerdown 那一刻**还活着**的 Range——一次求取权威坐标：起点落在
 * 非权威区钳到最近权威边界；钳不出/无 CanonMap ⇒ 该条只存文本（降级链
 * D6，渲染时文本匹配求坐标）。
 *
 * **chips 文本 = 权威切片**（有坐标时），不再用选区 `toString()`——顺带
 * 消灭上标噪音；切片为空（选段整段落在非权威区）时退回传入文本。
 */
export function addClue(host: ClueHost, text: string, anchorEl?: HTMLElement | null, range?: CanonRange): void {
    const s = host.currentSession();
    // 归属题按**选段所在卡**反查（滚动跟踪滞后时「当前题」可能还没跟上，
    // 按当前题会挂到上一题的 clues 上）；组题材料面板无卡 qid，回落当前题
    const q = anchorEl ? ownerQuestion(host, anchorEl) : host.currentQuestion();
    if (!s || !q) return;
    const clues = (s.clues ?? (s.clues = {}))[q.id] ?? (s.clues[q.id] = []);
    const finalText = range ? canonSliceOf(host, q, range) || text : text;
    if (clues.includes(finalText)) return;
    // **惰性升格**（D3）：该题首次拿到坐标时才建坐标数组（存量线索补
    // undefined 占位保住下标对齐）；此后该题的增删都带坐标同步推进。
    // 渲染路径**不回写**坐标——只有用户显式操作线索（本次）才落库。
    if (range && !s.clueRanges?.[q.id]) (s.clueRanges ?? (s.clueRanges = {}))[q.id] = [];
    const ranges = s.clueRanges?.[q.id];
    pushClueRange(clues, ranges, finalText, range);
    // 本次操作即「再次操作该题线索」⇒ 顺手把存量线索本帧解析出的坐标补进去
    // （本次坐标施工、解析必成，故存量位一次补齐）。从未升格的题不建表。
    const resolved = refreshClueMarkFor(host, q);
    upgradeClueRanges(host, q, resolved);
    host.persist();
}

/** 权威切片（chips 显示文本）；无 CanonMap/切片为空回空串（调用侧退回文本）。 */
function canonSliceOf(host: ClueHost, q: WenguQuestion, range: CanonRange): string {
    const map = canonMapOf(markRootOf(host, q));
    return map ? canonSlice(map, range) : "";
}

/** 渲染某题的线索 chips + 高亮（组内切题/滚动跟踪 onActive 时调用）。 */
export function refreshClueRow(host: ClueHost): void {
    const q = host.currentQuestion();
    if (!q) return;
    refreshClueMarkFor(host, q);
}

/** 删掉某题的第 i 条线索（chip 两击确认后调用）：会话数据 + chips +
 *  原文 mark 三处同步（验收：mark 随 chip 一起消失）；坐标数组同下标同步删。 */
function removeClueAt(host: ClueHost, q: WenguQuestion, i: number): void {
    const s = host.currentSession();
    const clues = s?.clues?.[q.id];
    if (!clues || i < 0 || i >= clues.length) return;
    removeClueRange(clues, s?.clueRanges?.[q.id], i);
    if (clues.length === 0 && s?.clues) {
        delete s.clues[q.id];
        if (s.clueRanges) delete s.clueRanges[q.id];
    }
    // 删除同为「用户显式操作该题线索」⇒ 剩余线索同样惰性升格（仅升过格的题）
    const resolved = refreshClueMarkFor(host, q);
    upgradeClueRanges(host, q, resolved);
    host.persist();
}

/** 绑定线索交互（事件委托挂视图根，重渲染不失效）：
 *  ① chip 两击删除；②「AI 复核线索」按钮。 */
export function bindClueJudge(host: ClueHost): void {
    host.el.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement;
        const chip = target.closest<HTMLElement>(".wengu-clue-chip");
        if (chip) {
            const row = chip.closest<HTMLElement>("[data-clues]");
            if (!row) return;
            const i = Number(chip.dataset.clue ?? "-1");
            const q = ownerQuestion(host, chip);
            if (!q) return;
            // 首击=arm（警示），再击=确认删除；删完 refreshClueRow 重铺行，
            // 行的待确认态随 innerHTML 复位（armStates 是 WeakMap）
            if (clickChipForDelete(row, i)) {
                disarmClueChip(row);
                removeClueAt(host, q, i);
            }
            return;
        }
        const btn = target.closest<HTMLElement>("[data-act='clue-judge']");
        if (!btn) return;
        // 复核结果行贴在**被点卡**里，归属题同样要按卡反查——按「当前题」
        // 会拿错题的线索去判、再把结论贴到另一张卡上（与 chip 删除同源）
        const scope = btn.closest<HTMLElement>(".wengu-gunit, .wengu-card") ?? host.el;
        const q = ownerQuestion(host, scope);
        if (q) void judgeClueNow(host, q, scope);
    });
}

async function judgeClueNow(host: ClueHost, q: WenguQuestion, scope: HTMLElement): Promise<void> {
    const s = host.currentSession();
    if (!s) return;
    const clues = cluesOf(host, q);
    if (clues.length === 0) return;
    // 复核输入：组题=材料正文；非组题（题干自带长文本）=题干 md
    // （验收：非组题线索可复核，输入=题干；prompt 侧注明来源）
    const mat = host.materialOf(q);
    const source = mat ? { text: mat.bodyMd ?? "", from: "material" as const } : null;
    const stem = { text: q.stemMd ?? "", from: "stem" as const };
    const input = source ?? (q.stemMd ? stem : null);
    if (!input) return;
    const row = scope.querySelector<HTMLElement>("[data-clues]");
    if (row) {
        row.querySelector("[data-clue-result]")?.remove();
        row.insertAdjacentHTML(
            "beforeend",
            `<span class="wengu-clue-result" data-clue-result>${esc(host.t("clueJudging"))}</span>`
        );
    }
    try {
        const submitted = s.results.find((r) => r.qid === q.id)?.submitted ?? "";
        const v = await judgeClue(input.text, q, submitted, clues, host.aiModelId?.() ?? "", input.from);
        const label =
            v.clue === "hit" ? host.t("clueHit") : v.clue === "near" ? host.t("clueNear") : host.t("clueMiss");
        if (row) {
            row.querySelector("[data-clue-result]")?.remove();
            row.insertAdjacentHTML(
                "beforeend",
                `<span class="wengu-clue-result wengu-clue-${v.clue}" data-clue-result">${esc(label)}${
                    v.comment ? ` · ${esc(v.comment)}` : ""
                }</span>`
            );
        }
    } catch (e) {
        row?.querySelector("[data-clue-result]")?.remove();
        note(host, `${host.t("aiJudgeFailed")}${errText(e)}`);
    }
}

function note(host: ClueHost, text: string): void {
    const status = host.el.querySelector<HTMLElement>("[data-status]");
    if (status) {
        status.textContent = text;
        status.classList.remove("wengu-status-err");
        status.removeAttribute("hidden");
    }
}
