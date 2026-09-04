import { GROUP_PREV } from "../../siyuan/attrs";
import type { QuestionBank, BankRecord } from "../../bank/data/QuestionBank";
import { mintMatId, mintQid, mintSetId, removeRecords } from "../../bank/data/BankSets";
import { parseQuestionKramdown, questionHash } from "../../bank/data/BankParse";
import { renderUnit } from "./QuestionDraft";
import type { DraftUnit } from "./QuestionDraft";
import type { WenguMaterial, WenguQuestion } from "../../types";

/**
 * 题集写入器（20260903 起转换产物不再落文档，直接写题库）：一次转换
 * 开一个题集（BankSet），批结果按「连续完成前缀」到达后逐单元入库——
 * 题目 renderUnit 出契约 kramdown（格式冻结不变）→ parseQuestionKramdown
 * 反解 + questionHash 构造 BankRecord（与旧「落文档再回读入库」产物
 * 同构，解析/指纹/渲染链零分叉）；材料块正文直接进 bank.materials，
 * 小题的 group="prev" 占位改为写时直配材料 id（文档序回写通道退役）。
 *
 * 每批 markDirty 由调用方按批 flush（崩溃安全：已写记录即已落盘，
 * 终止「保留」零额外动作、「丢弃」按本次 qid 清单回收）。
 */

/** 一次写入的产物（渐进预览与丢弃清单共用）。 */
export interface AppendOut {
    /** 本次写入的题目 id（丢弃回收清单）。 */
    qids: string[];
    /** 逐单元产物（题目含 kramdown 与解析视图；材料只带视图）。 */
    units: { qid?: string; kd: string; question?: WenguQuestion; material: boolean }[];
    /** 本次写入题目的解析视图（渐进预览直用，无内核 IO）。 */
    questions: WenguQuestion[];
    /** 本次写入的材料（渐进预览直用）。 */
    materials: WenguMaterial[];
}

export class SetWriter {
    /** 跨批跟踪「最近一个材料」：小题 group=prev 引用文中紧邻其前的
     *  材料块（与旧文档序语义一致——材料先于小题产出）。undefined=尚未
     *  播种（冷启动）：增量/续跑接管的既有题集，首次 append 前从库内
     *  该集最新材料播种，跨块 group 不丢（20260903 审查 P2）。 */
    private lastMaterialId: string | undefined;

    constructor(private readonly bank: QuestionBank) {}

    /** 开（或续挂）本次转换的题集：setId 给定且存在=续跑接管；否则新建。
     *  源卷影子专题（专题面板「·源卷」行）随建，题单随写维护。 */
    async openSet(opts: { setId?: string; title: string; srcId?: string; hPath?: string }): Promise<string> {
        const data = await this.bank.all();
        data.sets ??= {};
        const id = opts.setId && data.sets[opts.setId] ? opts.setId : mintSetId();
        if (!data.sets[id]) {
            data.sets[id] = {
                id,
                title: opts.title,
                ...(opts.hPath ? { hPath: opts.hPath } : {}),
                ...(opts.srcId ? { srcId: opts.srcId } : {}),
                qids: [],
                createdAt: Date.now(),
            };
            data.collections.push({
                id: `doc:${id}`,
                title: `${opts.title}·源卷`,
                qids: [],
                origin: "manual",
                createdAt: Date.now(),
            });
        } else {
            // 续跑：元数据以本次为准补齐（旧记录可能缺 srcId/hPath）
            const s = data.sets[id];
            if (opts.title && !s.title) s.title = opts.title;
            if (opts.srcId && !s.srcId) s.srcId = opts.srcId;
            if (opts.hPath && !s.hPath) s.hPath = opts.hPath;
        }
        this.bank.markDirty();
        return id;
    }

    /** 追加一批协议单元（须按原卷顺序连续前缀到达）。返回本次产物。 */
    async append(setId: string, units: { draft: DraftUnit; srcKey?: string; srcHash?: string }[]): Promise<AppendOut> {
        const data = await this.bank.all();
        const set = data.sets?.[setId];
        if (!set) throw new Error(`set ${setId} not found`);
        data.materials ??= {};
        if (this.lastMaterialId === undefined) {
            // 冷启动播种：接管的既有题集取其最新材料为「文中紧邻其前」
            // ——增量块首题 group=prev 引用的是上一块尾的材料
            let seed = "";
            for (const m of Object.values(data.materials)) if (m.setId === setId) seed = m.id;
            this.lastMaterialId = seed;
        }
        const out: AppendOut = { qids: [], units: [], questions: [], materials: [] };
        for (const { draft, srcKey, srcHash } of units) {
            if (draft.material) {
                const body = draft.parts
                    .filter((p) => p.name === "body")
                    .map((p) => p.text)
                    .join("\n\n");
                const trans = draft.parts
                    .filter((p) => p.name === "trans")
                    .map((p) => p.text)
                    .join("\n\n");
                if (!body && !trans) continue; // 空材料跳过（与旧入库口径一致）
                const mat = {
                    id: mintMatId(),
                    setId,
                    ...(body ? { bodyMd: body } : {}),
                    ...(trans ? { transMd: trans } : {}),
                };
                data.materials[mat.id] = mat;
                this.lastMaterialId = mat.id;
                out.materials.push({ id: mat.id, rootId: setId, bodyMd: mat.bodyMd, transMd: mat.transMd });
                out.units.push({ kd: renderUnit(draft, { srcKey, srcHash }), material: true });
                continue;
            }
            const qid = mintQid();
            const group = draft.attrs.group === GROUP_PREV ? (this.lastMaterialId ?? "") : "";
            const attrs = { ...draft.attrs };
            delete attrs.group; // group 改由记录字段承载，不再进 kramdown IAL
            const kd = renderUnit({ ...draft, attrs }, { srcKey, srcHash });
            const parsed = parseQuestionKramdown(kd, qid, setId);
            if (!parsed) continue; // 渲染-解析回路失败：跳过（与旧入库口径一致）
            if (group) parsed.group = group; // 渐进预览直用 out.questions，组链随行（读侧同款回填）
            const hash = questionHash(kd);
            const record: BankRecord = {
                qid,
                kramdown: kd,
                type: parsed.type ?? "brief",
                ...(parsed.knowledge ? { knowledge: parsed.knowledge } : {}),
                ...(parsed.chapter ? { chapter: parsed.chapter } : {}),
                ...(parsed.difficulty !== undefined ? { difficulty: parsed.difficulty } : {}),
                kpRefs: parsed.kpRefs,
                sourceDocId: setId,
                hash,
                stats: { attempts: 0, wrongCount: 0, updatedAt: Date.now() },
                ...(group ? { group } : {}),
                ...(srcKey ? { srcKey } : {}),
                ...(srcHash ? { srcHash } : {}),
            };
            data.records[qid] = record;
            if (!data.hashed[hash]) data.hashed[hash] = qid;
            set.qids.push(qid);
            const col = data.collections.find((c) => c.id === `doc:${setId}`);
            if (col) col.qids.push(qid);
            out.qids.push(qid);
            out.questions.push(parsed);
            out.units.push({ qid, kd, question: parsed, material: false });
        }
        if (out.qids.length > 0 || out.materials.length > 0) this.bank.markDirty();
        return out;
    }

    /** 「全部丢弃」：本次写入的题目逐条回收；题集因此清空（含零题空壳
     *  ——只出材料的批也建了题集，20260903 审查 P3）则连 set/材料/
     *  影子专题一起删（removeDocData 同款语义）。 */
    async discard(setId: string | undefined, qids: string[]): Promise<void> {
        if (!setId) return;
        const data = await this.bank.all();
        const set = data.sets?.[setId];
        if (set && set.qids.every((q) => qids.includes(q))) {
            await this.bank.removeDocData(setId);
        } else {
            await removeRecords(this.bank, qids);
        }
        await this.bank.flush();
    }
}
