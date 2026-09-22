import { LETTERS } from "../../../types";
import type { DraftUnit } from "../draft/QuestionDraft";
import { POSITION_SENSITIVE } from "./PosSensitive";

/**
 * 选项组重排 / 答案字母重写的**内部实现**：single / multiple 的顶层选项组、
 * steps 的每步选项组，Fisher-Yates 洗牌后按同一映射重编答案字母。
 * `judge`/`fill`/`cloze`/`match`/`essay`/`trans` 无字母重排语义，原样跳过；
 * 含位置敏感措辞（「以上都对」一类，判据 `PosSensitive`）的组原样跳过。
 *
 * ⚠️ **本模块自 20260915（Issue #131）起在生成链上整体闲置**——四处写库
 * 调用点（转换 / 增量 / 出题 / 重生成）全撤，题库为「死形态」；消剧透改由
 * 展示层纯函数 `quiz/render/CardDisplayShuffle` 在进卡 mount 前现洗。
 *
 * ⚠️ **导出面已收窄**（Issue #214，20260922）：`shuffleDraftOptions` 入口、
 * 挤行拆行 `unpackPackedSingle`、及其专用单测整体删除——删实测零生产调用方
 * （存量数据不再兼容，见 Issue #214 的档一/档二口径）。本文件现已**无任何
 * 导出**；`POSITION_SENSITIVE` 的活消费方（BankRepair / CardDisplayShuffle）
 * 改从 `draft/PosSensitive.ts` 取。整个文件待另单整体删除。
 */

/** 选项组：组内选项部件下标 + 对应答案部件下标（ans<0=无答案不洗）。 */
interface OptGroup {
    opts: number[];
    ans: number;
}

/** 收集单元的全部选项组（键 ""=顶层；step-k=多步题第 k 步）。 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 无导出、待整文件另单删除
function collectGroups(d: DraftUnit): Map<string, OptGroup> {
    const g = new Map<string, OptGroup>();
    d.parts.forEach((p, i) => {
        const key = /^option/.test(p.name) ? "" : /^step-\d+-option/.exec(p.name)?.[0].replace(/-option.*$/, "");
        if (key !== undefined) {
            const cur = g.get(key) ?? { opts: [], ans: -1 };
            cur.opts.push(i);
            g.set(key, cur);
            return;
        }
        const am = /^answer$|^(step-\d+)-answer/.exec(p.name);
        if (!am) return;
        const ak = am[1] ?? "";
        const cur = g.get(ak) ?? { opts: [], ans: -1 };
        cur.ans = i;
        g.set(ak, cur);
    });
    return g;
}

/** 对一个选项组洗牌并重写答案字母；不可洗（太少/措辞敏感/答案非纯
 *  字母）时不动。字母映射：字母=渲染时按部件位置自动编（A=第 1 个），
 *  洗牌把原第 i 个部件的内容挪到第 j 位，答案字母随之 i→j 重编。 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 无导出、待整文件另单删除
function shuffleGroup(d: DraftUnit, grp: OptGroup): void {
    const n = grp.opts.length;
    if (n < 2 || grp.ans < 0) return;
    const ansPart = d.parts[grp.ans];
    const oldRun = ansPart.text.trim();
    if (!/^[A-Ha-h]+$/.test(oldRun) || [...oldRun.toUpperCase()].some((ch) => LETTERS.indexOf(ch) >= n)) return;
    const oldSorted = [...oldRun.toUpperCase()].sort().join("");
    const texts = grp.opts.map((i) => d.parts[i].text);
    if (texts.some((t) => POSITION_SENSITIVE.test(t))) return;
    let order: number[] = [];
    let newRun = oldSorted;
    for (let tries = 0; tries < 10 && (order.length === 0 || newRun === oldSorted); tries++) {
        order = [...Array(n).keys()];
        for (let i = n - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [order[i], order[j]] = [order[j], order[i]];
        }
        newRun = [...oldRun.toUpperCase()]
            .map((ch) => LETTERS[order.indexOf(LETTERS.indexOf(ch))])
            .sort()
            .join("");
    }
    if (order.length === 0 || newRun === oldSorted) return;
    // ⚠️ 解析文本**不改写**（Issue #176 收窄）：本模块已无字母映射器，
    //   洗牌只重排选项 + 重写答案字母——与展示层同口径（渲染/落库路径都不
    //   对用户文本猜字母）。
    for (let j = 0; j < n; j++) d.parts[grp.opts[j]].text = texts[order[j]];
    ansPart.text = newRun;
}
