import { LETTERS, normAnswerText, optionComparable, QuestionType } from "../types";
import type { WenguQuestion, WenguStep } from "../types";

/**
 * 判分纯函数（从 QuestionService 拆出，无 IO）：客观题/多步题的
 * 自动判分与选项描色判断。对真实转换结果容错：字母答案按字母比、
 * 内容答案比选项内容、比较对大小写/空白/`$` 定界不敏感。
 */

/** 答案的多接受形态（fill 的 `a|b`、内容答案顿号分隔等）。 */
function acceptedAnswers(answer: string): string[] {
    return answer
        .split(/\||[,，、;；]/)
        .map(normAnswerText)
        .filter(Boolean);
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
                对: "√",
                T: "√",
                TRUE: "√",
                X: "×",
                x: "×",
                错: "×",
                F: "×",
                FALSE: "×",
                "×": "×",
            };
            return (map[normAnswerText(submitted)] ?? normAnswerText(submitted)) === (map[ansNorm] ?? ansNorm);
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
 * 多步题单步判分：method 步任一可行方法即对（answer 为可行字母集合）；
 * result 步比字母（或把所选项内容与答案内容比对，同 single 容错）。
 */
export function gradeStep(step: WenguStep, submitted: string): boolean {
    const ansNorm = normAnswerText(step.answer);
    const subNorm = normAnswerText(submitted);
    if (/^[A-Z]+$/.test(ansNorm)) {
        return step.kind === "method" ? ansNorm.includes(subNorm) : subNorm === ansNorm;
    }
    const letters = submitted.toUpperCase().replace(/[^A-Z]/g, "");
    if (letters.length === 1) {
        const idx = LETTERS.indexOf(letters);
        if (idx >= 0 && idx < step.optionMd.length) {
            return optionComparable(step.optionMd[idx]) === ansNorm;
        }
    }
    return subNorm === ansNorm;
}

/** 多步题某选项是否属于正确项（method 步=可行集合；判分后描色用）。 */
export function stepOptionIsRight(step: WenguStep, idx: number): boolean {
    const ansNorm = normAnswerText(step.answer);
    const letter = LETTERS[idx] ?? "";
    if (/^[A-Z]+$/.test(ansNorm)) return ansNorm.includes(letter);
    return step.optionMd[idx] !== undefined && optionComparable(step.optionMd[idx]) === ansNorm;
}

/** slots 题单空判分：比字母（cloze 的 slot answer 可能是内容，同 single 容错）。 */
export function gradeSlot(slot: { optionMd: string[]; answer: string }, submitted: string): boolean {
    const ansNorm = normAnswerText(slot.answer);
    const subNorm = normAnswerText(submitted);
    if (/^[A-Z]+$/.test(ansNorm)) return ansNorm.includes(subNorm);
    const letters = submitted.toUpperCase().replace(/[^A-Z]/g, "");
    if (letters.length === 1) {
        const idx = LETTERS.indexOf(letters);
        if (idx >= 0 && idx < slot.optionMd.length) {
            return optionComparable(slot.optionMd[idx]) === ansNorm;
        }
    }
    return subNorm === ansNorm;
}

/** slots 题某选项是否属于该空正确项（判分后描色用）。 */
export function slotOptionIsRight(slot: { optionMd: string[]; answer: string }, idx: number): boolean {
    const ansNorm = normAnswerText(slot.answer);
    const letter = LETTERS[idx] ?? "";
    if (/^[A-Z]+$/.test(ansNorm)) return ansNorm.includes(letter);
    return slot.optionMd[idx] !== undefined && optionComparable(slot.optionMd[idx]) === ansNorm;
}
