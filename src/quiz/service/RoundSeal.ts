import type { WenguSession } from "./HistoryStore";
import { isAbandonedRound } from "./ResumePicker";

/**
 * 轮次封卷（Issue #169 调查项，20260918）：**桌面「结束进行中的一轮」的
 * 唯一实现体**——`QuizView.finishSession`（切卷 / 重开页签 / 刷新 / 销毁 /
 * 收卷）只留一行调用，判定与落盘都在这里。
 *
 * ## 为什么单开一片
 * 收卷链的落库散在视图侧的 `finishSession` 里，而视图文件是**有豁免但额度
 * 只许减不许增**的编排文件（`src/quiz/index.ts`，上限 561 行）；把判定
 * 塞进去既顶额度，也让「封卷」这条链没有可单测的落点。判定本身又与移动端
 * 退屏/卸载共用一个口径（{@link isAbandonedRound}），故按语义收到本片。
 *
 * ## 空轮不封卷，改真删（本单修的真漏擦路径）
 * 开轮即 upsert（`StartPanel.startRound`，那是「未完成轮可继续」的依托）。
 * 用户「开了轮没答题就切卷 / 刷新 / 关页签」时，旧实现在这里无视空轮、
 * 一律 `endedAt + upsert` 封卷——**upsert 同 id 是整条替换，不是删除**，
 * 于是库里留下一条 `{answered: 0, endedAt}` 的孤儿（真机
 * `mu6anse2-2zarfg`：开轮 3 秒被写 `endedAt`，正是本形态）。
 *
 * ⚠️ **不要再把空轮归给倒计时那条链**（上一版盘点结论错在这）：倒计时
 * 归零走 `finishNow → finishRoundGuarded → closeEmptyRound`，那条链是**真
 * `removeSession`**、压根不写 `endedAt`；且倒计时最短档 1 分钟
 * （`clampMinutes` 下限），「开轮 3 秒」在物理上到不了归零。全仓写
 * `endedAt` 的落点只有两处：**桌面本函数**与移动端 `MobileDrill.endRound`
 * （用户主动交卷，空轮已被守卫拦在前面）——所以这类历史空轮就是这里漏出去的。
 *
 * 处置语义与 #155/#158「空轮＝这轮没发生过」一致：**真删、不写 `endedAt`、
 * 不进 `finished`**（返回值 `undefined`，视图侧拿到的 `finished` 即空，
 * 报告的已有的出态判据自然不成立）。有作答（含「不会」）的轮照旧封卷。
 *
 * 存量历史仍按**纯读侧兼容**：本函数只处置「正在结束」的那一轮，历史里的
 * 旧空轮不迁移、不擦（面板/探测跳过即可）。
 */

/** 落盘写侧能力（`HistoryStore` 结构匹配；测试壳只实现用到的两个方法）。 */
export interface RoundStore {
    upsert(s: WenguSession): Promise<void>;
    removeSession(id: string): Promise<void>;
}

/** 封卷入参：视图侧在封卷那一刻量到的用时与思路快照。 */
export interface SealInput {
    /** 会话总用时（秒，到最近一次收卷为止）。 */
    elapsedSec: number;
    /** 题卡「思路」输入区的一次性快照（未作答的题也保留）。 */
    thoughts: Record<string, string>;
}

/** 封卷一轮，返回**要展示的报告快照**；空轮返回 `undefined`（见文件头）。 */
export function sealRound(store: RoundStore | undefined, s: WenguSession, input: SealInput): WenguSession | undefined {
    if (isAbandonedRound(s)) {
        // 开轮时落盘的那条 0 作答记录必须**删掉**（不是覆盖）：留着就是
        // 统计总览的轮次数与趋势图各多一轮、恢复探测白扫一遍
        void store?.removeSession(s.id);
        return undefined;
    }
    s.endedAt = Date.now();
    s.elapsedSec = Math.max(s.elapsedSec, input.elapsedSec);
    s.thoughts = input.thoughts; // 思路随卷快照（未作答的题也保得住；6-4b 走题卡登记表）
    void store?.upsert(s);
    return s;
}
