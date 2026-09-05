import { LETTERS, normalizeType } from "../../types";
import { POSITION_SENSITIVE } from "../../convert/service/OptionShuffle";
import { stripIal } from "./BankParse";
import { replaceRecordKramdown } from "./BankRegen";
import type { QuestionBank } from "./QuestionBank";

/**
 * 「选项挤行」体检与修复（20260905 概率篇真机踩坑）：AI 无视「每个
 * 选项一个 @@P opt」把全部选项一行一个塞进同一部件时，落库 kramdown
 * 的选项块只有首行带 `- A. ` 标签、其余行成续行——刷题侧只剩 1 个选项
 * （协议规定正确项写最前，恰是首行，即「只剩正确选项」）。文本一条
 * 没丢，这里做**确定性**修复：按行拆回独立选项、按「首行=正确项」
 * 重写答案字母（原字母口径不可信——AI 混用原卷字母与重排字母）、
 * 洗牌消「恒 A」剧透后经 replaceRecordKramdown 原题位回写（qid/题集/
 * 作答统计随记录保留，容器 IAL 原样 → src-key/src-hash 不动，增量
 * 重转换口径不受影响）。
 *
 * 生成侧的同类预防在 OptionShuffle.unpackPackedSingle（拆行发生在
 * draft 层，四个生成入口共用）；本模块只清偿存量。steps/cloze 的步/
 * 空选项组不在本口径（顶层损坏形态走单题重生成）。
 */

const PART_IAL = /^\{:[^\n]*custom-plugin-wengu-part="([a-z0-9-]+)"/;
const CONTAINER_IAL = /^\{:[^\n]*custom-plugin-wengu-(?:q|material)=/;
/** 选项块名（option / option-N）。 */
const OPT_BLOCK = /^option(-\d+)?$/;
/** renderUnit 写出的选项条目标签「- A. 」。 */
const ITEM_LABEL = /^-\s+[A-Za-z]\.?\s*/;
/** splitOptionMd 同款顶层列表标记（判「已是多选项的正常合并块」）。 */
const LIST_ITEM = /^(?:[-*+]|\d+[.)])\s/;
/** 解析里明示答案的措辞（预览的人工复核线索，口径矛盾≠错）。 */
const SAID_LETTER = /(?:答案应选|答案选|故选|应选|选)\s*[（(]?\s*([A-Ha-h])\s*[）)]?/g;

/** 不可确定性修复的原因（预览文案用）。 */
export type OptionRepairRegenReason = "packed-multi" | "answer" | "noopts" | "one";

/** part 块定位：内容行区间 [from, ial) + 尾随 IAL 行号。 */
interface PartBlock {
    part: string;
    from: number;
    ial: number;
}

interface ScannedKd {
    containerType: string;
    blocks: PartBlock[];
    /** 解析口径的顶层选项数（列表标记行数，空块计 1——splitOptionMd 同款）。 */
    optCount: number;
    optBlock: PartBlock | undefined;
    lines: string[];
}

/** 按行扫描（语义同 BankParse.splitParts，但保留行号供原位回写）。 */
function scanKd(kd: string): ScannedKd {
    const lines = kd.split(/\r?\n/);
    const blocks: PartBlock[] = [];
    let from = 0;
    let containerType = "";
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*\{\{\{/.test(lines[i]) || /^\s*\}\}\}/.test(lines[i])) {
            from = i + 1;
            continue;
        }
        const pm = PART_IAL.exec(lines[i]);
        if (pm) {
            blocks.push({ part: pm[1], from, ial: i });
            from = i + 1;
            continue;
        }
        if (CONTAINER_IAL.test(lines[i])) {
            containerType = /custom-plugin-wengu-type="([^"]*)"/.exec(lines[i])?.[1] ?? "";
            from = i + 1;
        }
    }
    const optBlocks = blocks.filter((b) => OPT_BLOCK.test(b.part));
    const optCount = optBlocks.reduce((sum, b) => {
        const items = lines.slice(b.from, b.ial).filter((l) => LIST_ITEM.test(l));
        return sum + (items.length || 1);
    }, 0);
    const type = normalizeType(containerType) ?? "";
    return { containerType: type, blocks, optCount, optBlock: optBlocks[0], lines };
}

/** 修复计划：none=健康或不适用；fixable=可确定性修复（含执行产物）；
 *  regen=损坏但不可推导，走单题重生成。 */
export type OptionRepairPlan =
    | { kind: "none" }
    | { kind: "fixable"; kd: string; opts: string[]; answer: string }
    | { kind: "regen"; reason: OptionRepairRegenReason };

/**
 * 对一条题库 kramdown 出修复计划（纯函数，不碰库）。判定链：客观题
 * （single/multiple/match）且解析口径选项数 <2 → 挤行形态（单选项块 +
 * 首行带标签 + 续行无列表标记）→ 拆行；只有 single 可修（multiple/
 * match 的正确集合规模推不出），答案部件缺失或非纯单字母也不修。
 * rng 注入供测试。
 */
export function planOptionRepair(kd: string, rng: () => number = Math.random): OptionRepairPlan {
    const { blocks, containerType, optCount, optBlock, lines } = scanKd(kd);
    if (containerType !== "single" && containerType !== "multiple" && containerType !== "match")
        return { kind: "none" };
    if (optCount >= 2) return { kind: "none" }; // 健康
    if (!optBlock) return { kind: "regen", reason: optCount === 0 ? "noopts" : "one" };
    // 丢块间空行（与 unpackPackedSingle 同口径：空行不承载选项）
    const raw = lines.slice(optBlock.from, optBlock.ial).filter((l) => l.trim());
    const label = ITEM_LABEL.exec(raw[0] ?? "");
    if (!label) return { kind: "regen", reason: optCount === 0 ? "noopts" : "one" };
    const opts = raw
        .map((l, i) => (i === 0 ? l.slice(label[0].length) : l))
        .map((l) => stripIal(l).trim())
        .filter(Boolean);
    if (opts.length < 2) return { kind: "regen", reason: "one" };
    if (containerType !== "single") return { kind: "regen", reason: "packed-multi" };
    const ansBlock = blocks.find((x) => x.part === "answer");
    const ansText = ansBlock
        ? lines
              .slice(ansBlock.from, ansBlock.ial)
              .join("\n")
              .replace(/^[ \t]*>[ \t]?/gm, "")
              .trim()
        : "";
    if (!/^[A-Ha-h]$/.test(ansText)) return { kind: "regen", reason: "answer" };
    // 洗牌：正确项=首行（协议），重排后答案字母指向其新位置；位置敏感
    // 措辞保序（answer=A 仍指向首行）。重试让正确项离开 A 位（消剧透）。
    let order = [...Array(opts.length).keys()];
    if (!opts.some((o) => POSITION_SENSITIVE.test(o))) {
        for (let tries = 0; tries < 10; tries++) {
            const cand = [...Array(opts.length).keys()];
            for (let i = cand.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [cand[i], cand[j]] = [cand[j], cand[i]];
            }
            if (cand[0] !== 0) {
                order = cand;
                break;
            }
        }
    }
    const answer = LETTERS[order.indexOf(0)];
    const out = [...lines];
    // 两处替换按行号降序落，避免先改选项块后答案块行号漂移
    const edits = [
        {
            from: optBlock.from,
            count: optBlock.ial - optBlock.from,
            repl: order.map((oldIdx, k) => `- ${LETTERS[k]}. ${opts[oldIdx]}`),
        },
        { from: ansBlock.from, count: ansBlock.ial - ansBlock.from, repl: [`> ${answer}`] },
    ].sort((x, y) => y.from - x.from);
    for (const e of edits) out.splice(e.from, e.count, ...e.repl);
    return { kind: "fixable", kd: out.join("\n"), opts: order.map((i) => opts[i]), answer };
}

/** 体检可修复行（预览即所得：kd 即执行产物）。 */
export interface OptionRepairRow {
    qid: string;
    /** 所属题集标题（空=源文档已删的悬空记录）。 */
    set: string;
    stem: string;
    opts: string[];
    answer: string;
    /** 解析里明示的答案字母（人工复核线索）。 */
    said?: string;
    kd: string;
}

/** 全库体检结果。 */
export interface OptionRepairScan {
    fixable: OptionRepairRow[];
    /** 损坏但不可确定性修复（multiple/match 挤行、答案部件缺失等）。 */
    regen: { qid: string; stem: string; set: string; reason: OptionRepairRegenReason }[];
    scanned: number;
}

/** 全库扫描客观题（single/multiple/match）的选项挤行。 */
export async function scanOptionRepairs(bank: QuestionBank): Promise<OptionRepairScan> {
    const data = await bank.all();
    const scan: OptionRepairScan = { fixable: [], regen: [], scanned: 0 };
    for (const r of Object.values(data.records)) {
        if (r.type !== "single" && r.type !== "multiple" && r.type !== "match") continue;
        scan.scanned++;
        const plan = planOptionRepair(r.kramdown);
        if (plan.kind === "none") continue;
        const row = { qid: r.qid, stem: stemOf(r.kramdown), set: data.sets?.[r.sourceDocId]?.title ?? "" };
        if (plan.kind === "regen") {
            scan.regen.push({ ...row, reason: plan.reason });
            continue;
        }
        scan.fixable.push({ ...row, opts: plan.opts, answer: plan.answer, said: saidOf(r.kramdown), kd: plan.kd });
    }
    return scan;
}

function stemOf(kd: string): string {
    const { blocks, lines } = scanKd(kd);
    const b = blocks.find((x) => x.part === "stem");
    if (!b) return "";
    return stripIal(lines.slice(b.from, b.ial).join("\n")).replace(/\s+/g, " ").trim().slice(0, 40);
}

function saidOf(kd: string): string | undefined {
    const { blocks, lines } = scanKd(kd);
    const said = blocks
        .filter((x) => x.part === "solution")
        .flatMap((x) => [...lines.slice(x.from, x.ial).join("\n").matchAll(SAID_LETTER)])
        .map((m) => m[1].toUpperCase());
    return said.length > 0 ? [...new Set(said)].join("/") : undefined;
}

/** 执行修复（预览产物的 kd 原样回写，预览即所得）：逐条替换记录、
 *  重算指纹/失效解析缓存，最后统一落盘。返回成功条数。 */
export async function applyOptionRepairs(bank: QuestionBank, rows: { qid: string; kd: string }[]): Promise<number> {
    let n = 0;
    for (const r of rows) if (await replaceRecordKramdown(bank, r.qid, r.kd)) n++;
    if (n > 0) await bank.flush();
    return n;
}
