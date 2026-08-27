import { NEW_LADDER } from "./WordQuiz";

/**
 * 新学滚动窗口调度器（redesign §二.3，20260828 口述定稿）：每张卡现场
 * 决策，取代静态流水线。纯函数、无 IO，单测覆盖（WindowSched.test.ts）。
 *
 * 决策序（按序取第一条命中，b 优先=「窗口有空位就进新词」）：
 * ① 窗口未满且有新词 → 引入新词（开局冷启动即连续命中此条=连教）；
 * ② 有就绪词（梯未走完 且 距上次出镜 ≥GAP 张）→ 推进最久未出镜者；
 * ③ 都不就绪 → 垫场（最久未出镜者，放宽间隔的极端兜底）；
 * ④ 窗口空且无新词 → done。
 *
 * 调用方约定：advance/new 的步进与 lastSeq 更新、毕业出窗、答错清零
 * 由调用方在收尾时做（WordView/FreshFlow），本模块只做「下一张出谁」。
 */

/** 出镜间隔下限（张）：同一词两次出镜至少隔 3 张卡。 */
export const FRESH_GAP = 3;

/** 窗口词条（step=已完成步数 0~4；lastSeq=上次出镜卡序；errs=整梯重来次数）。 */
export interface WinEntry {
    step: number;
    lastSeq: number;
    errs: number;
}

/** 一次决策结果：new=引入新词 / advance=推进在学词 / done=会话收尾。 */
export type FreshPick = { kind: "new"; idx: number } | { kind: "advance"; idx: number } | { kind: "done" };

/** 下一张卡出谁。nextNew 须返回不在窗口内的新词下标（无则 undefined）。 */
export function pickFreshCard(
    win: ReadonlyMap<number, WinEntry>,
    seq: number,
    cap: number,
    nextNew: () => number | undefined
): FreshPick {
    if (win.size < cap) {
        const idx = nextNew();
        if (idx !== undefined) return { kind: "new", idx };
    }
    const alive = [...win.entries()].filter(([, e]) => e.step < NEW_LADDER.length);
    if (alive.length === 0) return { kind: "done" };
    const ready = alive.filter(([, e]) => seq - e.lastSeq >= FRESH_GAP);
    const pool = ready.length > 0 ? ready : alive;
    let best = pool[0];
    for (const e of pool) if (e[1].lastSeq < best[1].lastSeq) best = e;
    return { kind: "advance", idx: best[0] };
}
