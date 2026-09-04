import { LETTERS, normalizeAnswerMd } from "../../types";
import { restoreAiImages } from "../../ai/PromptHygiene";
import { knowledgeRefLine } from "./KnowRef";
import type { KnowSection } from "./KnowledgeLink";

/**
 * 题目行协议（20260902 起 AI 生成返回格式）：AI 不再产 kramdown 超级块，
 * 改输出 @@ 标记行定界的结构化文本，本模块解析成 DraftUnit、由
 * renderUnit **确定性渲染**成与题目块契约逐字兼容的 kramdown——格式
 * 正确性从「AI 概率事件」变成「代码保证」，ConvertService.extractQuestions
 * 的五条 kramdown 偏差修补规则整体退役。
 *
 * 不用 JSON/YAML 的理由（数学 LaTeX 内容）：JSON 每个反斜杠都要转义、
 * YAML 缩进敏感且冒号/井号/横线雷区全在中文数学文本高频区；行协议零
 * 转义、无缩进语义，且错误是局部的——漏 @@END 自动收口、下一题照常
 * 恢复（坏一题不坏一批）。落盘 kramdown 形态不变，存量题集/指纹/
 * BankParse 零影响（冻结清单不触碰）。
 */

/** 协议单元的一个部件（part 名即契约 §一 的子块名）。 */
export interface DraftPart {
    /** 契约 part 名（stem/answer/solution/body/trans/option-0/step-k/slot-k 系列）。 */
    name: string;
    /** 部件 markdown 文本（空行分段，渲染时决定块形态）。 */
    text: string;
}

/** 协议单元：一道题或一个共享材料块。 */
export interface DraftUnit {
    /** 材料块（material="1" 容器，不占题数）。 */
    material: boolean;
    /** @@Q 行属性（type/knowledge/chapter/difficulty/steps/group；know 由
     *  applyKnowDrafts 解析成 kpRefs 后删除）。 */
    attrs: Record<string, string>;
    parts: DraftPart[];
    /** 知识点引用（渲染时并入最后一个 solution 引述块）。 */
    kpRefs?: { id: string; title: string }[];
}

/** 渲染附加属性（增量哈希的源块键与指纹随容器 IAL 落盘）。 */
export interface RenderExtra {
    srcKey?: string;
    srcHash?: string;
}

/** 标记行：@@Q / @@P / @@END（容忍行首空白；其余 @ 开头行按内容处理）。 */
const MARKER = /^\s*@@(Q|P|END)\s*(.*)$/;
/** @@Q 属性行的 key=value 词法（值可带引号）。 */
const ATTR_TOKEN = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"\n]*)"|([^\s"]+))/g;
/** AI 退回 kramdown 习惯时的噪声行（纯 IAL 行 / 超级块定界）。 */
const NOISE_LINE = /^[ \t]*(?:>[ \t]*)*\{:[^}\n]*\}[ \t]*$|^[ \t]*(?:\{\{\{|\}\}\})/;

/** @@P 部件短名 → 契约 part 名；step/slot 计数器语义：step 在 @@P step
 *  时自增；slot 在 @@P slot-ans（该空答案后下一空开始）时自增——同空
 *  的多个 slot-opt 共享空号。canonical 全名（step-N-* / slot-N-*）也容忍，
 *  计数器对齐取 max。 */
function resolvePart(raw: string, st: { step: number; slot: number }): string {
    const s = raw.trim().toLowerCase().replace(/\s+/g, "");
    const canon = /^step-(\d+)-(stem|option|answer)/.exec(s);
    if (canon) {
        st.step = Math.max(st.step, Number(canon[1]));
        return `step-${st.step}-${canon[2] === "option" ? "option-0" : canon[2]}`;
    }
    const slot = /^slot-(\d+)-(option|answer)/.exec(s);
    if (slot) {
        st.slot = Math.max(st.slot, Number(slot[1]) + (slot[2] === "answer" ? 1 : 0));
        return `slot-${slot[2] === "option" ? Math.max(1, Number(slot[1])) : Number(slot[1])}-${slot[2] === "option" ? "option-0" : slot[2]}`;
    }
    switch (s) {
        case "stem":
        case "body":
        case "trans":
            return s;
        case "opt":
        case "option":
            return "option-0";
        case "ans":
        case "answer":
            return "answer";
        case "sol":
        case "solution":
            return "solution";
        case "step":
            st.step += 1;
            return `step-${st.step}-stem`;
        case "step-opt":
        case "step-option":
            if (!st.step) st.step = 1;
            return `step-${st.step}-option-0`;
        case "step-ans":
        case "step-answer":
            if (!st.step) st.step = 1;
            return `step-${st.step}-answer`;
        case "slot-opt":
        case "slot-option":
            if (!st.slot) st.slot = 1;
            return `slot-${st.slot}-option-0`;
        case "slot-ans":
        case "slot-answer": {
            if (!st.slot) st.slot = 1;
            const k = st.slot;
            st.slot += 1;
            return `slot-${k}-answer`;
        }
        default:
            return "";
    }
}

/** 答案类部件（顶层/步/空），解析时规整引述前缀与「正确答案：」标签。 */
function isAnswerPart(name: string): boolean {
    return name === "answer" || /^(?:step|slot)-\d+-answer$/.test(name);
}

function parseAttrs(raw: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const m of raw.matchAll(ATTR_TOKEN)) out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? "").trim();
    return out;
}

function cleanPartText(lines: string[]): string {
    // 占位符还原（发送侧消毒的对称面）：模型漏还原时在这里兜底变回图片行
    return restoreAiImages(
        lines
            .filter((l) => !NOISE_LINE.test(l))
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
    ).trim();
}

/** 单元有效性（口径与旧 extractBatchQuestions 过滤一致：题目必有题干）。 */
export function hasStemPart(d: DraftUnit): boolean {
    return !d.material && d.attrs.type !== undefined && d.parts.some((p) => p.name === "stem" && p.text.trim());
}

/**
 * 解析 AI 回复里的全部协议单元。容错：首个 @@Q 前的叙述（判定行等）
 * 忽略；漏 @@END 由下一个 @@Q/EOF 自动收口；未知部件名丢弃该段内容
 * （防 AI 生造部件落成噪声）；kramdown 残迹（IAL 行/定界）按行剥除。
 */
export function parseDrafts(reply: string): DraftUnit[] {
    const units: DraftUnit[] = [];
    let cur: DraftUnit | null = null;
    let curPart: DraftPart | null = null;
    let buf: string[] = [];
    const st = { step: 0, slot: 0 };
    const closePart = (): void => {
        if (cur && curPart) {
            const text = cleanPartText(buf);
            if (text)
                cur.parts.push({
                    name: curPart.name,
                    text: isAnswerPart(curPart.name) ? normalizeAnswerMd(text) : text,
                });
        }
        curPart = null;
        buf = [];
    };
    const closeUnit = (): void => {
        closePart();
        if (cur && (cur.material ? cur.parts.length > 0 : hasStemPart(cur))) units.push(cur);
        cur = null;
    };
    for (const raw of reply.split(/\r?\n/)) {
        const m = MARKER.exec(raw);
        if (!m) {
            if (curPart) buf.push(raw);
            continue;
        }
        const [, mark, rest] = m;
        if (mark === "Q") {
            closeUnit();
            st.step = 0;
            st.slot = 0;
            const attrs = parseAttrs(rest);
            const material = /^(1|true|yes)$/i.test(attrs.material ?? "");
            delete attrs.material;
            cur = { material, attrs, parts: [] };
            continue;
        }
        if (!cur || mark === "END") {
            if (cur && mark === "END") closeUnit();
            continue;
        }
        closePart();
        const name = resolvePart(rest, st);
        if (name) curPart = { name, text: "" };
    }
    closeUnit();
    return units;
}

/** IAL 属性值消毒：剥引号/换行、折叠空白、限长。 */
function ialValue(v: string, cap = 120): string {
    return v
        .replace(/["\n\r]/g, " ")
        .trim()
        .slice(0, cap);
}

/** 部件名 → 选项组键（null=非选项部件；""=顶层；step-k/slot-k=嵌套组）。 */
function optGroupOf(name: string): string | null {
    if (/^option/.test(name)) return "";
    return /^(step-\d+|slot-\d+)-option/.exec(name)?.[1] ?? null;
}

/** 引述类部件（答案/解析）渲染为 `> ` 块引述，其余为段落。 */
function isQuotePart(name: string): boolean {
    return name === "answer" || name === "solution" || /^(?:step|slot)-\d+-answer$/.test(name);
}

/** 文本部件 → 块序列：空行分段，每段一个子块（IAL 尾随行）。 */
function renderTextPart(p: DraftPart): string[] {
    const quote = isQuotePart(p.name);
    return p.text
        .split(/\n{2,}/)
        .map((para) => para.trim())
        .filter(Boolean)
        .map((para) => {
            const lines = para.split("\n").map((l) => (quote ? `> ${l}`.trimEnd() : l));
            return `${lines.join("\n")}\n{: custom-plugin-wengu-part="${p.name}"}`;
        });
}

/** 渲染协议单元为契约 kramdown（容器 + part IAL；选项字母按最终顺序
 *  自动编排、连续选项合并为一个列表块）。 */
export function renderUnit(d: DraftUnit, extra: RenderExtra = {}): string {
    const parts = d.parts.map((p) => ({ ...p }));
    if (d.kpRefs?.length) {
        const line = knowledgeRefLine(d.kpRefs).replace(/^>\s*/, "");
        const last = [...parts].reverse().find((p) => p.name === "solution");
        if (last) last.text = `${last.text}\n${line}`.trim();
        else parts.push({ name: "solution", text: line });
    }
    const body: string[] = [];
    let pend: { g: string; name: string; texts: string[] } | null = null;
    const flushOpts = (): void => {
        if (!pend) return;
        const items = pend.texts.map((t, j) => {
            const ls = t.split("\n");
            return `- ${LETTERS[j]}. ${ls[0]}${ls.length > 1 ? `\n${ls.slice(1).join("\n")}` : ""}`;
        });
        body.push(`${items.join("\n")}\n{: custom-plugin-wengu-part="${pend.name}"}`);
        pend = null;
    };
    for (const p of parts) {
        const g = optGroupOf(p.name);
        if (g !== null) {
            if (!pend || pend.g !== g) {
                flushOpts();
                pend = { g, name: g === "" ? "option-0" : `${g}-option-0`, texts: [] };
            }
            pend.texts.push(p.text.trim());
            continue;
        }
        flushOpts();
        body.push(...renderTextPart(p));
    }
    flushOpts();
    const attrs: string[] = [];
    if (d.material) {
        attrs.push('custom-plugin-wengu-material="1"');
    } else {
        attrs.push('custom-plugin-wengu-q="1"');
        if (d.attrs.type) attrs.push(`custom-plugin-wengu-type="${ialValue(d.attrs.type)}"`);
        if (d.attrs.steps) attrs.push(`custom-plugin-wengu-steps="${ialValue(d.attrs.steps)}"`);
        if (d.attrs.group) attrs.push(`custom-plugin-wengu-group="${ialValue(d.attrs.group)}"`);
    }
    if (d.attrs.knowledge) attrs.push(`custom-plugin-wengu-knowledge="${ialValue(d.attrs.knowledge)}"`);
    if (d.attrs.chapter) attrs.push(`custom-plugin-wengu-chapter="${ialValue(d.attrs.chapter)}"`);
    if (/^\d$/.test(d.attrs.difficulty ?? "")) attrs.push(`custom-plugin-wengu-difficulty="${d.attrs.difficulty}"`);
    if (extra.srcKey) attrs.push(`custom-plugin-wengu-src-key="${ialValue(extra.srcKey, 80)}"`);
    if (extra.srcHash) attrs.push(`custom-plugin-wengu-src-hash="${ialValue(extra.srcHash)}"`);
    return `{{{row\n${body.join("\n\n")}\n}}}\n{: ${attrs.join(" ")}}`;
}

/**
 * 生成后处理（draft 层）：把 @@Q 行的 know 别名（K1,K3）映射回真实
 * 小节，存进 kpRefs 由渲染并入解析块、并删除临时属性（落盘格式不变）。
 * 返回注入成功的题数（口径同旧 KnowRef.applyKnowLinks）。
 */
export function applyKnowDrafts(drafts: DraftUnit[], byAlias: Map<string, KnowSection>): number {
    let linked = 0;
    for (const d of drafts) {
        const know = d.attrs.know;
        delete d.attrs.know;
        if (!know) continue;
        const seen = new Set<string>();
        const hits: KnowSection[] = [];
        for (const a of know.split(/[\s,;，；]+/)) {
            const s = byAlias.get(a.trim());
            if (s && !seen.has(s.id)) {
                seen.add(s.id);
                hits.push(s);
            }
        }
        if (hits.length === 0) continue;
        d.kpRefs = hits;
        linked++;
    }
    return linked;
}

/** 行协议格式约定（生成 prompt 共用：转换/增量/单题重生成/出题）。 */
export function protocolSpec(): string {
    return `行协议格式（标记行必须顶格、独占一行；内容行原样书写，公式与图片行不需要任何转义）：
@@Q type=题型 knowledge=考点 chapter=章节
@@P stem
题干文字（公式行内 $...$、块级 $$...$$ 独占一行；空行分段，也可写多个 @@P stem）
@@P opt
选项内容（只写内容不写字母——字母由系统按顺序自动编 A、B、C…；正确项写在最前，之后是干扰项，每个选项一个 @@P opt）
@@P ans
答案（单选/多选写字母如 B、AD；判断写 √ 或 ×；填空用 | 分隔多个可接受答案；简答/作文写要点或范文）
@@P sol
解析文字
@@END
其它部件：材料块正文 @@P body、参考译文 @@P trans；多步引导题（type=steps）每步依次 @@P step（步引导语）、@@P step-opt（该步选项）、@@P step-ans（该步答案），步号自动递增，整题解析仍用 @@P sol；完形/新题型每空依次 @@P slot-opt、@@P slot-ans，空号自动递增。@@Q 行还可带：difficulty=1~5（有明确难度线索才写）、steps=method|result|…（steps 题必带，按序声明每步类型）、group=prev（材料组小题，材料=文中紧邻其前的材料块）、material=1（共享材料块，搭配 @@P body/trans）。`;
}
