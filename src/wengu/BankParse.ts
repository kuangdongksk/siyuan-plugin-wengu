import type {WenguQuestion} from "./types";
import type {WenguStep} from "./types";
import {
    cleanStemMd,
    normalizeAnswerMd,
    normalizeType,
    parseDifficulty,
    parseStepKinds,
    splitOptionMd,
} from "./types";

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

/** 容器 IAL 里的自定义属性值（custom-plugin-wengu- 前缀剥除后取裸名）。 */
function containerAttr(ial: string, name: string): string | undefined {
    const m = new RegExp(`custom-plugin-wengu-${name}="([^"]*)"`).exec(ial);
    return m ? m[1] : undefined;
}

/** 按 part IAL 行把容器体切段：part 名 → 该块去 IAL 的 markdown。 */
function splitParts(kd: string): {containerIal: string; parts: Map<string, string[]>;} {
    const parts = new Map<string, string[]>();
    let containerIal = "";
    let buf: string[] = [];
    let part = "";
    const flush = () => {
        const text = buf.join("\n").trim();
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
    return {containerIal, parts};
}

/** 题库题目：解析出的结构化视图 + 知识点引用（反链目标）。 */
export interface ParsedQuestion extends WenguQuestion {
    /** 知识点标题块引用（解析里的 ((id "标题"))，按序去重）。 */
    kpRefs: {id: string; title: string;}[];
}

/** 解析题目 kramdown；容器缺 q/type 等关键属性时返回 undefined。 */
export function parseQuestionKramdown(kd: string, qid: string, rootId?: string): ParsedQuestion | undefined {
    const {containerIal, parts} = splitParts(kd);
    if (!containerIal) return undefined;
    const type = normalizeType(containerAttr(containerIal, "type") ?? "");
    if (!type) return undefined;
    const q: ParsedQuestion = {id: qid, ...(rootId ? {rootId} : {}), type, attempts: 0, wrongCount: 0, kpRefs: []};
    const difficulty = parseDifficulty(containerAttr(containerIal, "difficulty") ?? "");
    if (difficulty !== undefined) q.difficulty = difficulty;
    const knowledge = containerAttr(containerIal, "knowledge");
    if (knowledge) q.knowledge = knowledge;
    const chapter = containerAttr(containerIal, "chapter");
    if (chapter) q.chapter = chapter;
    const kinds = parseStepKinds(containerAttr(containerIal, "steps") ?? "");
    if (kinds) q.steps = kinds.map((kind): WenguStep => ({kind, stemMd: "", optionMd: [], answer: ""}));

    const options: {index: number; md: string;}[] = [];
    const stepAcc = new Map<number, {stems: string[]; options: {index: number; md: string;}[]; answers: string[];}>();
    const stepOf = (k: number) => {
        let acc = stepAcc.get(k);
        if (!acc) {
            acc = {stems: [], options: [], answers: []};
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
                else acc.options.push({index: sm[3] !== undefined ? Number(sm[3]) : acc.options.length, md});
                continue;
            }
            const om = /^option(?:-(\d+))?$/.exec(part);
            if (om) {
                options.push({index: om[1] !== undefined ? Number(om[1]) : options.length, md});
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
        .map(([, acc], i) =>
            ({
                kind: kindList?.[i] ?? "result",
                stemMd: acc.stems.join("\n\n"),
                optionMd: acc.options
                    .sort((x, y) => x.index - y.index)
                    .flatMap((o) => splitOptionMd(o.md)),
                answer: normalizeAnswerMd(acc.answers.join("\n")),
            }) satisfies WenguStep
        );
    if (steps.length > 0) q.steps = steps;

    const seen = new Set<string>();
    for (const m of solution.matchAll(/\(\((\d{14}-[a-z0-9]+)\s+"([^"]{1,80})"\)\)/g)) {
        if (!seen.has(m[1])) {
            seen.add(m[1]);
            q.kpRefs.push({id: m[1], title: m[2]});
        }
    }
    return q;
}

/** 内容指纹：剥掉块 id/updated 属性后哈希（跨卷同题去重用）。 */
export function questionHash(kd: string): string {
    const norm = kd
        .replace(/\s+id="[^"]*"/g, "")
        .replace(/\s+updated="[^"]*"/g, "")
        .replace(/\s+/g, " ")
        .trim();
    let h = 5381;
    for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
}
