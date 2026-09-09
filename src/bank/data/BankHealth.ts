import { LETTERS, QuestionType } from "../../types";
import { parseQuestionKramdown, questionHash } from "./BankParse";
import type { ParsedQuestion } from "./BankParse";
import { planOptionRepair, saidOf } from "./BankRepair";
import type { OptionRepairRow } from "./BankRepair";
import { replaceRecordKramdown } from "./BankRegen";
import type { BankData, BankRecord, QuestionBank } from "./QuestionBank";

/**
 * 题库体检引擎（20260909 自「选项挤行单病扫描」升级为全库体检）：
 * 三层检查一次扫完——① 题目结构（解析失败/题干答案缺失/答案字母越界/
 * 挤行/多步与完形残缺，走题卡「重新生成」或确定性拆行）；② 引用完整性
 * （题集与专题悬空 qid、组链指向不存在的材料、孤儿材料、缺题集条目，
 * 全部确定性自动修复）；③ 索引一致性（record.hash 与内容脱钩、指纹索引
 * 悬空、kpRefs 字段与题面脱钩、记录元数据漂移，重算/重建即愈）。
 * 同指纹多条只报告不自动删（删谁涉及题集归属与作答统计保留）。
 *
 * 口径：kramdown 是题目内容唯一真相——凡「字段 vs 题面」冲突一律以
 * 题面为准修字段；hash 重算含旧版单段指纹格式（对齐后跨卷去重即时
 * 生效，与 replaceRecordKramdown 的行为同源）。纯库内检查零内核调用。
 */

/** 结构问题（一条题可叠加多项；全部走单题重生成）。 */
export type HealthIssue =
    | "parse-fail" // 解析失败（容器属性行残缺/题型不可识别）
    | "no-stem" // 题干为空
    | "no-answer" // 自动判分题型缺答案部件
    | "bad-answer" // 答案形态非法（判断题非 √/× 族、匹配非字母序列）
    | "answer-range" // 答案字母越界（超出选项数，判分永远错）
    | "packed-multi" // 多选/匹配挤行·正确集合不可推导
    | "packed-answer" // 挤行且答案部件缺失/非字母
    | "noopts" // 客观题无选项部件
    | "one" // 客观题仅一个选项
    | "steps-broken" // 多步题步答案缺失
    | "slots-broken"; // 完形/匹配无有效空位

/** 引用/索引类自动修复类别（一类勾选一次修完）。 */
export type HealthAutoKind =
    | "set-dangling" // 题集引用不存在的题目 → 剪除
    | "set-missing" // 有记录但缺题集条目 → 补建
    | "col-dangling" // 专题引用不存在的题目 → 剪除
    | "mat-missing" // 组链指向不存在的材料 → 解除组链
    | "mat-orphan" // 材料无题引用或题集已删 → 清除
    | "hash-bad" // 记录指纹与内容不符（含旧版格式）→ 重算
    | "hashed-stale" // 指纹索引悬空/失准/缺项 → 重建
    | "kpref-gap" // 题面知识引用未同步进记录字段 → 并入
    | "stats-missing" // 记录缺作答统计结构 → 补零
    | "meta-drift"; // 题型/知识点等字段与题面脱钩 → 以题面为准

/** 需单题重生成的行（一题一行，问题叠加展示）。 */
export interface HealthBadRow {
    qid: string;
    stem: string;
    set: string;
    issues: HealthIssue[];
}

/** 引用/索引自动修复行（类别聚合）。 */
export interface HealthAutoRow {
    kind: HealthAutoKind;
    count: number;
    /** 细节样本（弹窗预览用，≤3 条）。 */
    sample: string[];
}

/** 同指纹重复题组（仅报告）。 */
export interface HealthDupGroup {
    hash: string;
    rows: { qid: string; stem: string; set: string }[];
}

/** 全库体检结果。 */
export interface HealthScan {
    scanned: number;
    /** 挤行可确定性修复（预览即所得，kd 即执行产物）。 */
    fixable: OptionRepairRow[];
    regen: HealthBadRow[];
    auto: HealthAutoRow[];
    dups: HealthDupGroup[];
}

/** 展示稳定序（弹窗按此排列问题标签）。 */
const ISSUE_ORDER: HealthIssue[] = [
    "parse-fail",
    "no-stem",
    "no-answer",
    "bad-answer",
    "answer-range",
    "packed-multi",
    "packed-answer",
    "noopts",
    "one",
    "steps-broken",
    "slots-broken",
];

const JUDGE_ANS_RE = /^(?:√|×|对|错|T|F|TRUE|FALSE)$/;
/** 纯字母答案（可比字母位；内容答案如 $e^2$ 不适用）。 */
function isLetterAns(ans: string): boolean {
    return /^[A-Za-z]+$/.test(ans.replace(/\s+/g, ""));
}
/** 字母是否落在选项数范围内。 */
function letterIn(n: number, ch: string): boolean {
    const i = LETTERS.indexOf(ch.toUpperCase());
    return i >= 0 && i < n;
}

/** 单条解析视图的结构检查（按题型；brief/essay/trans 为 AI 判分无硬答案）。 */
function structIssues(p: ParsedQuestion): HealthIssue[] {
    const out: HealthIssue[] = [];
    if (!p.stemMd.trim()) out.push("no-stem");
    const ans = (p.answer ?? "").trim();
    const nOpts = p.optionMd?.length ?? 0;
    const letters = [...ans.replace(/\s+/g, "")];
    switch (p.type) {
        case QuestionType.Single:
            if (!ans) out.push("no-answer");
            else if (isLetterAns(ans) && (letters.length !== 1 || !letterIn(nOpts, letters[0])))
                out.push("answer-range");
            break;
        case QuestionType.Multiple:
            if (!ans) out.push("no-answer");
            else if (isLetterAns(ans) && !letters.every((c) => letterIn(nOpts, c))) out.push("answer-range");
            break;
        case QuestionType.Judge: {
            if (!ans) out.push("no-answer");
            else if (!JUDGE_ANS_RE.test(ans.replace(/\s+/g, "").toUpperCase())) out.push("bad-answer");
            break;
        }
        case QuestionType.Fill:
            if (!ans) out.push("no-answer"); // 多答案/内容比对面宽，字母范围无意义
            break;
        case QuestionType.Match:
            if (!ans) out.push("no-answer");
            else if (!isLetterAns(ans))
                out.push("bad-answer"); // 槽位组不出来
            else if (!letters.every((c) => letterIn(nOpts, c))) out.push("answer-range");
            if (nOpts === 0) out.push("noopts");
            break;
        case QuestionType.Cloze: {
            const slots = p.slots ?? [];
            if (slots.length === 0 || slots.some((s) => !s.answer.trim())) out.push("slots-broken");
            else if (
                slots.some((s) => {
                    const n = s.optionMd?.length ?? 0;
                    return n > 0 && isLetterAns(s.answer) && !letterIn(n, s.answer.trim());
                })
            )
                out.push("answer-range");
            break;
        }
        case QuestionType.Steps: {
            const steps = p.steps ?? [];
            if (steps.length === 0 || steps.some((s) => !s.answer.trim())) out.push("steps-broken");
            else if (
                steps.some((s) => {
                    const n = s.optionMd?.length ?? 0;
                    return n > 0 && isLetterAns(s.answer) && !letterIn(n, s.answer.trim());
                })
            )
                out.push("answer-range");
            break;
        }
        default:
            break;
    }
    return out;
}

/** planOptionRepair 的 regen 原因并入问题集。 */
function mapPlanReason(r: "packed-multi" | "answer" | "noopts" | "one"): HealthIssue {
    return r === "answer" ? "packed-answer" : r;
}

/** 记录元数据与题面是否脱钩（题型/知识点/章节/难度，题面有值且不同才算）。 */
function metaDrifted(r: BankRecord, p: ParsedQuestion): boolean {
    return (
        (!!p.type && !!r.type && p.type !== r.type) ||
        (!!p.knowledge && p.knowledge !== r.knowledge) ||
        (!!p.chapter && p.chapter !== r.chapter) ||
        (p.difficulty !== undefined && p.difficulty !== r.difficulty)
    );
}

function stemBrief(p: ParsedQuestion | undefined, r: BankRecord): string {
    return (p?.stemMd ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || r.qid.slice(-8);
}

/** 全库体检（纯扫描不改库；挤行修复产物随行携带，预览即所得）。 */
export async function scanBankHealth(bank: QuestionBank): Promise<HealthScan> {
    const data = await bank.all();
    const scan: HealthScan = { scanned: 0, fixable: [], regen: [], auto: [], dups: [] };
    /** 中间累计（auto 行组装用）。 */
    const hashBad: string[] = [];
    const kprefGap: string[] = [];
    let statsMissing = 0;
    let metaDrift = 0;
    const dupAcc = new Map<string, { qid: string; stem: string; set: string }[]>();

    for (const r of Object.values(data.records)) {
        scan.scanned++;
        const issues: HealthIssue[] = [];
        const h = questionHash(r.kramdown);
        if (r.hash !== h) hashBad.push(r.qid);
        if (!r.stats) statsMissing++;
        const set = data.sets?.[r.sourceDocId]?.title ?? "";
        const parsed = parseQuestionKramdown(r.kramdown, r.qid, r.sourceDocId);
        if (!parsed) issues.push("parse-fail");
        else {
            // 挤行形态（single/multiple/match 的选项视图塌陷）下判分断点
            // 检查无意义——越界/缺选项都是塌陷的影子而非独立病；只有选项
            // 结构健康（plan none）的题才做 answer-range/no-answer 等检查
            const plan = planOptionRepair(r.kramdown);
            if (plan.kind === "fixable")
                scan.fixable.push({
                    qid: r.qid,
                    set,
                    stem: stemBrief(parsed, r),
                    opts: plan.opts,
                    answer: plan.answer,
                    said: saidOf(r.kramdown),
                    kd: plan.kd,
                });
            else if (plan.kind === "regen") issues.push(mapPlanReason(plan.reason));
            else issues.push(...structIssues(parsed));
            const have = new Set(r.kpRefs.map((k) => k.id));
            if (parsed.kpRefs.some((k) => !have.has(k.id))) kprefGap.push(r.qid);
            if (metaDrifted(r, parsed)) metaDrift++;
            const bucket = dupAcc.get(h) ?? [];
            bucket.push({ qid: r.qid, stem: stemBrief(parsed, r), set });
            dupAcc.set(h, bucket);
        }
        if (issues.length > 0) {
            const uniq = ISSUE_ORDER.filter((i) => issues.includes(i));
            scan.regen.push({ qid: r.qid, stem: stemBrief(parsed, r), set, issues: uniq });
        }
    }
    for (const [hash, rows] of dupAcc) if (rows.length > 1) scan.dups.push({ hash, rows });
    scan.dups.sort((a, b) => b.rows.length - a.rows.length);

    /* ── 引用完整性（题集/专题/材料）与指纹索引 ── */
    const recordIds = new Set(Object.keys(data.records));
    const bySrc = new Map<string, number>();
    for (const r of Object.values(data.records))
        if (r.sourceDocId) bySrc.set(r.sourceDocId, (bySrc.get(r.sourceDocId) ?? 0) + 1);
    const groupIds = new Set(
        Object.values(data.records)
            .map((r) => r.group)
            .filter((g): g is string => !!g)
    );

    let setDangling = 0;
    const setDanglingSample: string[] = [];
    for (const set of Object.values(data.sets ?? {})) {
        const dead = set.qids.filter((q) => !recordIds.has(q));
        if (dead.length > 0) {
            setDangling += dead.length;
            if (setDanglingSample.length < 3)
                setDanglingSample.push(`${set.title || set.id.slice(-6)} ×${dead.length}`);
        }
    }
    const setMissingIds = [...bySrc.keys()].filter((id) => !data.sets?.[id]);
    let colDangling = 0;
    const colDanglingSample: string[] = [];
    for (const col of data.collections) {
        const dead = col.qids.filter((q) => !recordIds.has(q));
        if (dead.length > 0) {
            colDangling += dead.length;
            if (colDanglingSample.length < 3) colDanglingSample.push(`${col.title} ×${dead.length}`);
        }
    }
    const matOrphanIds = Object.entries(data.materials ?? {})
        .filter(([mid, m]) => !groupIds.has(mid) || !data.sets?.[m.setId])
        .map(([mid]) => mid);
    const matMissingQids = Object.values(data.records)
        .filter((r) => r.group && !data.materials?.[r.group])
        .map((r) => r.qid);
    let hashedStale = 0;
    for (const [h, qid] of Object.entries(data.hashed))
        if (!data.records[qid] || data.records[qid].hash !== h) hashedStale++;
    for (const r of Object.values(data.records)) if (data.hashed[r.hash] === undefined) hashedStale++;

    const autoOf = (kind: HealthAutoKind, count: number, sample: string[] = []): void => {
        if (count > 0) scan.auto.push({ kind, count, sample });
    };
    autoOf("set-dangling", setDangling, setDanglingSample);
    autoOf(
        "set-missing",
        setMissingIds.length,
        setMissingIds.slice(0, 3).map((id) => `${bySrc.get(id)} 题`)
    );
    autoOf("col-dangling", colDangling, colDanglingSample);
    autoOf("mat-missing", matMissingQids.length);
    autoOf("mat-orphan", matOrphanIds.length, matOrphanIds.slice(0, 3));
    autoOf("hash-bad", hashBad.length);
    autoOf("hashed-stale", hashedStale);
    autoOf("kpref-gap", kprefGap.length);
    autoOf("stats-missing", statsMissing);
    autoOf("meta-drift", metaDrift);
    return scan;
}

/** 执行体检修复：勾选的自动类别 + 挤行行（kd 原样回写）。修复目标在
 *  应用时从当前数据现算（幂等，不依赖扫描快照），最后统一落盘。 */
export async function applyBankHealth(
    bank: QuestionBank,
    kinds: Set<HealthAutoKind>,
    packed: { qid: string; kd: string }[]
): Promise<{ auto: number; packed: number }> {
    const data = await bank.all();
    let fixed = 0;
    // 先清孤儿材料再剥组链：材料因题集已删被清后，指向它的组链在同一
    // 遍内跟着解除（反序会留下新一轮悬空组链）
    if (kinds.has("mat-orphan")) {
        const groupIds = new Set(
            Object.values(data.records)
                .map((r) => r.group)
                .filter((g): g is string => !!g)
        );
        for (const mid of Object.keys(data.materials ?? {})) {
            const m = data.materials[mid];
            if (!groupIds.has(mid) || !data.sets?.[m.setId]) {
                delete data.materials[mid];
                fixed++;
            }
        }
    }
    for (const r of Object.values(data.records)) {
        let touched = false;
        if (kinds.has("stats-missing") && !r.stats) {
            r.stats = { attempts: 0, wrongCount: 0, updatedAt: Date.now() };
            touched = true;
        }
        if (kinds.has("hash-bad")) {
            const h = questionHash(r.kramdown);
            if (r.hash !== h) {
                r.hash = h;
                bank.invalidateParse(r.qid);
                touched = true;
            }
        }
        if (kinds.has("meta-drift")) {
            const p = parseQuestionKramdown(r.kramdown, r.qid, r.sourceDocId);
            if (p && metaDrifted(r, p)) {
                if (p.type && r.type && p.type !== r.type) r.type = p.type;
                if (p.knowledge && p.knowledge !== r.knowledge) r.knowledge = p.knowledge;
                if (p.chapter && p.chapter !== r.chapter) r.chapter = p.chapter;
                if (p.difficulty !== undefined && p.difficulty !== r.difficulty) r.difficulty = p.difficulty;
                touched = true;
            }
        }
        if (kinds.has("kpref-gap")) {
            const p = parseQuestionKramdown(r.kramdown, r.qid, r.sourceDocId);
            if (p) {
                const have = new Set(r.kpRefs.map((k) => k.id));
                const add = p.kpRefs.filter((k) => !have.has(k.id));
                if (add.length > 0) {
                    r.kpRefs.push(...add);
                    touched = true;
                }
            }
        }
        if (kinds.has("mat-missing") && r.group && !data.materials?.[r.group]) {
            delete r.group;
            touched = true;
        }
        if (touched) fixed++;
    }
    if (kinds.has("set-dangling")) {
        for (const set of Object.values(data.sets ?? {})) {
            const before = set.qids.length;
            set.qids = set.qids.filter((q) => !!data.records[q]);
            if (set.qids.length !== before) fixed++;
        }
    }
    if (kinds.has("set-missing")) {
        const bySrc = new Map<string, string[]>();
        for (const r of Object.values(data.records))
            if (r.sourceDocId && !data.sets?.[r.sourceDocId]) {
                const qids = bySrc.get(r.sourceDocId) ?? [];
                qids.push(r.qid);
                bySrc.set(r.sourceDocId, qids);
            }
        for (const [id, qids] of bySrc) {
            // 标题留空：ensureSets 装载时空标题条目会回填（读内核文档标题）
            data.sets[id] = { id, title: "", qids, createdAt: Date.now() };
            fixed++;
        }
    }
    if (kinds.has("col-dangling")) {
        for (const col of data.collections) {
            const before = col.qids.length;
            col.qids = col.qids.filter((q) => !!data.records[q]);
            if (col.qids.length !== before) fixed++;
        }
    }
    if (kinds.has("hashed-stale")) {
        const rebuilt: BankData["hashed"] = {};
        for (const r of Object.values(data.records)) if (rebuilt[r.hash] === undefined) rebuilt[r.hash] = r.qid;
        data.hashed = rebuilt;
        fixed++;
    }
    let packedOk = 0;
    for (const row of packed) if (await replaceRecordKramdown(bank, row.qid, row.kd)) packedOk++;
    if (fixed > 0 || packedOk > 0) {
        bank.markDirty();
        await bank.flush();
    }
    return { auto: fixed, packed: packedOk };
}
