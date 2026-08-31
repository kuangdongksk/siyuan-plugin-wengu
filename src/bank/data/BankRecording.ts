import type { QuestionBank } from "./QuestionBank";

/**
 * 作答记账（数据自托管一期，20260831）：运行时统计停写思源块属性，
 * 收敛进题库 stats/docStats——原 QuestionService 六个「读块属性→写块
 * 属性」两跳记账函数的等价迁移（语义逐条对齐：累计答错不清零、改判
 * 只翻 right 微调 wrongCount、AI 实时步不落细粒度）。函数式接 bank
 * （BankMigrate 同款友元模式——QuestionBank 已 500 行红线，不再内联）。
 */

/** 整题收口记账（steps）：返回整题对错；persist=false 时只记整题
 *  四字段（AI 实时步的细粒度不落盘，与原块属性口径一致）。 */
export async function recordStepsResult(
    bank: QuestionBank,
    qid: string,
    letters: string[],
    oks: boolean[],
    persist: boolean
): Promise<boolean> {
    const allOk = oks.length > 0 && oks.every(Boolean);
    const r = await statRecordOf(bank, qid);
    if (r) {
        r.stats.attempts++;
        if (!allOk) r.stats.wrongCount++;
        r.stats.lastAnswer = letters.join("|");
        r.stats.right = allOk ? "1" : "0";
        if (persist) {
            r.stats.stepRight = oks.map((ok) => (ok ? "1" : "0")).join("");
            r.stats.stepLast = letters.join("|");
        }
        r.stats.updatedAt = Date.now();
        bank.markDirty();
    }
    return allOk;
}

/** 整题收口记账（slots）：整题 right=全空对，逐空细粒度恒落盘。 */
export async function recordSlotsResult(
    bank: QuestionBank,
    qid: string,
    letters: string[],
    oks: boolean[]
): Promise<boolean> {
    const allOk = oks.length > 0 && oks.every(Boolean);
    const r = await statRecordOf(bank, qid);
    if (r) {
        r.stats.attempts++;
        if (!allOk) r.stats.wrongCount++;
        r.stats.lastAnswer = letters.join("|");
        r.stats.right = allOk ? "1" : "0";
        r.stats.slotRight = oks.map((ok) => (ok ? "1" : "0")).join("");
        r.stats.slotLast = letters.join("|");
        r.stats.updatedAt = Date.now();
        bank.markDirty();
    }
    return allOk;
}

/** 改判（brief AI 误判纠错/自评更正）：只翻 right 不动 attempts；
 *  错改对回退一次 wrongCount，对改错补记一次。 */
export async function overrideAnswer(bank: QuestionBank, qid: string, correct: boolean): Promise<void> {
    const r = await statRecordOf(bank, qid);
    if (!r) return;
    r.stats.right = correct ? "1" : "0";
    if (correct) {
        if (r.stats.wrongCount > 0) r.stats.wrongCount--;
    } else {
        r.stats.wrongCount++;
    }
    r.stats.updatedAt = Date.now();
    bank.markDirty();
}

/** steps 改判（方法步申诉复核通过）：翻逐步细粒度与整题 right；
 *  整题由错翻对时回退一次 wrongCount。 */
export async function overrideStepsResult(
    bank: QuestionBank,
    qid: string,
    letters: string[],
    oks: boolean[]
): Promise<boolean> {
    const allOk = oks.length > 0 && oks.every(Boolean);
    const r = await statRecordOf(bank, qid);
    if (r) {
        const wasRight = r.stats.right === "1";
        r.stats.stepRight = oks.map((ok) => (ok ? "1" : "0")).join("");
        r.stats.stepLast = letters.join("|");
        r.stats.lastAnswer = letters.join("|");
        r.stats.right = allOk ? "1" : "0";
        if (!wasRight && allOk && r.stats.wrongCount > 0) r.stats.wrongCount--;
        r.stats.updatedAt = Date.now();
        bank.markDirty();
    }
    return allOk;
}

/** 文档累计刷题用时累加（原 total-time 文档块属性自托管；专题模式
 *  col: 前缀由调用方拦下不持久化，与原「内核写失败吞掉」语义一致）。 */
export async function addDocTime(bank: QuestionBank, docId: string, addSeconds: number): Promise<void> {
    if (!docId || addSeconds <= 0) return;
    const data = await bank.all();
    data.docStats[docId] = (data.docStats[docId] ?? 0) + addSeconds;
    bank.markDirty();
}

/** 记账目标记录（qid 剥 #k 后缀；不在库的题静默跳过——文档模式装载
 *  的题目装载后台链 ensureMigrated 后必在库，个别时序窗口丢一次统计
 *  可接受，与原「内核失败吞错」等位）。 */
async function statRecordOf(bank: QuestionBank, qid: string) {
    const data = await bank.all();
    return data.records[qid.split("#")[0]];
}
