import type { WenguDocStats } from "../../stats/StatsService";
import type { WordAiInput } from "../../word/service/WordAi";

/**
 * 独立小场景 prompt（20260910 自 word/WordAi 与 stats/StatsService 迁入
 * prompt 集中地，文本逐字保持）：单词 AI 复盘教练、统计学习建议。
 */

/** 单词复盘教练 prompt（W/L/C/T 行协议，档位动作锚定规则）。 */
export function wordReviewPrompt(inputs: WordAiInput[]): string {
    const list = inputs
        .map((e, i) => {
            const parts = [`${i + 1}. ${e.w}（${e.m.split("\n")[0]}）`];
            if (e.correct !== undefined) parts.push(e.correct ? "答对" : "答错");
            if (e.count > 0) parts.push(`累计答错 ${e.count} 次`);
            if (e.mode && e.ms !== undefined) {
                parts.push(`${e.mode} 有效用时 ${(e.ms / 1000).toFixed(1)} 秒${e.over ? "（超时）" : ""}`);
            }
            if (e.typed) parts.push(`拼成了「${e.typed}」`);
            if (e.confused) parts.push(`学生自述认成了：${e.confused}`);
            return parts.join("，");
        })
        .join("\n");
    return `你是考研单词复习教练。下面是学生的作答数据，请逐词判断掌握程度并安排复习。
判定规则（严格执行）：
- 秒答且答对 → L: up
- 答对但用时偏长或超时 → L: keep（不升档）
- 答错、超时、或把该词认成了别的词 → L: down
- 学生拼成了另一个真词、或自述认成了某词（可能是模糊描述，推断成最可能的英文单词）→ C: 写出那个词
输出格式：每个词一组行，组间空行，除此之外不要输出任何文字：
W: 单词原样
L: up、keep 或 down
C: 混淆对象单词（仅存在时输出）
T: 辨析提示（仅 C 词输出：那个词的中文意思 + 一句话区别，不超过 60 个字）
单词列表：
${list}`;
}

/** AI 学习建议 prompt：文档轮次成绩 + 错题清单 → 趋势/薄弱点/建议。 */
export function buildStatsPrompt(s: WenguDocStats): string {
    const rounds = s.rounds
        .map(
            (r, i) =>
                `第${i + 1}轮 ${new Date(r.startedAt).toLocaleString("zh-CN", {
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                })} ${r.correct}/${r.answered}(${r.answered > 0 ? Math.round((r.correct / r.answered) * 100) : 0}%) 用时${Math.round(
                    r.elapsedSec / 60
                )}分钟`
        )
        .join("；\n");
    const wrongs = s.wrongs
        .map(
            (w) =>
                `题${w.index}「${w.stemSummary}」${
                    w.knowledge ? `知识点:${w.knowledge} ` : ""
                }错${w.wrongCount}次 最近${w.right === "1" ? "已对" : "仍错"}`
        )
        .join("；\n");
    return `你是刷题统计助手。根据一份习题文档的历史刷题统计给出学习建议，不超过 300 字，分三段：总体趋势（正确率走势与用时变化）；薄弱点（从错题的知识点与错次归纳，没有错题就点评掌握度）；下一步建议（重刷策略、优先攻克的知识点）。
文档：《${s.docTitle}》共 ${s.total} 题，已刷 ${s.rounds.length} 轮
逐轮成绩：${rounds || "（暂无轮次）"}
错题清单：${wrongs || "（无错题）"}
只输出建议正文，不要客套。`;
}
