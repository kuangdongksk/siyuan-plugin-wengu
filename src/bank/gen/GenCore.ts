import { generateQuestion } from "./GenQuestion";
import { injectKnowledgeRefs } from "../../convert/service/KnowRef";
import { knowRootsOf } from "../data/KnowRoots";
import { lexiconOfRoots, textRefsFor, type LexSection } from "../data/KnowLinkText";
import { knowTreesOf } from "../data/KnowTrees";
import type { QuestionBank } from "../data/QuestionBank";
import { addGenerated } from "../data/BankRegen";

/**
 * 逐点生成核（薄弱加练 WeakDrill 与收集补题 CollectionDialog 共用，
 * 2026-08-26 从两处逐行同构的循环抽出）：逐点补足 perPoint、总量封顶
 * count、总尝试封顶 count*3（单点持续失败时止损，防烧 token）。
 * concept 模式遇到非 kp: 键自动降级 variant（概念辨析要小节块 id，
 * kn:/ch: 键给不出）——降级发生时返回 degraded 供完成消息提示。
 */

/** 生成点（薄弱画像行/知识索引行都满足这个形态）。 */
export interface GenPoint {
    key: string;
    title: string;
}

export interface GenCoreOpts {
    /** 归属专题名（addGenerated 记录来源）。 */
    title: string;
    mode: "variant" | "concept";
    /** 目标题数。 */
    count: number;
    modelId: string;
    /** 生成题入专题（两调用方的 append 通道不同）。 */
    append(qid: string): Promise<void>;
    /** 进度展示（made=已生成数，pointTitle=当前点标题）。 */
    progress(made: number, pointTitle: string): void;
    t: (key: string) => string;
}

/** 跑生成核。返回实际生成数与是否发生过模式降级。 */
export async function genIntoCollection(
    bank: QuestionBank,
    points: GenPoint[],
    opts: GenCoreOpts
): Promise<{ made: number; degraded: boolean }> {
    const perPoint = points.length > 0 ? Math.max(1, Math.ceil(opts.count / points.length)) : 0;
    let made = 0;
    let attempt = 0;
    let degraded = false;
    // kn:/ch: 自由文本键的引用来源：登记根词表按标题归一匹配（零 AI、
    // 唯一命中才挂，同「导入即关联」语义）。词表 SQL 较重，惰性建一次。
    let lex: Map<string, LexSection[]> | undefined;
    const lexOf = async (): Promise<Map<string, LexSection[]>> => {
        if (!lex) lex = await lexiconOfRoots(await knowRootsOf(bank), await knowTreesOf(bank));
        return lex;
    };
    for (const p of points) {
        let madeHere = 0;
        while (madeHere < perPoint && made < opts.count && attempt < opts.count * 3) {
            attempt++;
            let mode = opts.mode;
            if (mode === "concept" && !p.key.startsWith("kp:")) {
                mode = "variant";
                degraded = true;
            }
            opts.progress(made, p.title);
            const kd = await generateQuestion(bank, p, mode, opts.modelId);
            if (!kd) continue;
            const kpId = p.key.startsWith("kp:") ? p.key.slice(3) : "";
            let refs = kpId ? [{ id: kpId, title: p.title }] : [];
            if (refs.length === 0) {
                const hits = textRefsFor(p.title, await lexOf());
                if (hits.length === 1) refs = [{ id: hits[0].id, title: hits[0].title }];
            }
            const qid = await addGenerated(bank, injectKnowledgeRefs(kd, refs), refs, opts.title);
            await opts.append(qid);
            madeHere++;
            made++;
        }
        if (made >= opts.count) break;
    }
    return { made, degraded };
}
