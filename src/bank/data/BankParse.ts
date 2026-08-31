import type { WenguQuestion } from "../../types";
import type { WenguStep } from "../../types";
import {
    cleanStemMd,
    normalizeAnswerMd,
    normalizeType,
    parseDifficulty,
    parseStepKinds,
    splitOptionMd,
} from "../../types";

/**
 * 题目 kramdown → WenguQuestion 纯函数解析器（题库侧专用）。
 *
 * 题库把题目存为「容器超级块 kramdown 原文」（落盘即真相，重新生成/
 * 迁移/渲染都从它出发），本模块负责把它拆回结构化视图——语义与
 * QuestionService.hydrate（从内核子块组装）一一对应，两条路径并存：
 * 文档模式走 hydrate，题库模式走这里。
 *
 * 结构假设（契约 §一）：容器 {{{ }}} + 尾行容器 IAL；子块各自带
 * part IAL 行。解析器按行扫描 part IAL 分段，不做 Lute/内核调用。
 */

/** 容器属性行（custom-plugin-wengu-q=…）。 */
const CONTAINER_IAL = /^\{:[^\n]*custom-plugin-wengu-q=/;
/** 子块属性行，捕获 part 名。 */
const PART_IAL = /^\{:[^\n]*custom-plugin-wengu-part="([a-z0-9-]+)"/;

/** IAL 残渣清理（20260829 题库真机踩坑）：思源 kramdown 读回时，列表项/
 *  块引用等子块的 IAL 会行内尾随或带缩进/引用前缀独立成行落盘——如
 *  `- {: id="…" updated="…"}A. …`、`  {: id="…" …}`、`> {: id="…" …}`。
 *  splitParts 只按无前缀整行 part IAL 分段，这些子块 IAL 全混进 part
 *  内容，渲染侧变成 "updated=…"}A. 字面泄漏。整行属性行（允许缩进/
 *  引用前缀）删行；行内尾随片段删片段（key="value" 全形态约束，
 *  不误伤公式里的 \{ 之类）。 */
const IAL_LINE = /^[ \t]*(?:>[ \t]*)*\{:[^}\n]*\}[ \t]*$/;
const IAL_INLINE = /\{:(?:[ \t]*[a-zA-Z-]+="[^"\n]*")+[ \t]*\}/g;

/** 渲染前的 IAL 残渣清理（MdRender 渲染入口同款复用）：整行属性行
 *  删行、行内尾随片段删片段。 */
export function stripIal(text: string): string {
    return text
        .split("\n")
        .filter((ln) => !IAL_LINE.test(ln))
        .join("\n")
        .replace(IAL_INLINE, "");
}

/** 容器 IAL 里的自定义属性值（custom-plugin-wengu- 前缀剥除后取裸名）。 */
function containerAttr(ial: string, name: string): string | undefined {
    const m = new RegExp(`custom-plugin-wengu-${name}="([^"]*)"`).exec(ial);
    return m ? m[1] : undefined;
}

/** 按 part IAL 行把容器体切段：part 名 → 该块去 IAL 的 markdown。 */
function splitParts(kd: string): { containerIal: string; parts: Map<string, string[]> } {
    const parts = new Map<string, string[]>();
    let containerIal = "";
    let buf: string[] = [];
    let part = "";
    const flush = () => {
        const text = buf
            .join("\n")
            .split("\n")
            .filter((ln) => !IAL_LINE.test(ln))
            .join("\n")
            .replace(IAL_INLINE, "")
            .trim();
        if (part && text) {
            const arr = parts.get(part) ?? [];
            arr.push(text);
            parts.set(part, arr);
        }
        buf = [];
    };
    for (const line of kd.split(/\r?\n/)) {
        if (/^\s*\{\{\{/.test(line) || /^\s*\}\}\}/.test(line)) {
            flush(); // 容器定界：定界前的残余（如题干前缀）按上一 part 收口
            part = "";
            continue;
        }
        const pm = PART_IAL.exec(line);
        if (pm) {
            // IAL 是尾随行：本行属性行之前的缓冲就是该 part 的内容
            part = pm[1];
            flush();
            continue;
        }
        if (CONTAINER_IAL.test(line)) {
            flush();
            containerIal = line;
            part = "";
            continue;
        }
        buf.push(line);
    }
    flush();
    return { containerIal, parts };
}

/** 题库题目：解析出的结构化视图 + 知识点引用（反链目标）。 */
export interface ParsedQuestion extends WenguQuestion {
    /** 知识点标题块引用（解析里的 ((id "标题"))，按序去重）。 */
    kpRefs: { id: string; title: string }[];
}

/** 解析题目 kramdown；容器缺 q/type 等关键属性时返回 undefined。 */
export function parseQuestionKramdown(kd: string, qid: string, rootId?: string): ParsedQuestion | undefined {
    const { containerIal, parts } = splitParts(kd);
    if (!containerIal) return undefined;
    const type = normalizeType(containerAttr(containerIal, "type") ?? "");
    if (!type) return undefined;
    const q: ParsedQuestion = { id: qid, ...(rootId ? { rootId } : {}), type, attempts: 0, wrongCount: 0, kpRefs: [] };
    const difficulty = parseDifficulty(containerAttr(containerIal, "difficulty") ?? "");
    if (difficulty !== undefined) q.difficulty = difficulty;
    const knowledge = containerAttr(containerIal, "knowledge");
    if (knowledge) q.knowledge = knowledge;
    const chapter = containerAttr(containerIal, "chapter");
    if (chapter) q.chapter = chapter;
    const kinds = parseStepKinds(containerAttr(containerIal, "steps") ?? "");
    if (kinds) q.steps = kinds.map((kind): WenguStep => ({ kind, stemMd: "", optionMd: [], answer: "" }));

    const options: { index: number; md: string }[] = [];
    const stepAcc = new Map<number, { stems: string[]; options: { index: number; md: string }[]; answers: string[] }>();
    const stepOf = (k: number) => {
        let acc = stepAcc.get(k);
        if (!acc) {
            acc = { stems: [], options: [], answers: [] };
            stepAcc.set(k, acc);
        }
        return acc;
    };
    for (const [part, mds] of parts) {
        for (let md of mds) {
            const sm = /^step-(\d+)-(stem|option(?:-(\d+))?|answer)$/.exec(part);
            if (sm) {
                const acc = stepOf(Number(sm[1]));
                if (sm[2] === "stem") acc.stems.push(md);
                else if (sm[2] === "answer") acc.answers.push(md);
                else acc.options.push({ index: sm[3] !== undefined ? Number(sm[3]) : acc.options.length, md });
                continue;
            }
            const om = /^option(?:-(\d+))?$/.exec(part);
            if (om) {
                options.push({ index: om[1] !== undefined ? Number(om[1]) : options.length, md });
                continue;
            }
            if (part === "stem") md = cleanStemMd(md);
            if (part === "answer") md = normalizeAnswerMd(md);
        }
    }
    options.sort((x, y) => x.index - y.index);
    q.stemMd = (parts.get("stem") ?? []).map(cleanStemMd).join("\n\n");
    q.optionMd = options.flatMap((o) => splitOptionMd(o.md));
    q.answer = normalizeAnswerMd((parts.get("answer") ?? []).join("\n"));
    const solution = (parts.get("solution") ?? []).join("\n\n");
    q.solutionMd = solution;

    const kindList = q.steps?.map((s) => s.kind);
    const steps = [...stepAcc.entries()]
        .sort((x, y) => x[0] - y[0])
        .map(
            ([, acc], i) =>
                ({
                    kind: kindList?.[i] ?? "result",
                    stemMd: acc.stems.join("\n\n"),
                    optionMd: acc.options.sort((x, y) => x.index - y.index).flatMap((o) => splitOptionMd(o.md)),
                    answer: normalizeAnswerMd(acc.answers.join("\n")),
                }) satisfies WenguStep
        );
    if (steps.length > 0) q.steps = steps;

    q.kpRefs.push(...parseKpRefs(solution));
    return q;
}

/** 从解析文本里抽知识点块引用 ((id "标题"))（按 id 去重；题库解析与薄弱画像共用）。 */
export function parseKpRefs(text: string): { id: string; title: string }[] {
    const out: { id: string; title: string }[] = [];
    const seen = new Set<string>();
    for (const m of text.matchAll(/\(\((\d{14}-[a-z0-9]+)\s+"([^"]{1,80})"\)\)/g)) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ id: m[1], title: m[2] });
    }
    return out;
}

/** 运行时统计属性（自托管后停写，但存量题块/题库 kramdown 的容器 IAL
 *  里仍嵌着旧值）——指纹归一必须剥除，否则一次作答就触发假漂移；
 *  契约属性（type/knowledge/src-hash 等）保留参与哈希：它们变了=内容
 *  真变了（docs/incremental-hash-plan.md §三口径）。 */
const RUNTIME_ATTR_HASH_RE =
    /\s*custom-plugin-wengu-(?:attempts|wrong-count|right|last-answer|step-right|step-last|slot-right|slot-last|total-time)="[^"]*"/g;

/** 内容指纹：剥掉块 id/updated 与运行时统计属性后哈希（跨卷同题去重、
 *  题库镜像对账共用）。双种子 DJB2 拼 64 位（万级题目下 32 位生日碰撞
 *  约 1%，碰撞即静默丢题，20260829 三轮审查）；旧记录的单段 36 进制
 *  指纹格式不同、永不与新指纹相等——存量重复题首次重扫会再入一条，
 *  一次性代价可接受。 */
export function questionHash(kd: string): string {
    const norm = kd
        .replace(/\s+id="[^"]*"/g, "")
        .replace(/\s+updated="[^"]*"/g, "")
        .replace(RUNTIME_ATTR_HASH_RE, "")
        .replace(/\s+/g, " ")
        .trim();
    let h1 = 5381;
    let h2 = 52711;
    for (let i = 0; i < norm.length; i++) {
        const c = norm.charCodeAt(i);
        h1 = ((h1 << 5) + h1 + c) | 0;
        h2 = ((h2 << 5) + h2 + c) | 0;
    }
    return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}`;
}
