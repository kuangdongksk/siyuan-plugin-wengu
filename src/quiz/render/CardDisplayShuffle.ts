import { LETTERS, type WenguQuestion, type WenguStep } from "../../types";
import { POSITION_SENSITIVE } from "../../convert/service/draft/OptionShuffle";

/**
 * **展示层**选项洗牌（Issue #131，20260915）：题库与题源文档统一为
 * 「死形态」——选项按原文顺序、答案字母指向原文位置、解析不含任何
 * 选项字母（协议强制 `〔opt:X〕` 标记、落库前已换成选项文本）。消剧透
 * 因此从「生成期洗牌」搬到「展示期现洗」：进卡 mount 前按题现洗一次，
 * 同一道题两次进卡顺序不同（验收 4），而库里/预览里都还是原文原序
 * （验收：预览显示原序）。
 *
 * 洗牌对象：
 *   - 顶层选项组（single/multiple）——答案 `q.answer` 字母随同一映射重写；
 *   - steps 的**每一步**选项组（各步独立洗）——`step.answer` 同步重写；
 *   - cloze/match 不在内：逐空答案在 `slot-k-answer` 且解析不引字母；
 *     match 的候选池与槽位顺序共用同一条 `q.answer` 字母串，洗池子等于
 *     洗答案、跨空一致性无从保证 ⇒ 维持现状不洗。
 *
 * 位置敏感措辞组跳过（`POSITION_SENSITIVE`，口径与生成期洗牌同源）——
 * 「以上都对」「A 和 B」类选项一旦重排就指代错乱。
 *
 * **纯函数 + 返回新对象**：入参是题库视图（与 `v.list` 同一批对象，
 * 会话恢复/作答记账都按 id 走），原地改会污染整卷（题号栏顺序、
 * 聚合视图缓存、轮次会话快照）。
 *
 * 判分口径不变：`gradeQuestion` 按字母比答案、按 idx 描色——展示序变了，
 * 字母与选项的对应关系随之变了，两者仍自洽（洗后答案指向同一选项
 * 文本，见 CardDisplayShuffle.test.ts）。
 */

/** 随机源（缺省 Math.random；测试注入确定性替身）。 */
export type Rand = () => number;

/** 一次 Fisher-Yates：返回「新第 j 位放原第 order[j] 位」的排列。 */
function permute(n: number, rand: Rand): number[] {
    const order = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

/** 选项文本含位置敏感措辞时不洗该组（保留原序）。 */
function sensitive(opts: string[]): boolean {
    return opts.some((t) => POSITION_SENSITIVE.test(t));
}

/** 字母串按同一映射重写；越界（超选项数）字母原样保留。 */
function remapRun(run: string, toIdx: Map<number, number>): string {
    const out: string[] = [];
    for (const ch of run.toUpperCase()) {
        const i = LETTERS.indexOf(ch);
        const j = toIdx.get(i);
        out.push(j === undefined ? ch : LETTERS[j]);
    }
    return out.join("");
}

/** 洗一组选项并重写其答案字母（不可洗时原样返回入参引用）。 */
function shuffleGroup(opts: string[], answer: string, rand: Rand): { opts: string[]; answer: string } {
    const n = opts.length;
    if (n < 2 || sensitive(opts)) return { opts, answer };
    const order = permute(n, rand);
    if (order.every((v, i) => v === i)) return { opts, answer }; // 恒等排列：不改
    // order[j] = 新第 j 位放原第几个 ⇒ 字母映射「原第 i 位 → 新第 j 位」
    const toIdx = new Map<number, number>();
    for (let j = 0; j < n; j++) toIdx.set(order[j], j);
    return { opts: order.map((i) => opts[i]), answer: remapRun(answer, toIdx) };
}

/** 单步：洗选项 + 重写步答案。 */
function shuffleStep(s: WenguStep, rand: Rand): WenguStep {
    const r = shuffleGroup(s.optionMd ?? [], s.answer ?? "", rand);
    return r.opts === s.optionMd ? s : { ...s, optionMd: r.opts, answer: r.answer };
}

/**
 * 进卡 mount 前对一道题做展示层洗牌（预览/渐进**不调用**——预览要看
 * 死形态对照原文）。无选项组 / 不可洗时返回**原对象**（引用相等，
 * 调用方可据此判断零改动）。
 */
export function shuffleForDisplay(q: WenguQuestion, rand: Rand = Math.random): WenguQuestion {
    if (q.type === "steps") {
        const steps = (q.steps ?? []).map((s) => shuffleStep(s, rand));
        if (steps.every((s, i) => s === q.steps![i])) return q;
        return { ...q, steps };
    }
    if (q.type !== "single" && q.type !== "multiple") return q;
    const opts = q.optionMd ?? [];
    const r = shuffleGroup(opts, q.answer ?? "", rand);
    return r.opts === opts ? q : { ...q, optionMd: r.opts, answer: r.answer };
}

/**
 * 整卷洗牌（`buildDrillUnits` **之前**调用一次）：逐题换新对象，
 * **卷内顺序不变**——题号栏/题集分组/材料链全部按原下标，只有卡内
 * 选项变了。
 */
export function shuffleListForDisplay(list: WenguQuestion[], rand: Rand = Math.random): WenguQuestion[] {
    return list.map((q) => shuffleForDisplay(q, rand));
}

/** 该题是否有可洗的选项组（审查/测试对照用）。 */
export function isShufflable(q: WenguQuestion): boolean {
    if (q.type === "steps") return (q.steps ?? []).some((s) => (s.optionMd?.length ?? 0) > 1);
    if (q.type !== "single" && q.type !== "multiple") return false;
    return (q.optionMd?.length ?? 0) > 1;
}
