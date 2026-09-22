/**
 * 位置敏感措辞（选项组跳过重排的唯一口径）。
 *
 * 「以上都对」「A 和 B」一类选项一旦重排就指代错乱，故凡消费本判据的
 * 重排动作一律**保留 AI 原序**。
 *
 * 口径单一、多处共用（Issue #214 自 `OptionShuffle` 收窄时接出）：
 *   - `bank/data/BankRepair`（存量挤行修复的洗牌）
 *   - `quiz/render/CardDisplayShuffle`（进卡现洗的展示层）
 * 改判据只改这里，别在调用侧另起正则。
 */
export const POSITION_SENSITIVE = /(以上|上述|都不|都是|全都|全部|均正确|均错误|\b[A-D]\b\s*(?:和|与|及))/;
