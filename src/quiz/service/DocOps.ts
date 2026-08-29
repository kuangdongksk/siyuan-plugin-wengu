import { ATTR_PREFIX, Attr } from "../../siyuan/attrs";
import { KernelBlock } from "../../siyuan/block";
import { KernelDoc } from "../../siyuan/doc";
import { KernelQuery } from "../../siyuan/query";
import { showStatus, startConvertForView } from "../../convert";
import { convertRunActive, type ConvertRunCfg } from "../../convert/service/ConvertRun";
import { extractBlockId, getDocInfo } from "../../convert/service/ConvertService";
import type { QuizView } from "../index";

/**
 * 目录文档右键「删除此题集」/「重新导入」（自 QuizView 拆出）：
 * - 删除此题集（20260829 起替代「删除文档」）：只解除题集登记——把
 *   文档内全部 wengu 属性**置空剥离**（内核 setBlockAttrs 空值=删属性，
 *   20260829 真机探针验证）+ 清题库/会话历史，**文档本体与内容原样
 *   保留**、不再进回收站；source-doc 配对随属性一并剥离，此后源讲义
 *   被删也不会被 OrphanCleaner 连带删除。
 * - 重新导入：网络中断等「导一半」的题集一键重做——删旧题集（回收
 *   站可找回）+ 清插件侧数据，再以上次转换设置把配对源讲义重转一份
 *   新《源·习题》（另存模式、生成在源讲义旁，源讲义不动）。
 *
 * fetchSyncPost 必须串行（内核并发互吞响应）；内核调用全程尽力而为，
 * 失败停在中间态由下次操作重试。
 */

/** 块 id 字符集校验（拼 SQL 前防脏值，同 OrphanCleaner）。 */
const ID_RE = /^[\w-]+$/;

/** 严格块 id 形态（知识点根过滤用，同转换弹窗口径）。 */
const BLOCK_ID_RE = /^\d{14}-[a-z0-9]+$/i;

/** 题集的配对源讲义 id（attributes 表查 source-doc；无配对/自配对为空）。 */
export async function pairedSourceDoc(docId: string): Promise<string> {
    if (!ID_RE.test(docId)) return "";
    const rows = await KernelQuery.rows<{ srcId?: string }>(
        `SELECT value AS srcId FROM attributes WHERE name = '${Attr.sourceDoc}' AND block_id = '${docId}' LIMIT 1`
    );
    const src = String(rows[0]?.srcId ?? "");
    return src && ID_RE.test(src) && src !== docId ? src : "";
}

/** 配对源讲义 id 且仍存活（右键菜单按它决定是否露出「重新导入」；
 *  查询失败按无源收口——fail-closed，不露出不可用的入口）。 */
export async function livingSourceOf(docId: string): Promise<string> {
    try {
        const src = await pairedSourceDoc(docId);
        if (!src) return "";
        const info = await getDocInfo(extractBlockId(src));
        return info?.notebook ? src : "";
    } catch (_) {
        return "";
    }
}

/** 属性行按块分组（剥离用：一块一次 setAttrs 清掉它的全部 wengu 属性）。 */
export function groupAttrsByBlock(rows: { id?: string; name?: string }[]): Map<string, string[]> {
    const byBlock = new Map<string, string[]>();
    for (const r of rows) {
        if (!r.id || !r.name) continue;
        const names = byBlock.get(r.id) ?? [];
        if (!names.includes(r.name)) names.push(r.name);
        byBlock.set(r.id, names);
    }
    return byBlock;
}

/** 「删除此题集」：剥离 wengu 属性（文档与内容保留）+ 清插件侧数据后重载。 */
export function unregisterDocAsQuiz(v: QuizView, docId: string): void {
    void (async () => {
        if (convertRunActive()) {
            showStatus(v.el, v.t("convertBusy"), "err");
            return;
        }
        if (!ID_RE.test(docId)) return;
        try {
            // rowsAll 自动分页：大卷题目属性行数超 64 会被无 LIMIT 截断
            const rows = await KernelQuery.rowsAll<{ id?: string; name?: string }>(
                `SELECT block_id AS id, name FROM attributes WHERE root_id = '${docId}' AND name LIKE '${ATTR_PREFIX}%'`
            );
            for (const [id, names] of groupAttrsByBlock(rows)) {
                const attrs: Record<string, string> = {};
                for (const n of names) attrs[n] = "";
                await KernelBlock.setAttrs(id, attrs);
            }
        } catch (_) {
            return; // 剥离失败不动插件数据，下次再试
        }
        await v.bankStore()?.removeDocData(docId);
        await v.bankStore()?.flush();
        await v.historyStore()?.removeDocs([docId]);
        await v.reloadView(); // 选中回退链（当前>记住>活动>第一个）自动切离
    })();
}

/** 重新导入的转换参数（弹窗默认同款解析：prefs 上次 > 设置默认）。 */
export function reimportCfg(
    srcDocId: string,
    last: { modelId: string; fill: boolean; steps: boolean; know: string },
    settings?: { convertModelId?: string; fillToChoice?: boolean; bigToSteps?: boolean; convertParallel?: number }
): ConvertRunCfg {
    return {
        srcDocId,
        modelId: last.modelId || settings?.convertModelId || "",
        fillToChoice: last.fill || settings?.fillToChoice === true,
        bigToSteps: last.steps || settings?.bigToSteps === true,
        parallel: Math.max(1, Math.min(4, Math.floor(settings?.convertParallel ?? 1))),
        writeMode: "newdoc",
        targetRaw: "",
        knowRoots: last.know
            .split(/[\s,;，；]+/)
            .map((s) => extractBlockId(s))
            .filter((s) => BLOCK_ID_RE.test(s)),
        resume: undefined, // 重导=从头重转，不吃旧续跑记录（续走弹窗「继续生成」）
    };
}

/** 「重新导入」：删旧题集（回收站）+ 清插件侧数据 + 清旧续跑记录，以上次设置重转源讲义。 */
export function reimportDocFrom(v: QuizView, docId: string): void {
    void (async () => {
        if (convertRunActive()) {
            showStatus(v.el, v.t("convertBusy"), "err");
            return;
        }
        const srcId = await livingSourceOf(docId);
        if (!srcId) {
            showStatus(v.el, v.t("reimportNoSource"), "err");
            return;
        }
        try {
            const { code } = await KernelDoc.remove(docId);
            if (code !== 0) return; // 删除失败不动插件数据，下次再试
        } catch (_) {
            return;
        }
        await v.bankStore()?.removeDocData(docId);
        await v.bankStore()?.flush();
        await v.historyStore()?.removeDocs([docId]);
        v.convertAccess.saveConvertProgress(srcId, undefined);
        await v.reloadView(); // 侧栏先摘掉旧题集，转换条/渐进呈现落在新 DOM 上
        const started = startConvertForView(
            v.convertAccess,
            reimportCfg(srcId, v.convertAccess.lastConvert(), v.settingsOf())
        );
        if (!started) showStatus(v.el, v.t("convertBusy"), "err"); // reload 间隙被抢跑的兜底
    })();
}
