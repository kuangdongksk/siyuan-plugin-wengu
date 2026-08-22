import {fetchSyncPost} from "siyuan";
import {
    ATTR_PREFIX,
    Attr,
    Q_FLAG,
} from "./attrs";
import {gradeQuestion} from "./QuestionGrading";
import {
    cleanStemMd,
    normalizeAnswerMd,
    normalizeType,
    parseDifficulty,
    parseStepKinds,
    splitOptionMd,
} from "./types";
import type {
    WenguDoc,
    WenguQuestion,
    WenguStep,
} from "./types";

/**
 * 题目块读写服务（判分纯函数在 QuestionGrading、错题闪卡在 Flashcards，
 * 这里 re-export 保持既有导入路径稳定）。
 *
 * 只依赖思源原生机制：
 * - 检测/查询：/api/query/sql（attributes 表按 custom-plugin-wengu-% 聚合，同参考插件 sy-lively）
 * - 单块读写：/api/attr/getBlockAttrs、/api/attr/setBlockAttrs
 * 不建任何外部存储。
 */

export { addWrongFlashcard, removeWrongFlashcard } from "./Flashcards";
export { gradeQuestion, gradeStep, optionIsRight, stepOptionIsRight } from "./QuestionGrading";

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
    [Attr.steps]: "steps",
    [Attr.knowledge]: "knowledge",
    [Attr.chapter]: "chapter",
    [Attr.difficulty]: "difficulty",
    [Attr.source]: "source",
    [Attr.attempts]: "attempts",
    [Attr.wrongCount]: "wrongCount",
    [Attr.lastAnswer]: "lastAnswer",
    [Attr.right]: "right",
    [Attr.stepRight]: "stepRight",
    [Attr.stepLast]: "stepLast",
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
        } else if (field === "steps") {
            // 步骤类型声明：先建骨架（kind），子块文本由 hydrate 填充
            const kinds = parseStepKinds(value);
            if (kinds) {
                q.steps = kinds.map((kind) => ({kind, stemMd: "", optionMd: [] as string[], answer: ""}));
            }
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
    // steps 题：step-{k}-stem / step-{k}-option-{j} / step-{k}-answer 按步聚合
    const stepAcc = new Map<number, {stems: string[]; options: {index: number; md: string;}[]; answers: string[];}>();
    const stepOf = (k: number) => {
        let acc = stepAcc.get(k);
        if (!acc) {
            acc = {stems: [], options: [], answers: []};
            stepAcc.set(k, acc);
        }
        return acc;
    };
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
        const stepMatch = /^step-(\d+)-(stem|option(?:-(\d+))?|answer)$/.exec(part);
        if (stepMatch) {
            const acc = stepOf(Number(stepMatch[1]));
            if (stepMatch[2] === "stem") {
                acc.stems.push(md);
            } else if (stepMatch[2] === "answer") {
                acc.answers.push(md);
            } else {
                acc.options.push({index: stepMatch[3] !== undefined ? Number(stepMatch[3]) : acc.options.length, md});
            }
            continue;
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

    // 步骤组装：steps 属性声明的 kind 优先，缺失/越界的步按 result 容错
    const kinds = q.steps?.map((s) => s.kind);
    const steps = [...stepAcc.entries()]
        .sort((x, y) => x[0] - y[0])
        .map(([, acc], i) =>
            ({
                kind: kinds?.[i] ?? "result",
                stemMd: acc.stems.join("\n\n"),
                optionMd: acc.options
                    .sort((x, y) => x.index - y.index)
                    .flatMap((o) => splitOptionMd(o.md)),
                answer: normalizeAnswerMd(acc.answers.join("\n")),
            }) satisfies WenguStep
        );
    if (steps.length > 0) q.steps = steps;
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

/**
 * 多步题整题记账：整题 right=全步对，同时写逐步运行态。
 * AI 实时模式的步骤序列不落盘（persistStepState=false，只记整题）。
 */
export async function recordStepsResult(
    q: WenguQuestion,
    letters: string[],
    oks: boolean[],
    persistStepState: boolean,
): Promise<boolean> {
    const allOk = oks.length > 0 && oks.every(Boolean);
    const attrs = await getBlockAttrs(q.id);
    const attempts = (Number(attrs[Attr.attempts]) || 0) + 1;
    const wrongCount = (Number(attrs[Attr.wrongCount]) || 0) + (allOk ? 0 : 1);
    const payload: AttrsObject = {
        [Attr.attempts]: String(attempts),
        [Attr.wrongCount]: String(wrongCount),
        [Attr.lastAnswer]: letters.join("|"),
        [Attr.right]: allOk ? "1" : "0",
    };
    if (persistStepState) {
        payload[Attr.stepRight] = oks.map((ok) => ok ? "1" : "0").join("");
        payload[Attr.stepLast] = letters.join("|");
    }
    await setBlockAttrs(q.id, payload);
    return allOk;
}

/**
 * 改判（brief 的 AI 判分纠错 / 自评更正）：只翻 right，不动 attempts；
 * 错改对时回退一次 wrong-count，对改错时补记一次。
 */
export async function overrideAttemptResult(id: string, correct: boolean): Promise<void> {
    const attrs = await getBlockAttrs(id);
    const cur = Number(attrs[Attr.wrongCount]) || 0;
    if (correct) {
        await setBlockAttrs(id, {
            [Attr.right]: "1",
            ...(cur > 0 ? {[Attr.wrongCount]: String(cur - 1)} : {}),
        });
    } else {
        await setBlockAttrs(id, {[Attr.right]: "0", [Attr.wrongCount]: String(cur + 1)});
    }
}

/**
 * steps 改判落盘（方法步申诉复核通过）：翻逐步 step-right 与整题
 * right，不动 attempts；整题由错翻对时回退一次 wrong-count。
 */
export async function overrideStepsResult(
    q: WenguQuestion,
    letters: string[],
    oks: boolean[],
): Promise<boolean> {
    const allOk = oks.length > 0 && oks.every(Boolean);
    const attrs = await getBlockAttrs(q.id);
    const payload: AttrsObject = {
        [Attr.stepRight]: oks.map((ok) => ok ? "1" : "0").join(""),
        [Attr.stepLast]: letters.join("|"),
        [Attr.lastAnswer]: letters.join("|"),
        [Attr.right]: allOk ? "1" : "0",
    };
    const wrongCount = Number(attrs[Attr.wrongCount]) || 0;
    if (attrs[Attr.right] !== "1" && allOk && wrongCount > 0) {
        payload[Attr.wrongCount] = String(wrongCount - 1);
    }
    await setBlockAttrs(q.id, payload);
    return allOk;
}
