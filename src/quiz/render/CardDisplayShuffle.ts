import { LETTERS, type WenguQuestion, type WenguStep } from "../../types";
import { POSITION_SENSITIVE } from "../../convert/service/draft/OptionShuffle";

/**
 * **展示层**选项洗牌（Issue #131，20260915）：题库与题源文档统一为
 * 「死形态」——选项按原文顺序、答案字母指向原文位置。消剧透因此从
 * 「生成期洗牌」搬到「展示期现洗」：进卡 mount 前按题现洗一次，同一道
 * 题跨轮进卡顺序不同，而库里/预览里都还是原文原序（预览显示原序）。
 *
 * ⚠️ **本模块只重映射 `answer` 字母，绝不碰解析/题干文本**（Issue #176
 * 收窄，20260919）：`9d998f1` 曾试过「洗选项时同步改写解析里的字母引用」，
 * 但那是**在渲染路径上对用户文本现猜字母**——落库判据（convert 层那套
 * 「哪个字母算选项引用」）对 `维生素A`/`A4纸`/引文体字母的误伤面不可接受，
 * 而且每洗一次牌就要在用户眼前静默跑一遍。
 * 用户拍板：存量带裸字母的旧记录由**重新转换**消化（落库链
 * `normalizeDraftOptionRefs` 产出无字母引文），插件不再在展示层猜。
 * 锁见 `ShuffleRemapInvariants.test.ts`：任意种子 N 组洗牌下解析/题干
 * **逐字节不动**。
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
 * ⚠️ **排列按 (轮次, 题 id) 定种子，禁直接用 Math.random**（Issue #131
 * 评审修正）：会话与题库只记**字母**（`submitted`/`lastAnswer`），排列表
 * 达式只在卡里。若每次重渲染都重掷（拉开侧栏、改设置、收卷重渲染、
 * 重开页签…），恢复出来的字母就指到**别的选项**上——表现为「结果行说
 * 答对、选项却标红」「高亮错项」。故排列 = 纯函数 `(会话 id, 题 id)`：
 *     - 同轮内恒定 ⇒ 恢复的字母始终指向当初那项，判分/描色自洽；
 *     - 换轮（新会话 id）即换排列 ⇒ 消剧透（记「答案在 B」跨轮无效）；
 *     - 会话 id 落盘（HistoryStore）⇒ 重开页签/「继续上次」也能复原同一
 *       排列（不是靠内存缓存，故跨进程依然成立）。
 *
 * 判分口径不变：`gradeQuestion` 按字母比答案、按 idx 描色——展示序变了，
 * 字母与选项的对应关系随之变了，两者仍自洽（洗后答案指向同一选项
 * 文本，见 CardDisplayShuffle.test.ts）。
 */

/** 随机源（注入用：单测给确定性替身）。 */
export type Rand = () => number;

/** 一轮 = 一个 scope（QuizShell 传会话 id）；"" = 尚未开轮。 */
export interface ShuffleScope {
    /** 排列种子的一部分（会话 id；缺省 ""）。 */
    scope?: string;
    /** 显式随机源（单测注入；缺省按 (scope, 题 id) 定种子）。 */
    rand?: Rand;
}

/** 一次 Fisher-Yates：返回「新第 j 位放原第 order[j] 位」的排列。 */
function permute(n: number, rand: Rand): number[] {
    const order = [...Array(n).keys()];
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

/** 字符串 → 32 位散列（FNV-1a；只用于定随机种子，非密码学用途）。 */
function hash32(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** mulberry32：给定种子的确定性 PRNG（同 (scope, qid) ⇒ 同排列）。 */
function seededRand(scope: string, qid: string): Rand {
    let a = (hash32(`${scope}\u0000${qid}`) + 0x6d2b79f5) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** 选项文本含位置敏感措辞时不洗该组（保留原序）。 */
function sensitive(opts: string[]): boolean {
    return opts.some((t) => POSITION_SENSITIVE.test(t));
}

/** 纯字母答案串（死形态下 ans 只有「字母」与「内容」两种形态）。 */
const LETTER_RUN = /^[A-Za-z]+$/;

/** 按排列重写答案的字母串，**并升序重排**——用户点选经
 *  `types.toggleLetters` 恒得升序串，`gradeQuestion` 对纯字母答案又是
 *  整串相等比较（不排序），答案侧不排序则「正确 AD、点选 DA」字符串不等
 *  ⇒ 多选题判分必错（Issue #131 评审实录：洗后 `answer="DC"`，用户按
 *  点选顺序提交 `CD`，判为错）。非纯字母（内容答案如 `$e^2$`）原样返回：
 *  它按选项**文本**集合比对，与位置无关，也不该被动大小写/顺序。 */
function remapAnswer(answer: string, toIdx: Map<number, number>): string {
    const run = answer.trim();
    if (!LETTER_RUN.test(run)) return answer;
    const mapped = [...run.toUpperCase()].map((ch) => {
        const j = toIdx.get(LETTERS.indexOf(ch));
        return j === undefined ? ch : LETTERS[j];
    });
    return mapped.sort().join("");
}

/** 掷一组选项的排列；不可洗（选项不足两个 / 位置敏感措辞）返回 null。
 *
 *  恒等排列**绝不返回**（重掷几次 + 兜底对调首两位）：n=2 时恒等概率 1/2、
 *  n=3 时 1/6——原样呈现就是「像没洗」，消剧透失效（验收要的是进卡即
 *  换序）。兜底是确定性的，不靠概率撞。 */
function drawOrder(opts: string[], rand: Rand): number[] | null {
    const n = opts.length;
    if (n < 2 || sensitive(opts)) return null;
    const identity = (o: number[]): boolean => o.every((v, i) => v === i);
    let order = permute(n, rand);
    for (let t = 0; t < 4 && identity(order); t++) order = permute(n, rand);
    if (identity(order)) [order[0], order[1]] = [order[1]!, order[0]!]; // 兜底：首两位对调
    return order;
}

/** 按排列重排选项 + 重写答案字母。**逐项比对**（不是比引用）：恒等排列
 *  下 `order.map()` 会得到内容相同的新数组，只看引用会把「答案规范化后
 *  变了」的改动误判成零改动。两者都逐字未变 ⇒ `changed:false`（调用方
 *  据此原样返回入参对象）。 */
function applyOrder(
    opts: string[],
    answer: string,
    order: number[] | null
): { opts: string[]; answer: string; changed: boolean } {
    if (!order) return { opts, answer, changed: false };
    // order[j] = 新第 j 位放原第几个 ⇒ 字母映射「原第 i 位 → 新第 j 位」
    const toIdx = new Map<number, number>();
    for (let j = 0; j < order.length; j++) toIdx.set(order[j], j);
    const nextOpts = order.map((i) => opts[i]);
    const nextAnswer = remapAnswer(answer, toIdx);
    const changed = nextAnswer !== answer || nextOpts.some((t, i) => t !== opts[i]);
    return { opts: nextOpts, answer: nextAnswer, changed };
}

/** 声明式卡内容洗牌（`""`=顶层，`step-k`=第 k 步）：选项重排 + 答案重写。
 *
 *  ⚠️ **解析（`solutionMd`）与题干（`stemMd`）一律不改写**（Issue #176
 *  收窄，20260919）：`9d998f1` 曾按同一份 order 映射改写解析里的字母引用，
 *  那是「展示层猜字母」——误伤面不可接受（见文件头）。存量由重新转换消化，
 *  解析文本进卡后**逐字与库内一致**。 */
interface CardShuffle {
    opts: string[];
    answer: string;
    patch: (next: { opts: string[]; answer: string }) => void;
}

/** 洗一组并回填（不可洗/零改动 ⇒ 不回填，调用方据此判断是否换新对象）。 */
function shuffleCardGroup(c: CardShuffle, rand: Rand): boolean {
    const order = drawOrder(c.opts, rand);
    const r = applyOrder(c.opts, c.answer, order);
    if (!r.changed) return false;
    c.patch({ opts: r.opts, answer: r.answer });
    return true;
}

/** 单步：洗选项 + 重写步答案（`WenguStep` 无解析部件——逐步解析**当前
 *  不入协议**，见 `OptionRefReplace` 模块头）。 */
function shuffleStep(s: WenguStep, rand: Rand): WenguStep {
    const opts = s.optionMd ?? [];
    let out = s;
    shuffleCardGroup(
        {
            opts,
            answer: s.answer ?? "",
            patch: (n) => {
                out = { ...s, optionMd: n.opts, answer: n.answer };
            },
        },
        rand
    );
    return out;
}

/**
 * 进卡 mount 前对一道题做展示层洗牌（预览/渐进**不调用**——预览要看
 * 死形态对照原文）。无选项组 / 不可洗时返回**原对象**（引用相等，
 * 调用方可据此判断零改动）。
 *
 * ⚠️ 生产路径一律走 `shuffleListForDisplay`（排列按会话定种子）；本函数
 * 是「单题 + 显式随机源」形态，供单测与需要一次性洗牌的调用方使用。
 */
export function shuffleForDisplay(q: WenguQuestion, rand: Rand = Math.random): WenguQuestion {
    if (q.type === "steps") return shuffleStepsForDisplay(q, rand);
    if (q.type !== "single" && q.type !== "multiple") return q;
    const opts = q.optionMd ?? [];
    let out = q;
    shuffleCardGroup(
        {
            opts,
            answer: q.answer ?? "",
            patch: (n) => {
                out = { ...q, optionMd: n.opts, answer: n.answer };
            },
        },
        rand
    );
    return out;
}

/** steps：各步独立洗（各步答案各自重写）。
 *
 *  ⚠️ 题级与逐步解析都**不改写**（Issue #176 收窄，20260919）：逐步题各步
 *  选项组各有自己的字母映射，题级解析里的「B」指哪一步无从判定——猜错就是
 *  把指代搬错位；逐步解析当前也不入协议（见 `OptionRefReplace` 模块头）。 */
function shuffleStepsForDisplay(q: WenguQuestion, rand: Rand): WenguQuestion {
    const src = q.steps ?? [];
    const steps = src.map((s) => shuffleStep(s, rand));
    if (steps.every((s, i) => s === src[i])) return q;
    return { ...q, steps };
}

/**
 * 整卷洗牌（`buildDrillUnits` **之前**调用一次）：逐题换新对象，
 * **卷内顺序不变**——题号栏/题集分组/材料链全部按原下标，只有卡内
 * 选项变了。
 *
 * 每题的排列由 `(scope, q.id)` 定种子（见文件头：会话只记字母，排列
 * 必须同轮恒定）；`scope` 取当前会话 id，未开轮传 ""。
 */
export function shuffleListForDisplay(list: WenguQuestion[], opts: ShuffleScope = {}): WenguQuestion[] {
    const { scope = "", rand } = opts;
    return list.map((q) => shuffleForDisplay(q, rand ?? seededRand(scope, q.id)));
}

/** 该题是否有可洗的选项组（审查/测试对照用）。 */
export function isShufflable(q: WenguQuestion): boolean {
    if (q.type === "steps") return (q.steps ?? []).some((s) => (s.optionMd?.length ?? 0) > 1);
    if (q.type !== "single" && q.type !== "multiple") return false;
    return (q.optionMd?.length ?? 0) > 1;
}
