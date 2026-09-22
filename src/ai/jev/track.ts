/**
 * Jev 判定的**会话登记**（Issue #201）：把六落点的每次 `judgeJev` 调用按
 * 既有登记簿生命周期（begin/succeed/fail）落一条记录，用户可在「AI 会话」
 * 面板回看每次判定的输入摘要、类型化答案（判定值 + confidence）与失败原因。
 *
 * 本模块是 `client.judgeJev` 的接线片：client 只留「三行内」的调用，
 * 折算与守卫全在这里（`ai/jev/client.ts` 的 500 行额度与职责都留给
 * 「请求组装 → 状态码政策 → 响应解析」）。
 *
 * 三条口径（改这里前先读）：
 *  1. **登记簿未接线时零动作**：全部经 `aiSessions()?.` 守卫——纯逻辑单测
 *     与预览环境没有登记簿，判定行为逐字节不变；
 *  2. **登记簿 schema 零新增**：`begin/succeed/fail` 现有字段完全够用
 *     （turns 的 user 侧=输入摘要、ai 侧=类型化答案摘要），不动
 *     `AiSessionRecord`、不 bump version、不涉数据演进守则新闸；
 *  3. **kind 固定 `"jev"`、id 由本模块生成**：判定不是对话，没有内核
 *     sessionID——记录 id 只是登记簿内的唯一键（与 `mintTsId` 同形）。
 *
 * 回答块 = **答案行在前 + 「问题：」节在后**（Issue #210）：只落判定值时，
 * 面板上只有 `q1：是/否 0.89` 这样的行，回看不出「每一问到底在问什么」。
 * 问题正文本来就与答案按位序一一对应（`opts.questions`），成功收口时一并
 * 折算进去即可；**编号口径与答案行同一套**（位序 +1），两节按位对照着读。
 */
import { aiSessions, type AiSessionRecord, type AiSessionGroup } from "../data/AiSessions";
import { JEV_MODEL, type JevAnswer, type JevQuestion } from "./client";
import { mintTsId } from "../../types";

/** 判定的登记上下文（`judgeJev` opts.track）：kind 由本模块写死，调用方
 *  只给「这是什么动作」与可选的同动作分组。 */
export interface JevTrack {
    /** 记录标题（如「质检 · 高等数学」，与生成式侧的 aiTitle 同款）。 */
    title: string;
    /** 同一次动作的多次判定挂同组（组机制数据层已支持，树上自动合并主题）。 */
    group?: AiSessionGroup;
}

/** 输入摘要上限（登记簿自身对单轮还有 2 万字封顶，这里先收一道更紧的
 *  ——判定的 `state` 动辄数千字，面板要看的是「这次问的是什么」。 */
export const JEV_STATE_SUMMARY_CAP = 600;

/** 输入摘要：单行化（换行折成 ` · `）+ 截断。 */
export function jevStateSummary(state: string): string {
    const flat = state.replace(/\s*\n+\s*/g, " · ").trim();
    return flat.length > JEV_STATE_SUMMARY_CAP ? `${flat.slice(0, JEV_STATE_SUMMARY_CAP)}…` : flat;
}

/** 概率显示：NaN/非数不出（**别把「值缺失」印成 `NaN`**——那看着像结论）。 */
function pct(v: number | undefined): string {
    if (typeof v !== "number" || !Number.isFinite(v)) return "?";
    return v.toFixed(2);
}

/** 单条类型化答案 → 一行摘要（三型各自的「结论 + 置信度」，question-block 口径）。 */
export function jevAnswerLine(i: number, a: JevAnswer): string {
    const n = `q${i + 1}`;
    if (a.kind === "noul") return `${n}：是/否 ${pct(a.noul)}`;
    if (a.kind === "choice") return `${n}：${a.choice}（confidence ${pct(a.confidence)}）`;
    return `${n}：${a.score} 档（confidence ${pct(a.confidence)}）`;
}

/** 类型化答案摘要（一行一条；调用方在 `usable` 过滤后回填，条数=已判定题数）。 */
export function jevAnswersSummary(answers: JevAnswer[]): string {
    return answers.map((a, i) => jevAnswerLine(i, a)).join("\n");
}

/** 单问正文的摘要上限：判定问句动辄上百字（见 `convertChecks` 五问），
 *  面板要的是「这一问在问什么」，全长铺开会把回答块淹掉。 */
export const JEV_QUESTION_SUMMARY_CAP = 80;

/** 单问正文的显示形式：单行化 + 截断。 */
export function jevQuestionLine(q: string): string {
    const flat = q.replace(/\s*\n+\s*/g, " ").trim();
    return flat.length > JEV_QUESTION_SUMMARY_CAP ? `${flat.slice(0, JEV_QUESTION_SUMMARY_CAP)}…` : flat;
}

/** 问题清单摘要（一行一条，编号与 {@link jevAnswerLine} 同口径：位序 +1）。 */
export function jevQuestionsSummary(questions: JevQuestion[]): string {
    return questions.map((q, i) => `q${i + 1} ${jevQuestionLine(q.question)}`).join("\n");
}

/** 「问题：」节分隔（答案在前、问题在后，两节之间空一行）。 */
const QUESTIONS_HEADING = "问题：";

/** 成功登记的 ai 侧文本：答案行 + 空行 + 「问题：」节。
 *  **空清单不出问题节**（调用方理论上不会这么传，但登记不该凭空多一段空标题）。 */
export function jevAnswerBlock(answers: JevAnswer[], questions: JevQuestion[]): string {
    const head = jevAnswersSummary(answers);
    if (questions.length === 0) return head;
    return `${head}\n\n${QUESTIONS_HEADING}\n${jevQuestionsSummary(questions)}`;
}

/** 登记一笔判定的**起点**（返回记录 id；登记簿未接线返回 undefined=不登记）。 */
export function beginJevSession(track: JevTrack, state: string): string | undefined {
    const store = aiSessions();
    if (!store) return undefined;
    const id = `jev-${mintTsId()}`;
    store.begin(id, "jev", track.title, JEV_MODEL, jevStateSummary(state), track.group);
    return id;
}

/** 登记**成功**（ai 轮 = 类型化答案摘要 + 按序问题清单，见头注 #210）。 */
export function succeedJevSession(id: string | undefined, answers: JevAnswer[], questions: JevQuestion[]): void {
    if (id) aiSessions()?.succeed(id, jevAnswerBlock(answers, questions));
}

/** 登记**失败**（原样记错误消息——面板要能读到 401/403 的「检查 key」提示）。 */
export function failJevSession(id: string | undefined, e: unknown): void {
    if (id) aiSessions()?.fail(id, e instanceof Error ? e.message : String(e));
}

/** 该记录是不是 Jev 判定（面板按 kind 判**重试钮**的排除面）。 */
export function isJevRecord(rec: AiSessionRecord | undefined): boolean {
    return rec?.kind === "jev";
}
