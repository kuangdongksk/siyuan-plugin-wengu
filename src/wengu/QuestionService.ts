import {fetchSyncPost} from "siyuan";
import {ATTR_PREFIX, Attr, Q_FLAG} from "./attrs";
import {parseDifficulty, QuestionType} from "./types";
import type {WenguQuestion} from "./types";

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

/** 完整属性名（含前缀）到 WenguQuestion 字段的映射。 */
const FIELD_BY_ATTR: Record<string, keyof WenguQuestion> = {
    [Attr.type]: "type",
    [Attr.answer]: "answer",
    [Attr.knowledge]: "knowledge",
    [Attr.chapter]: "chapter",
    [Attr.difficulty]: "difficulty",
    [Attr.source]: "source",
    [Attr.attempts]: "attempts",
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
    const q: WenguQuestion = {id: row.block_id, rootId: row.root_id, attempts: 0};
    for (const attr of Object.getOwnPropertyNames(attrs)) {
        const value = attrs[attr];
        const field = FIELD_BY_ATTR[attr];
        if (!field) {
            continue;
        }
        if (field === "type") {
            q.type = value as QuestionType;
        } else if (field === "difficulty") {
            q.difficulty = parseDifficulty(value);
        } else if (field === "attempts") {
            q.attempts = Number(value) || 0;
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
    const docFilter = docId
        ? ` AND b.root_id = '${docId}'`
        : "";
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
            AND b.root_id IN (
                SELECT block_id FROM attributes WHERE name = '${Attr.q}' AND value = '${Q_FLAG}'
            )
            ${docFilter}
        GROUP BY
            b.id
        LIMIT 1024 OFFSET 0;`;
    const {data} = await fetchSyncPost("/api/query/sql", {stmt});
    const rows = (data as AttrsRow[]) ?? [];
    return rows.filter((r) => typeof r.attrs === "string").map(rowToQuestion);
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

/** 客观题判分（single/multiple/judge/fill）。比较对大小写与空格不敏感。 */
export function grade(params: { type: QuestionType; answer: string; submitted: string }): boolean {
    const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");
    switch (params.type) {
        case QuestionType.Single:
        case QuestionType.Multiple:
            return norm(params.submitted) === norm(params.answer);
        case QuestionType.Judge: {
            const map: Record<string, string> = {"√": "√", "对": "√", "X": "×", "x": "×", "错": "×", "×": "×"};
            return (map[norm(params.submitted)] ?? norm(params.submitted))
                === (map[norm(params.answer)] ?? norm(params.answer));
        }
        case QuestionType.Fill: {
            const s = norm(params.submitted);
            return params.answer.split("|").some((accepted) => norm(accepted) === s);
        }
        default:
            return false;
    }
}

/**
 * 作答记账：写 attempts / lastAnswer / right 到容器块。
 * @returns 本次是否正确。
 */
export async function recordAttempt(id: string, type: QuestionType, answer: string, submitted: string): Promise<boolean> {
    const correct = grade({type, answer, submitted});
    const attrs = await getBlockAttrs(id);
    const attempts = (Number(attrs[Attr.attempts]) || 0) + 1;
    await setBlockAttrs(id, {
        [Attr.attempts]: String(attempts),
        [Attr.lastAnswer]: submitted,
        [Attr.right]: correct ? "1" : "0",
    });
    return correct;
}