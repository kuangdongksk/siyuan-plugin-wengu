import { keyOf as keyOfBook, type WenguWordBookData } from "../service/WordBook";
import type { WenguReviewRec, WenguTimingRec, WenguWordFsrs, WenguWordMistake, WenguWordProgress } from "./WordStore";

/**
 * v2→v3 进度迁移（redesign §五，20260828 一次性过渡）：key 从「词在
 * 书内的扁平下标字符串」换成「归一化词头」。v2 时代唯一的词书是内置
 * 书，索引一律按内置书换算（book 参数注入便于单测）。v2 的 cursor
 * 字段废除（v3 从全书扫第一个无进度词）。迁移代码待用户确认存量落盘
 * v3 后移除（同 v1→v2 先例，见 WordStore.get）。
 */

/** v2 存储形状（与 v3 的差异：下标 key + cursor + 易混组下标 ids）。 */
interface WenguWordProgressV2 {
    version: 2;
    cursor: number;
    words: Record<string, WenguWordFsrs>;
    ladder: Record<string, [number, number]>;
    reviews: Record<string, WenguReviewRec[]>;
    mistakes: Record<string, WenguWordMistake>;
    simple: Record<string, 1>;
    familiar: Record<string, 1>;
    starred: Record<string, 1>;
    log: Record<string, [number, number]>;
    today: WenguWordProgress["today"];
    timing?: Record<string, WenguTimingRec[]>;
    confusables?: { ids: number[]; src: "preset" | "ai" | "evidence"; raw?: string }[];
    confNotes?: Record<string, string>;
    notes?: Record<string, string>;
    groupSize?: number;
    windowCap?: number;
}

/** 下标 key 记录 → 词头 key 记录（越界/坏 key 丢弃；书内重复词头后者覆盖）。 */
function rekey<T>(map: Record<string, T> | undefined, book: WenguWordBookData): Record<string, T> {
    const out: Record<string, T> = {};
    for (const [k, v] of Object.entries(map ?? {})) {
        const i = Number(k);
        const key = Number.isInteger(i) ? keyOfBook(book, i) : "";
        if (key) out[key] = v;
    }
    return out;
}

/** v2 进度 → v3 进度（data 非 v2 形状按空进度起步）。 */
export function migrateV2(data: unknown, book: WenguWordBookData): WenguWordProgress {
    const old = (data && typeof data === "object" ? data : {}) as Partial<WenguWordProgressV2>;
    const confusables: WenguWordProgress["confusables"] = [];
    for (const g of old.confusables ?? []) {
        const ids = (g.ids ?? []).map((i) => keyOfBook(book, i)).filter((k): k is string => Boolean(k));
        // 组员全换算失败，或退化成单成员又无 raw 兜底——组无意义，丢弃
        if (ids.length === 0 || (ids.length === 1 && !g.raw)) continue;
        confusables.push({ ids, src: g.src, raw: g.raw });
    }
    // v2 易混组笔记 key = ids 数字升序逗号串 → 换成词头串（任一组员
    // 换算失败即组已残缺，整条笔记丢弃）
    const confNotes: Record<string, string> = {};
    for (const [k, note] of Object.entries(old.confNotes ?? {})) {
        const ids = k.split(",").map((s) => keyOfBook(book, Number(s)));
        if (ids.some((id) => !id)) continue;
        confNotes[[...ids].sort().join(",")] = note;
    }
    return {
        version: 3,
        words: rekey(old.words, book),
        ladder: rekey(old.ladder, book),
        reviews: rekey(old.reviews, book),
        mistakes: rekey(old.mistakes, book),
        simple: rekey(old.simple, book),
        familiar: rekey(old.familiar, book),
        starred: rekey(old.starred, book),
        log: old.log ?? {},
        today: old.today ?? { key: "", newCount: 0, revCount: 0 },
        timing: rekey(old.timing, book),
        confusables,
        confNotes,
        notes: rekey(old.notes, book),
        groupSize: old.groupSize,
        windowCap: old.windowCap,
    };
}
