import {fetchSyncPost} from "siyuan";
import {
    ATTR_PREFIX,
    Attr,
    Q_FLAG,
} from "./attrs";
import {
    cleanStemMd,
    LETTERS,
    normAnswerText,
    normalizeAnswerMd,
    normalizeType,
    optionComparable,
    parseDifficulty,
    QuestionType,
    splitOptionMd,
} from "./types";
import type {
    WenguDoc,
    WenguQuestion,
} from "./types";

/**
 * 题目块读写服务。
 *
 * 只依赖思源原生机制：
 * - 检测/查询：/api/query/sql（attributes 表按 custom-plugin-wengu-% 聚合，同参考插件 sy-lively）
 * - 单块读写：/api/attr/getBlockAttrs、/api/attr/setBlockAttrs
 * 不建任何外部存储。
 */

interface AttrsRow {
    block_id: string;
    root_id: string;
    attrs: string;
}

/** 属性对象（自定义属性以完整 `custom-plugin-wengu-*` 为键）。 */
type AttrsObject = Record<string, string>;

/** 完整属性名（含前缀）到 WenguQuestion 字段的映射。注意 answer 改为子块文本，不从属性读。 */
const FIELD_BY_ATTR: Record<string, keyof WenguQuestion> = {
    [Attr.type]: "type",
    [Attr.knowledge]: "knowledge",
    [Attr.chapter]: "chapter",
    [Attr.difficulty]: "difficulty",
    [Attr.source]: "source",
    [Attr.attempts]: "attempts",
    [Attr.wrongCount]: "wrongCount",
    [Attr.lastAnswer]: "lastAnswer",
    [Attr.right]: "right",
};

/** 取出的裸属性转成结构化题目视图。 */
function rowToQuestion(row: AttrsRow): WenguQuestion {
    let attrs: AttrsObject = {};
    try {
        attrs = JSON.parse(row.attrs);
    } catch (_) {
        // 属性 JSON 异常时按空属性处理，仅保留块定位信息
    }
    const q: WenguQuestion = {id: row.block_id, rootId: row.root_id, attempts: 0, wrongCount: 0};
    for (const attr of Object.getOwnPropertyNames(attrs)) {
        const value = attrs[attr];
        const field = FIELD_BY_ATTR[attr];
        if (!field) {
            continue;
        }
        if (field === "type") {
            q.type = normalizeType(value);
        } else if (field === "difficulty") {
            q.difficulty = parseDifficulty(value);
        } else if (field === "attempts") {
            q.attempts = Number(value) || 0;
        } else if (field === "wrongCount") {
            q.wrongCount = Number(value) || 0;
        } else {
            (q as unknown as Record<string, unknown>)[field] = value;
        }
    }
    return q;
}

/**
 * 查询已转换的题目块。
 * @param docId 限定某个文档时传入其 id；不传则全库。
 */
export async function listQuestions(docId?: string): Promise<WenguQuestion[]> {
    const docFilter = docId ?
        ` AND b.root_id = '${docId}'` :
        "";
    const stmt = `
        SELECT
            b.id AS block_id,
            b.root_id,
            '{' || GROUP_CONCAT('"' || a.name || '":"' || a.value || '"', ',') || '}' AS attrs
        FROM
            attributes AS a,
            blocks AS b
        WHERE
            a.name LIKE '${ATTR_PREFIX}%'
            AND a.block_id = b.id
            AND b.id IN (
                SELECT block_id FROM attributes WHERE name = '${Attr.q}' AND value = '${Q_FLAG}'
            )
            ${docFilter}
        GROUP BY
            b.id
        LIMIT 1024 OFFSET 0;`;
    const {data} = await fetchSyncPost("/api/query/sql", {stmt});
    const rows = (data as AttrsRow[]) ?? [];
    const questions = rows.filter((r) => typeof r.attrs === "string").map(rowToQuestion);
    // 块优先：取子块(题干/选项/答案/解析)。注意必须串行——思源的
    // fetchSyncPost 并发调用会互相吞响应挂起（真机实测 12 题 Promise.all
    // 卡死在加载态）；单题失败降级为不完整题目，不拖垮整列表。
    for (const q of questions) {
        try {
            await hydrate(q);
        } catch (_) {
            // 保留块定位信息，缺题干/答案的题在页签里走自评流程
        }
    }
    return questions;
}

/**
 * 已生成习题文档的聚合列表（题量/已刷/答对）——习题文档是真实保存的
 * 文档，此列表随文档持久存在，页签据此选择要刷的习题。
 * 真机验证过的 SQL（attributes 自联接容器块运行时属性）。
 */
export async function listQuestionDocs(): Promise<WenguDoc[]> {
    const stmt = `
        SELECT
            q.root_id AS docId,
            d.content AS title,
            d.hpath AS hPath,
            COUNT(*) AS total,
            SUM(CASE WHEN r.block_id IS NOT NULL THEN 1 ELSE 0 END) AS rightCount,
            SUM(CASE WHEN t.block_id IS NOT NULL THEN 1 ELSE 0 END) AS attempted,
            MAX(CAST(tt.value AS INTEGER)) AS totalTime
        FROM attributes AS q
        LEFT JOIN blocks AS d ON d.id = q.root_id
        LEFT JOIN attributes AS r
            ON r.block_id = q.block_id AND r.name = '${Attr.right}' AND r.value = '1'
        LEFT JOIN attributes AS t
            ON t.block_id = q.block_id AND t.name = '${Attr.attempts}'
        LEFT JOIN attributes AS tt
            ON tt.block_id = q.root_id AND tt.name = '${Attr.totalTime}'
        WHERE q.name = '${Attr.q}' AND q.value = '${Q_FLAG}'
        GROUP BY q.root_id, d.content, d.hpath
        ORDER BY total DESC
        LIMIT 256;`;
    const {data} = await fetchSyncPost("/api/query/sql", {stmt});
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        id: String(row.docId ?? ""),
        title: String(row.title ?? ""),
        hPath: String(row.hPath ?? ""),
        total: Number(row.total) || 0,
        attempted: Number(row.attempted) || 0,
        rightCount: Number(row.rightCount) || 0,
        totalTime: Number(row.totalTime) || 0,
    }));
}

/** 给习题文档块累加刷题用时（秒）。 */
export async function addDocTotalTime(docId: string, addSeconds: number): Promise<void> {
    if (addSeconds <= 0) return;
    const attrs = await getBlockAttrs(docId);
    const cur = Number(attrs[Attr.totalTime]) || 0;
    await setBlockAttrs(docId, {[Attr.totalTime]: String(cur + addSeconds)});
}

/** 取某容器块的所有子块，按 part 属性归类到题目字段。 */
async function hydrate(q: WenguQuestion): Promise<void> {
    const {data: children} = await fetchSyncPost("/api/block/getChildBlocks", {id: q.id, length: 128});
    const blocks = (children as ChildBlock[]) ?? [];
    if (blocks.length === 0) return;

    // 取这些子块的 part 属性
    const ids = blocks.map((b) => b.id).join("','");
    const {data: partRows} = await fetchSyncPost("/api/query/sql", {
        stmt: `SELECT block_id, value FROM attributes WHERE name = '${Attr.part}' AND block_id IN ('${ids}')`,
    });
    const partById = new Map<string, string>();
    for (const r of partRows as {block_id: string; value: string;}[]) {
        partById.set(r.block_id, r.value);
    }

    const partMd = new Map<string, string[]>();
    // 契约规定选项 part 为 option-0 / option-1 …（也容忍不带序号的 option）
    const options: {index: number; md: string;}[] = [];
    for (const b of blocks) {
        const part = partById.get(b.id);
        if (!part) continue;
        let md = (b.markdown ?? "").trim();
        if (!md) continue;
        if (part === "stem") {
            // 历史转换残留的「题干A：」标签：页签展示清洗后的文本，
            // 同时回写块本身，让文档/闪卡侧一并干净。
            // 这里必须 await——fetchSyncPost 并发会互相吞响应（真机踩坑）
            const cleaned = cleanStemMd(md);
            if (cleaned && cleaned !== md) await rewriteStemBlock(b.id, cleaned);
            md = cleaned;
        }
        const optionMatch = /^option(?:-(\d+))?$/.exec(part);
        if (optionMatch) {
            const index = optionMatch[1] !== undefined ? Number(optionMatch[1]) : options.length;
            options.push({index, md});
            continue;
        }
        const arr = partMd.get(part) ?? [];
        arr.push(md);
        partMd.set(part, arr);
    }
    options.sort((x, y) => x.index - y.index);

    q.stemMd = (partMd.get("stem") ?? []).join("\n\n");
    // 真实转换常把多个选项写进同一个列表块，按顶层条目拆成逐选项
    q.optionMd = options.flatMap((o) => splitOptionMd(o.md));
    q.answer = normalizeAnswerMd((partMd.get("answer") ?? []).join("\n"));
    q.solutionMd = (partMd.get("solution") ?? []).join("\n\n");
}

interface ChildBlock {
    id: string;
    type: string;
    content?: string;
    markdown?: string;
}

/**
 * 把清洗后的题干回写到块（保留原有属性），让 Protyle 渲染与
 * 闪卡侧看到的文档同样无标签残留。真机 3.8.0 验证 updateBlock 可用
 * 且 IAL 属性随 kramdown 尾行保留。
 */
async function rewriteStemBlock(id: string, cleaned: string): Promise<void> {
    try {
        const attrs = await getBlockAttrs(id);
        const ial = Object.entries(attrs)
            .filter(([k]) => k !== "id" && k !== "updated")
            .map(([k, v]) => `${k}="${String(v).replace(/"/g, "&quot;")}"`)
            .join(" ");
        await fetchSyncPost("/api/block/updateBlock", {
            id,
            dataType: "markdown",
            data: `${cleaned}\n{: id="${id}"${ial ? ` ${ial}` : ""}}`,
        });
    } catch (_) {
        // 尽力而为：回写失败只影响文档显示，不影响页签
    }
}

/** 读取单块的原始属性对象。 */
export async function getBlockAttrs(id: string): Promise<AttrsObject> {
    const {data} = await fetchSyncPost("/api/attr/getBlockAttrs", {id});
    return (data ?? {}) as AttrsObject;
}

/** 取容器块的 kramdown 源码（含子块，用于题干/选项/解析展示）。 */
export async function getBlockKramdown(id: string): Promise<string> {
    const {data} = await fetchSyncPost("/api/block/getBlockKramdown", {id});
    return (data ?? "") as string;
}

/** 写入单块的若干属性（合并到现有属性上）。 */
export async function setBlockAttrs(id: string, attrs: AttrsObject): Promise<void> {
    await fetchSyncPost("/api/attr/setBlockAttrs", {id, attrs});
}

/** 答案的多接受形态（fill 的 `a|b`、内容答案顿号分隔等）。 */
function acceptedAnswers(answer: string): string[] {
    return answer.split(/\||[,，、;；]/).map(normAnswerText).filter(Boolean);
}

/** submitted 是选项字母时映射到该选项的可比内容，否则原样返回。 */
function submittedComparable(q: WenguQuestion, submitted: string): string {
    const letters = submitted.toUpperCase().replace(/[^A-Z]/g, "");
    if (letters && letters.length === submitted.replace(/\s/g, "").length && q.optionMd?.length) {
        // 整串都是字母且与选项数对得上，按字母取选项内容
        const contents = [...letters].map((ch) => {
            const idx = LETTERS.indexOf(ch);
            return idx >= 0 && idx < q.optionMd.length ? optionComparable(q.optionMd[idx]) : "";
        });
        if (contents.every((c) => c)) return contents.sort().join("|");
    }
    return normAnswerText(submitted);
}

/**
 * 客观题判分（single/multiple/judge/fill），对真实转换结果容错：
 * - 选择题答案为字母串（契约写法）按字母比；
 * - 答案为内容（如 `$e^2$`）则把所选项内容与答案内容比对；
 * - 填空允许输入选项字母（把选项内容代入比对）；
 * - 比较对大小写、空白、`$` 定界不敏感。
 */
export function gradeQuestion(q: WenguQuestion, submitted: string): boolean {
    const type = q.type;
    const answer = q.answer ?? "";
    if (!type) return false;
    const ansNorm = normAnswerText(answer);
    switch (type) {
        case QuestionType.Single: {
            if (/^[A-Z]+$/.test(ansNorm)) {
                return normAnswerText(submitted) === ansNorm;
            }
            return submittedComparable(q, submitted) === ansNorm;
        }
        case QuestionType.Multiple: {
            if (/^[A-Z]+$/.test(ansNorm)) {
                return normAnswerText(submitted) === ansNorm;
            }
            // 内容答案：所选项内容集合 == 答案集合（排序后拼接比对）
            return submittedComparable(q, submitted) === [...acceptedAnswers(answer)].sort().join("|");
        }
        case QuestionType.Judge: {
            const map: Record<string, string> = {
                "√": "√",
                "对": "√",
                "T": "√",
                "TRUE": "√",
                "X": "×",
                "x": "×",
                "错": "×",
                "F": "×",
                "FALSE": "×",
                "×": "×",
            };
            return (map[normAnswerText(submitted)] ?? normAnswerText(submitted)) ===
                (map[ansNorm] ?? ansNorm);
        }
        case QuestionType.Fill: {
            const s = normAnswerText(submitted);
            if (acceptedAnswers(answer).includes(s)) return true;
            // 带选项的填空（真实转换会出现）：输字母等价于输选项内容
            return acceptedAnswers(answer).includes(submittedComparable(q, submitted));
        }
        default:
            return false;
    }
}

/** 第 idx 个选项是否属于正确答案（判分后描色用）。 */
export function optionIsRight(q: WenguQuestion, idx: number): boolean {
    const answer = q.answer ?? "";
    const ansNorm = normAnswerText(answer);
    const letter = LETTERS[idx] ?? "";
    if (/^[A-Z]+$/.test(ansNorm)) {
        return ansNorm.includes(letter);
    }
    const accepted = acceptedAnswers(answer);
    const comparable = q.optionMd?.[idx] !== undefined ? optionComparable(q.optionMd[idx]) : "";
    return accepted.includes(comparable);
}

/**
 * 作答记账：写 attempts / wrong-count / last-answer / right 到容器块。
 * 累计答错次数答错 +1、答对不清零（历史统计）。
 * brief 自评题不经过 grade，直接传 correct 调这里。
 */
export async function recordAttemptResult(id: string, submitted: string, correct: boolean): Promise<void> {
    const attrs = await getBlockAttrs(id);
    const attempts = (Number(attrs[Attr.attempts]) || 0) + 1;
    const wrongCount = (Number(attrs[Attr.wrongCount]) || 0) + (correct ? 0 : 1);
    await setBlockAttrs(id, {
        [Attr.attempts]: String(attempts),
        [Attr.wrongCount]: String(wrongCount),
        [Attr.lastAnswer]: submitted,
        [Attr.right]: correct ? "1" : "0",
    });
}

/**
 * 客观题作答：gradeQuestion 自动判分并记账。
 * @returns 本次是否正确。
 */
export async function recordAttempt(q: WenguQuestion, submitted: string): Promise<boolean> {
    const correct = gradeQuestion(q, submitted);
    await recordAttemptResult(q.id, submitted, correct);
    return correct;
}

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

/**
 * 发一条事务。思源 3.x 起加/移闪卡不再是独立端点，
 * 走事务 action=addFlashcards / removeFlashcards（真机 3.8.0 验证）。
 */
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
 * 尽力而为，失败不影响答题主流程。
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
