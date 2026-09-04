/**
 * AI 消息图片行消毒（20260903 MiniMax 2013 真机踩坑）：
 * 思源内核 agent chat 用 Lute 解析用户消息，把 `![](assets/…)` 图片抠成
 * 本地附件、以 image_url + `detail:"auto"` 发给供应商（内核 agent/
 * attachments.go：无显式 detail 一律 auto，且单请求最多 4 张/20MB）。
 * 供应商 schema 不认 auto 时（MiniMax 只收 low/default/high，报
 * 「invalid params, invalid image detail: auto (2013)」）整批必挂。
 * 插件全部 AI 调用是纯文本任务——图片只需路径随题走，模型无需看图，
 * 故发送口（ai/client 两条公开通道）统一把 assets 图片行换成占位符，
 * 草稿解析侧（QuestionDraft.cleanPartText）确定性还原：落盘 kramdown
 * 与旧产物逐字同构，存量题集/指纹零影响。
 */

/** assets 图片 markdown（内核只抠 assets/ 前缀的 dest；含可选查询串）。 */
const ASSET_IMG_RE = /!\[[^\]\n]*\]\(\s*(assets\/[^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/** 占位符还原：容忍模型改写括号（〔〕/【】）、冒号（:/：）与空白。 */
const PLACEHOLDER_RE = /[〔【]插图\s*[:：]\s*([^\s〔【〕】]+)\s*[〕】]/g;

/** 发送前消毒：assets 图片 markdown → 〔插图:路径〕（Lute 解析不出图片
 *  节点，内核零附件；非 assets 图片内核本就不抠，保持原样）。 */
export function sanitizeAiImages(text: string): string {
    return text.replace(ASSET_IMG_RE, (_m: string, dest: string) => `〔插图:${dest}〕`);
}

/** 草稿还原：占位符 → `![](路径)`（幂等——已是图片行的文本原样过）。 */
export function restoreAiImages(text: string): string {
    return text.replace(PLACEHOLDER_RE, (_m: string, dest: string) => `![](${dest})`);
}
