import { LETTERS, normalizeAnswerMd } from "./types";

/**
 * AI 生成选择题的选项洗牌：转换/生成 prompt 都让模型「先写正确项、
 * 再补干扰项」，输出顺序天然正确项居首 → 落盘答案恒为 A（真机
 * 20260825 用户反馈）。这里在规整后的题目 kramdown 上做 Fisher-Yates
 * 洗牌并同步改写答案字母，判分（按字母比对）与展示自然一致。
 *
 * 覆盖题型：single / multiple（顶层 option-*）与 steps（每步
 * step-k-option-* 各自洗）；judge/fill/cloze/match/essay/trans 无字母
 * 重排语义，原样返回。选项文本含位置敏感措辞（「以上都对」「A 和 B」
 * 一类）时跳过该组洗牌，避免语义错乱。
 */

/** 子块属性行（与 BankParse 同款）。 */
const PART_IAL = /^\{:[^\n]*custom-plugin-wengu-part="([a-z0-9-]+)"/;
/** 位置敏感措辞：洗牌会破坏指代关系，保留 AI 原序。 */
const POSITION_SENSITIVE = /(以上|上述|都不|都是|全都|全部|均正确|均错误|\b[A-D]\b\s*(?:和|与|及))/;

interface Block {
    part: string;
    body: string[];
    ial: string;
}

type Seg = { glue: string[] } | { block: Block };

/** 按 part IAL 行切段：IAL 是尾随行（缓冲在前才是该 part 的内容）；
 *  容器定界 {{{ / }}} 与容器 IAL 行不属于任何块体，保持 glue。 */
function splitBlocks(kd: string): Seg[] {
    const segs: Seg[] = [];
    let pend: string[] = [];
    const pushGlue = () => {
        if (pend.length > 0) {
            segs.push({ glue: pend });
            pend = [];
        }
    };
    for (const line of kd.split(/\r?\n/)) {
        const pm = PART_IAL.exec(line);
        if (pm) {
            segs.push({ block: { part: pm[1], body: pend, ial: line } });
            pend = [];
            continue;
        }
        if (/^\s*\{\{\{/.test(line) || /^\s*\}\}\}/.test(line) || /^\{:[^\n]*custom-plugin-wengu-q=/.test(line)) {
            pushGlue();
            segs.push({ glue: [line] });
            continue;
        }
        pend.push(line);
    }
    pushGlue();
    return segs;
}

function renderBlocks(segs: Seg[]): string {
    return segs
        .map((s) => ("block" in s ? `${s.block.body.join("\n")}\n${s.block.ial}` : s.glue.join("\n")))
        .join("\n");
}

/** 对一组选项段位做洗牌并重写答案字母；不可洗（太少/措辞敏感/答案
 *  非纯字母）时原样返回 false。 */
function shuffleGroup(
    segs: Seg[],
    optIdxs: number[],
    answerIdx: number | undefined,
    partName: (j: number) => string
): boolean {
    const n = optIdxs.length;
    if (n < 2 || answerIdx === undefined) return false;
    const answerBlock = segs[answerIdx] as { block: Block };
    const oldRun = normalizeAnswerMd(answerBlock.block.body.join("\n"))
        .toUpperCase()
        .replace(/[^A-Z]/g, "");
    if (!/^[A-Z]+$/.test(oldRun) || [...oldRun].some((ch) => LETTERS.indexOf(ch) >= n)) return false;
    const bodies = optIdxs.map((i) => (segs[i] as { block: Block }).block.body.join("\n"));
    if (bodies.some((b) => POSITION_SENSITIVE.test(b))) return false;
    let order: number[] = [];
    let newRun = oldRun;
    for (let tries = 0; tries < 10 && (order.length === 0 || newRun === oldRun); tries++) {
        order = [...Array(n).keys()];
        for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        const pos = new Map(order.map((old, j) => [old, j])); // 旧下标 → 新位置
        newRun = [...oldRun]
            .map((ch) => LETTERS[pos.get(LETTERS.indexOf(ch)) ?? 0])
            .sort()
            .join("");
    }
    if (order.length === 0) return false;
    for (let j = 0; j < n; j++) {
        const seg = segs[optIdxs[j]] as { block: Block };
        seg.block.body = bodies[order[j]].split(/\r?\n/);
        const name = partName(j);
        seg.block.part = name;
        seg.block.ial = seg.block.ial.replace(
            /custom-plugin-wengu-part="[a-z0-9-]+"/,
            `custom-plugin-wengu-part="${name}"`
        );
    }
    // 答案重写：只动与旧字母集同构的整段字母 run（标签/叙述里的其它词不碰）
    const oldSorted = [...oldRun].sort().join("");
    answerBlock.block.body = answerBlock.block.body.map((line) =>
        line.replace(/[A-Ha-h]+/g, (run) => ([...run.toUpperCase()].sort().join("") === oldSorted ? newRun : run))
    );
    return true;
}

/** 题目 kramdown 的选择题选项洗牌入口（extractQuestions 规整后调用）。 */
export function shuffleChoiceOptions(kd: string): string {
    const type = /custom-plugin-wengu-type="([a-z]+)"/.exec(kd)?.[1] ?? "";
    if (type !== "single" && type !== "multiple" && type !== "steps") return kd;
    const segs = splitBlocks(kd);
    if (type === "steps") {
        const byStep = new Map<number, { opts: number[]; ans?: number }>();
        segs.forEach((s, i) => {
            if (!("block" in s)) return;
            const m = /^step-(\d+)-option(?:-\d+)?$/.exec(s.block.part) ?? /^step-(\d+)$/.exec(s.block.part);
            const am = /^step-(\d+)-answer$/.exec(s.block.part);
            const k = Number(am?.[1] ?? m?.[1] ?? -1);
            if (k < 0) return;
            const g = byStep.get(k) ?? { opts: [] };
            if (am) g.ans = i;
            else if (m) g.opts.push(i);
            byStep.set(k, g);
        });
        for (const [k, g] of byStep) shuffleGroup(segs, g.opts, g.ans, (j) => `step-${k}-option-${j}`);
        return renderBlocks(segs);
    }
    const opts: number[] = [];
    let ans: number | undefined;
    segs.forEach((s, i) => {
        if (!("block" in s)) return;
        if (/^option(?:-\d+)?$/.test(s.block.part)) opts.push(i);
        else if (s.block.part === "answer") ans = i;
    });
    shuffleGroup(segs, opts, ans, (j) => `option-${j}`);
    return renderBlocks(segs);
}
