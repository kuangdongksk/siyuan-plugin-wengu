import { errText } from "./../../ui/shared";
import { showStatus, startConvertForView } from "../../convert";
import { convertRunActive, type ConvertRunCfg } from "../../convert/service/run/ConvertRun";
import { extractBlockId, getDocInfo } from "../../convert/service/core/ConvertService";
import { isBlankSource } from "../../convert/service/run/ConvertBatch";
import { KernelBlock } from "../../siyuan/block";
import { removeRecords } from "../../bank/data/BankSets";
import { planReimportBySegs, qidsFromOffset, segViewOf } from "../../convert/service/source/SetSegments";
import { fmt } from "../../ui/shared";
import { notifyInfo } from "../../ui/Notify";
import type { QuizView } from "../index";

/**
 * 目录题集右键「删除此题集」/「重新导入」（自 QuizView 拆出）：
 * - 删除此题集（20260903 起）：题集是题库内实体——清记录/元数据/材料/
 *   影子专题/会话历史即删净（docStats 一并随 removeDocData 口径保留，
 *   旧文档形态的存量题集不动文档本体）。
 * - 重新导入：网络中断等「导一半」的题集一键续做——查该源的续跑记录
 *   （prefs convertProgress），有则接着断点续写**同一题集**（已生成部分
 *   是题库里的真实记录，不重复生成、不重复花费）、无则清旧题集从头
 *   重转（新题集）。
 *
 * 内核调用全程尽力而为，失败停在中间态由下次操作重试。
 */

/** 严格块 id 形态（知识点根过滤用，同转换弹窗口径）。 */
const BLOCK_ID_RE = /^\d{14}-[a-z0-9]+$/i;

/** 题集配对的源讲义 id（set.srcId；无配对/自配对为空）。 */
export async function pairedSourceOf(v: QuizView, setId: string): Promise<string> {
    const bank = v.bankStore();
    if (!bank || !setId) return "";
    const data = await bank.all();
    const src = data.sets?.[setId]?.srcId ?? "";
    return src && src !== setId ? src : "";
}

/** 配对源讲义 id 且仍存活（右键菜单按它决定是否露出「重新导入」；
 *  查询失败按无源收口——fail-closed，不露出不可用的入口）。 */
export async function livingSourceOf(v: QuizView, setId: string): Promise<string> {
    try {
        const src = await pairedSourceOf(v, setId);
        if (!src) return "";
        const info = await getDocInfo(extractBlockId(src));
        return info?.notebook ? src : "";
    } catch (_) {
        return "";
    }
}

/** 「删除此题集」：清题库侧数据（记录/题集/材料/影子专题）+ 清会话
 *  历史后重载。 */
export function unregisterSetAsQuiz(v: QuizView, setId: string): void {
    void (async () => {
        try {
            if (convertRunActive()) {
                showStatus(v.el, v.t("convertBusy"), "err");
                return;
            }
            if (!setId) return;
            await v.bankStore()?.removeDocData(setId);
            await v.bankStore()?.flush();
            await v.historyStore()?.removeDocs([setId]);
            await v.reloadView(); // 选中回退链（当前>记住>活动>第一个）自动切离
        } catch (e) {
            // 原裸 IIFE：中途抛错=unhandled rejection 且点击像没反应
            showStatus(v.el, errText(e), "err");
        }
    })();
}

/** 重新导入的续跑参数（纯决策）：进度记录带题集 id 才有断点可接——
 *  已生成部分是题库里的真实记录（每批已 flush），续写同一题集。 */
export function reimportResume(
    rec: { offset: number; setId?: string } | undefined
): { offset: number; setId?: string } | undefined {
    return rec?.setId ? { offset: rec.offset, setId: rec.setId } : undefined;
}

/** 重新导入的转换参数（弹窗默认同款解析：prefs 上次 > 设置默认）。
 *  有续跑记录则接着上次断点续跑（已生成部分保留），无记录才从头重转。 */
export function reimportCfg(
    srcDocId: string,
    last: { modelId: string; fill: boolean; steps: boolean; know: string },
    settings?: { convertModelId?: string; fillToChoice?: boolean; bigToSteps?: boolean; convertParallel?: number },
    resume?: { offset: number; setId?: string }
): ConvertRunCfg {
    return {
        srcDocId,
        modelId: last.modelId || settings?.convertModelId || "",
        fillToChoice: last.fill || settings?.fillToChoice === true,
        bigToSteps: last.steps || settings?.bigToSteps === true,
        parallel: Math.max(1, Math.min(4, Math.floor(settings?.convertParallel ?? 1))),
        knowRoots: last.know
            .split(/[\s,;，；]+/)
            .map((s) => extractBlockId(s))
            .filter((s) => BLOCK_ID_RE.test(s)),
        resume,
    };
}

/**
 * 「重新导入」＝哈希检测优先，而非无条件全量重转：
 * 1. 有续跑记录（prefs convertProgress）→ 接着断点续写**同一题集**
 *    （已生成部分是题库里的真实记录，不重复生成、不重复花费）。
 * 2. 无记录 → 走源级凭据判定 `planReimportBySegs`（Issue #74、段表口径）：
 *    整篇哈希命中 = **零动作**（不删不烧）；段表在且比对出失配 = 删失配段
 *    起的记录后从该段续转；两者皆无（存量/无凭据）= 现状行为整卷重转。
 *
 * ⚠️ 判定顺序三条不许挪（见 `.agents/memory/convert.md`）：有记录优先于
 * 「源未变更」短路，且「无段表不认整篇哈希」（凭据缺失宁多烧不漏转）。
 *
 * 旧代 `H:` 结构切块增量链（三态分类 + 逐块选弹窗 + 省费模式设置项）已于
 * 20260922（Issue #212）整体删除——旧代存量题集已不存在，残余若真存在也
 * 只是「无 `segs`」这一支，退化为整卷重转，无数据风险。
 */
export function reimportDocFrom(v: QuizView, setId: string): void {
    void (async () => {
        try {
            await reimportDocFromInner(v, setId);
        } catch (e) {
            // 清旧数据/起跑中途抛错：原裸 IIFE 吞成 unhandled rejection
            showStatus(v.el, errText(e), "err");
        }
    })();
}

async function reimportDocFromInner(v: QuizView, setId: string): Promise<void> {
    if (convertRunActive()) {
        showStatus(v.el, v.t("convertBusy"), "err");
        return;
    }
    const bank = v.bankStore();
    if (!bank) return;
    const srcId = await livingSourceOf(v, setId);
    if (!srcId) {
        showStatus(v.el, v.t("reimportNoSource"), "err");
        return;
    }
    const rec = v.convertAccess.convertProgressOf(srcId);
    // 续跑：保留同一题集接着写（优先级 1——有记录=上次没跑完，不做「源未
    // 变更」短路、不做段比对）
    const resume = reimportResume(rec);
    if (resume) {
        notifyInfo({ key: "notifyReimportResume" });
        await startReimport(v, srcId, setId, resume);
        return;
    }
    // 逐段题集的源级判定（Issue #74）：整篇哈希命中=零动作；段表在=逐段
    // 比对从第一条失配段起重转；两者皆无（存量）=现状行为（整卷重转，
    // 不提示）
    const set = (await bank.all()).sets?.[setId];
    const src = await srcTextOf(srcId);
    if (!src) {
        showStatus(v.el, v.t("convertEmptyDoc"), "err");
        return;
    }
    const plan = planReimportBySegs(src, segViewOf(set));
    if (plan.kind === "unchanged") {
        // 优先级 2：源没改过 → 零动作（不删、不烧 AI），题集/统计/专题原样
        showStatus(v.el, v.t("notifyReimportUnchanged"), "ok");
        return;
    }
    if (plan.kind === "partial") {
        // 优先级 3：删失配段起的记录（含 hashed/专题引用），从该段续转
        const qids = qidsFromOffset(await bank.all(), setId, plan.deleteFrom);
        if (qids.length > 0) {
            await removeRecords(bank, qids);
            await bank.flush();
        }
        showStatus(v.el, fmt(v.t("notifyReimportPartial"), { n: String(plan.keptSegs) }), "muted");
        await startReimport(v, srcId, setId, { offset: plan.from, setId });
        return;
    }
    // 存量题集：无凭据 → 现状行为（整卷重转，不提示）
    await startReimport(v, srcId, setId, undefined);
}

/**
 * 启动一次重新导入（转换参数组装 + 视图重载 + 起跑）。`resume` 为空时
 * 先清旧题集侧数据（记录/材料/影子专题 + 会话历史），再从头重转新题集。
 *
 * ⚠️ 进度记录的清理**仅非续跑**（Issue #208）：续跑路径在起跑前把记录
 * 清掉＝先毁断点；一旦续跑第一批判定就挂（count=0），原先 `settleFailed`
 * 的 `count > 0` 闸不放行 ⇒ 清了没写回，断点凭空蒸发。主修 2 已在
 * ConvertBatch 侧对账落伍偏移（以段表末段为准），故留着记录无重复风险。
 */
async function startReimport(
    v: QuizView,
    srcId: string,
    setId: string,
    resume: { offset: number; setId?: string } | undefined
): Promise<void> {
    const bank = v.bankStore();
    if (!bank) return;
    if (!resume) {
        await bank.removeDocData(setId);
        await bank.flush();
        await v.historyStore()?.removeDocs([setId]);
        v.convertAccess.saveConvertProgress(srcId, undefined);
    }
    await v.reloadView(); // 侧栏先摘掉旧题集，转换条/渐进呈现落在新 DOM 上
    const started = startConvertForView(
        v.convertAccess,
        reimportCfg(srcId, v.convertAccess.lastConvert(), v.settingsOf(), resume)
    );
    if (!started) showStatus(v.el, v.t("convertBusy"), "err"); // reload 间隙被抢跑的兜底
}

/**
 * 源文档的 kramdown 读成**与转换入口同一条字符串**（剥掉块 id IAL 行，
 * 含引用前缀变体，20260910 起 ConvertBatch 的 `A:` 偏移口径就是它）——
 * 重导的整篇/逐段哈希必须与转换期写下的哈希同源，否则永远判不出「未
 * 变更」。读取失败归空串（哈希必不命中 → 落到段比对/整卷重转，宁多烧
 * 不漏转）。
 */
async function srcTextOf(srcId: string): Promise<string> {
    try {
        const kd = await KernelBlock.kramdown(extractBlockId(srcId));
        const text = String((kd.data as { kramdown?: string } | null)?.kramdown ?? "").replace(
            /^\s*(?:>\s*)?\{:([^}\n]*)\bid="[^"]*"[^\n]*$/gm,
            ""
        );
        // 源文档被清空/只剩属性行与空围栏：走转换链的同一判空口径直接报
        // 「文档内容为空」（否则整卷重转跑到 ConvertBatch 才失败——那一步
        // 已经把旧题集清掉了，用户看到的是「题没了 + 一句空文档」）。
        // 纯读侧判空，不改转换链本体。
        return !text.trim() || isBlankSource(text) ? "" : text;
    } catch (_) {
        return "";
    }
}
