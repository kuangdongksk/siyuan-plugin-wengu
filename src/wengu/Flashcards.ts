import {fetchSyncPost} from "siyuan";

/**
 * 错题闪卡卡组（从 QuestionService 拆出）：「温故错题」卡组的
 * 懒创建与加/移卡片。思源 3.x 起加/移闪卡不再是独立端点，走事务
 * action=addFlashcards / removeFlashcards（真机 3.8.0 验证）。
 * 全部尽力而为，失败不影响答题主流程。
 */

/** 错题闪卡卡组名（首次加错题时懒创建）。 */
const WRONG_DECK_NAME = "温故错题";

interface RiffDeck {
    id?: string;
    name?: string;
    size?: number;
}

/** 「温故错题」卡组 id 缓存。 */
let wrongDeckId = "";

/** /api/transactions 要求的请求序号。 */
let txReqId = 0;

/** 发一条事务（reqId 自增）。 */
async function transact(operations: Record<string, unknown>[]): Promise<boolean> {
    const {code} = await fetchSyncPost("/api/transactions", {
        reqId: ++txReqId,
        transactions: [{doOperations: operations, undoOperations: []}],
    });
    return code === 0;
}

async function listRiffDecks(): Promise<RiffDeck[]> {
    const {data} = await fetchSyncPost("/api/riff/getRiffDecks");
    return (data ?? []) as RiffDeck[];
}

/** 卡组当前卡片数；找不到卡组返回 -1。 */
async function deckSize(deckId: string): Promise<number> {
    const deck = (await listRiffDecks()).find((d) => d.id === deckId);
    return deck ? (deck.size ?? 0) : -1;
}

/** 按 name 找卡组，找不到返回空串。 */
async function findWrongDeck(): Promise<string> {
    return (await listRiffDecks()).find((d) => d.name === WRONG_DECK_NAME)?.id ?? "";
}

/** 确保「温故错题」卡组存在（不存在则创建），返回其 id。 */
async function ensureWrongDeck(): Promise<string> {
    if (!wrongDeckId) wrongDeckId = await findWrongDeck();
    if (!wrongDeckId) {
        const {data} = await fetchSyncPost("/api/riff/createRiffDeck", {name: WRONG_DECK_NAME});
        wrongDeckId = String((data as RiffDeck)?.id ?? "");
    }
    return wrongDeckId;
}

/**
 * 错题入闪卡（产品决策 3）：把题目容器块加入「温故错题」卡组。
 * addFlashcards 幂等（重复加同一块不重复计），用卡组 size 变化判断是否新加入。
 */
export async function addWrongFlashcard(blockId: string): Promise<boolean> {
    try {
        const deckId = await ensureWrongDeck();
        if (!deckId) return false;
        const before = await deckSize(deckId);
        if (!(await transact([{action: "addFlashcards", deckID: deckId, blockIDs: [blockId]}]))) {
            return false;
        }
        return await deckSize(deckId) > before;
    } catch (_) {
        return false;
    }
}

/** 答对后把块移出错题卡组，让卡组始终等于当前错题集（不创建卡组）。 */
export async function removeWrongFlashcard(blockId: string): Promise<boolean> {
    try {
        const deckId = wrongDeckId || await findWrongDeck();
        if (!deckId) return false;
        const before = await deckSize(deckId);
        if (before <= 0) return false;
        if (!(await transact([{action: "removeFlashcards", deckID: deckId, blockIDs: [blockId]}]))) {
            return false;
        }
        return await deckSize(deckId) < before;
    } catch (_) {
        return false;
    }
}
