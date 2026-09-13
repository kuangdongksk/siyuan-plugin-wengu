import type { QuizView } from "../index";
import { isBadMarked, markBad } from "../../bank/data/BadMark";
import { notifyInfo } from "../../ui/Notify";

/**
 * 卡头「标记为错题」开关（Issue #46）：两态切换（标记高亮 / 再点取消），
 * 语义=题目本身出错/生成质量差、待批量重转——**不是**错题本的「作答
 * 错误」（文案与 title 已区分）。
 *
 * 钮只在预览模式渲染（题卡 model.preview），但判定收在这里再挡一道：
 * bindCardActions 的委托挂视图根、跨整壳重建常驻，视图切回做题后旧 DOM
 * 的 mousedown 竞态理论上仍可命中（宁缺勿错）。
 *
 * 标记态由**视图重渲染回灌**（badMarks 经 QuizShell 查库喂组件初态），
 * 组件自己不持标记状态——落盘后重渲染即所见即所得。
 */
export async function toggleBadMark(v: QuizView, qid: string): Promise<void> {
    if (v.mode !== "preview" || !qid) return;
    const bank = v.bankStore();
    if (!bank) {
        notifyInfo({ key: "regenNoRecord" });
        return;
    }
    // 记录已在库才算标记（gen- 与转换产物都在；解析失败记录也能标记）
    const on = !(await isBadMarked(bank, qid));
    if (!(await markBad(bank, qid, on))) return;
    await bank.flush(); // 标记立即落盘：重开页签/换卷仍在（验收 2）
    notifyInfo({ key: on ? "badMarkDone" : "badMarkUndone" });
    v.renderQuizList(); // 标记钮高亮 + 头部徽标一起刷新
}
