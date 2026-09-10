import type { WenguQuestion, WenguStep } from "../../types";
import { baseQid, LETTERS, optionDisplayMd } from "../../types";
import type { WenguSession } from "../../quiz/service/HistoryStore";
import { mmss } from "../../ui/shared";
import { CAUSE_LIST } from "./common";

/**
 * 判分/复核族 prompt（20260910 自 quiz/service/AiJudge 与 quiz/render/
 * RoundReport 迁入 prompt 集中地，文本逐字保持）：brief 思路验证、英语
 * 作文/翻译判卷、定位线索复核、客观错题批量归因、方法步申诉、steps
 * 实时引导、一轮判卷分析报告。
 */

/** brief 判分 prompt（三态 + 错因；thought=「思路」折叠区推导备注）。 */
export function buildBriefPrompt(q: WenguQuestion, mine: string, thought: string): string {
    const answer = [q.answer, q.solutionMd].filter(Boolean).join("\n\n") || "（无参考答案）";
    const thoughtBlock = thought ? `\n【学生思路备注】\n${thought}` : "";
    return `你是刷题判分助手。对照参考答案判断学生的作答与思路。
只看学科上的正确性：思路可行即 right；方向对但有明显缺口算 partial；方向错误算 wrong。
输出严格三行，格式之外不要输出任何文字：
VERDICT: right 或 partial 或 wrong
COMMENT: 一句话点评（对在哪/偏在哪，不超过 60 字）
CAUSE: 错因归类，只能从「${CAUSE_LIST}」里选一个；verdict 为 right 时输出 无
【题目】
${q.stemMd ?? ""}
【参考答案】
${answer}
【学生作答】
${mine}${thoughtBlock}`;
}

/** 英语作文 rubric 判分 prompt（SCORE 并入评语展示）。 */
export function buildEssayPrompt(q: WenguQuestion, mine: string): string {
    const model = [q.solutionMd].filter(Boolean).join("\n\n") || "（无范文）";
    return `你是考研英语作文阅卷助手。按考试评分标准给这篇学生作文判分。
评分维度：内容是否切题、组织结构是否清晰、语言准确性与多样性、格式与语域是否得当。
输出严格三行，格式之外不要输出任何文字：
SCORE: 分数/满分（如 14/20；题目未标满分按 20 分制）
VERDICT: right（达到该题平均分以上）或 partial（基本成型但有明显缺陷）或 wrong（严重偏题/错误密集）
COMMENT: 两句以内点评（一个最突出的优点 + 一个最该改的问题）
【题目】
${q.stemMd ?? ""}
【范文】
${model}
【学生作文】
${mine}`;
}

/** 英语翻译采分点判分 prompt。 */
export function buildTransPrompt(q: WenguQuestion, mine: string): string {
    const ref = [q.answer, q.solutionMd].filter(Boolean).join("\n\n") || "（无参考译文）";
    return `你是考研英语翻译阅卷助手。对照参考译文与采分点给学生的译文判定。
关注：关键采分点（词组/从句结构）是否译出、有无漏译错译、汉语是否通顺；整体大意对但个别点缺失算 partial。
输出严格两行，格式之外不要输出任何文字：
VERDICT: right 或 partial 或 wrong
COMMENT: 一句话点评（缺失/译错的采分点，不超过 60 字）
【原文】
${q.stemMd ?? ""}
【参考译文与采分点】
${ref}
【学生译文】
${mine}`;
}

/** 定位线索复核 prompt（M5：hit/near/miss 三态）。 */
export function buildCluePrompt(materialBody: string, q: WenguQuestion, submitted: string, clues: string[]): string {
    return `你是考研英语阅读的定位复核助手。学生在阅读文章后做题时，为该题标注了他认为的「定位线索」文段；请判断这些线索是否真的是该题答案的定位依据。
判定标准：hit=线索包含该题答案的出处句；near=线索落在相关段落但未覆盖定位句；miss=与该题无关。
输出严格两行，格式之外不要输出任何文字：
CLUE: hit 或 near 或 miss
COMMENT: 一句话点评（定位对在哪/错在哪，可指出正确定位应在的方向）
【文章】
${materialBody}
【题目】
${q.stemMd ?? ""}
【学生所选】
${submitted || "（未作答）"}
【学生标注的线索】
${clues.map((c, i) => `${i + 1}. ${c}`).join("\n")}`;
}

/** 客观错题批量归因 prompt（收卷一次搭车，输入=编号|题干|我的答案|正确答案 行）。 */
export function wrongCausesPrompt(lines: string): string {
    return `你是刷题错因分析器。下面是一轮刷题中答错的客观题（编号|题干|我的答案|正确答案）。逐题判断最可能的错因，只输出 JSON，格式之外不要输出任何文字：
{"1":"概念不清","3":"计算失误"}
错因只能从「${CAUSE_LIST}」里选。
题目：
${lines}`;
}

/** 方法步申诉复核 prompt（出题时标注的可行集合可能标漏，AI 独立复核）。 */
export function buildAppealPrompt(q: WenguQuestion, step: WenguStep, chosen: string): string {
    const options = step.optionMd.map((md, i) => `${LETTERS[i]}. ${optionDisplayMd(md)}`).join("\n");
    const answer = [q.answer, q.solutionMd].filter(Boolean).join("\n\n") || "（无参考解答）";
    return `你是解题方法复核助手。一道多步引导题的「选方法」步骤，出题时标注的可行方法集合可能标漏；学生认为自己所选的方法其实可行，请你独立判断。
只依据学科正确性：该方法能走通本题（即使比参考路径更绕）即可行。
输出严格两行，格式之外不要输出任何文字：
FEASIBLE: yes 或 no
COMMENT: 一句话理由（可行时说明如何走通；不可行时指出问题所在）
【题目】
${q.stemMd ?? ""}
【参考解答】
${answer}
【该步候选方法】
${options}
【出题时标注的可行集合】
${step.answer}
【学生所选方法】
${chosen}`;
}

/** steps 实时引导出下一步 prompt（跟随学生已选方法）。 */
export function buildRealtimePrompt(
    q: WenguQuestion,
    history: { stem: string; letter: string; chosen: string; ok: boolean }[]
): string {
    const done =
        history.length === 0
            ? "（尚未开始，请先出第一步）"
            : history
                  .map(
                      (h, i) => `第${i + 1}步「${h.stem}」学生选 ${h.letter}. ${h.chosen}${h.ok ? "（对）" : "（错）"}`
                  )
                  .join("；");
    const answer = [q.answer, q.solutionMd].filter(Boolean).join("\n\n") || "（无参考解答）";
    return `你是解题引导助手。根据题目与参考解答，生成多步引导作答的「下一步」：学生逐步选择方法与中间结果，你为每一步出选择题。
规则：
- 尚未开始时，第一步通常是 method 步（选方法）：选项为候选方法，ANSWER 列出**全部可行方法**的字母（如 AB）；学生任选可行方法都算对。
- 之后是 result 步：按学生实际选择的方法出该步的中间结果，ANSWER 是唯一正确字母，干扰项来自常见计算错误。
- 学生选了非参考路径的可行方法时，后续 result 步改按该方法出中间结果。
- 参考解答已走完（或只剩最终结论已被作答）时只输出一行 DONE: yes。
输出严格格式（格式之外不要输出任何文字）：
TYPE: method 或 result
PROMPT: 本步引导语（如「第 2 步 · 等价无穷小代换：本步化简得（ ）」）
OPTIONS:
- A. 选项一
- B. 选项二
- C. 选项三
- D. 选项四
ANSWER: 可行字母集合（method 步，如 AB）或唯一字母（result 步，如 C）
【题目】
${q.stemMd ?? ""}
【参考解答】
${answer}
【已完成步骤】
${done}`;
}

/** 把一轮的会话结果按题目块 id 聚合（多步题的 qid#k 条目合并：
 *  ok=全步对、sec=各步求和；verdict 保留 brief 的 partial 标记）。
 *  分析 prompt 的每题行与轮报图表共用（RoundReportApp 经此导入）。 */
export function byBaseQid(s: WenguSession): Map<string, { ok: boolean; sec: number; verdict?: string }> {
    const out = new Map<string, { ok: boolean; sec: number; verdict?: string }>();
    for (const r of s.results) {
        const b = baseQid(r.qid);
        const cur = out.get(b);
        out.set(b, {
            ok: cur ? cur.ok && r.ok : r.ok,
            sec: (cur?.sec ?? 0) + r.sec,
            verdict: cur?.verdict ?? r.verdict,
        });
    }
    return out;
}

/** 一轮判卷分析 prompt（总体/薄弱点/思路点评/建议；带各题思路时重点点评思路）。
 *  入参收结构子集，RoundReport 的完整模型天然可赋值。 */
export function buildAnalysisPrompt(m: {
    session: WenguSession;
    list: WenguQuestion[];
    rounds: WenguSession[];
    totalSec: number;
    overtimeSec: number;
}): string {
    const { session: s, list, rounds } = m;
    const byQid = byBaseQid(s);
    const thoughts = s.thoughts ?? {};
    const hasThoughts = Object.keys(thoughts).length > 0;
    const perQ = list
        .map((q, i) => {
            const r = byQid.get(q.id);
            const label = q.knowledge || q.chapter || String(i + 1);
            // partial=方向对但有缺口（统计记错），AI 分析要单独点名
            const state = !r ? "未答" : r.verdict === "partial" ? "部分正确" : r.ok ? "对" : "错";
            const base = r ? `${i + 1}. ${label} ${state} ${r.sec ?? 0}s` : `${i + 1}. ${label} 未答`;
            return thoughts[q.id] ? `${base}｜思路：${thoughts[q.id]}` : base;
        })
        .join("；\n");
    const history = rounds.map((r, i) => `第${i + 1}轮 ${r.correct}/${r.answered}`).join("；");
    const overtime = m.overtimeSec > 0 ? `；超时 ${mmss(m.overtimeSec)}` : "";
    const thoughtRule = hasThoughts
        ? "【思路判卷】逐条点评带「思路」的题（按题号）：思路方向是否正确、卡在哪一步、下次该怎么想；思路与答案对错不一致的要点出来。"
        : "";
    return `你是刷题判卷助手。根据下面的一轮刷题数据给出分析报告，不超过 300 字，分四段：总体评价；薄弱知识点与明显偏慢的题（指出题号）；思路点评；下一轮建议。${thoughtRule}
本轮：作答 ${s.answered}/${list.length}，答对 ${s.correct}；计时方式 ${s.mode}；总用时 ${mmss(m.totalSec)}${overtime}
每题：${perQ}
历史轮次：${history}
只输出报告正文，不要客套。`;
}
