/**
 * 纯标题块判定（原 `source/SrcChunk.ts` 的保留项，20260922 Issue #212 随
 * 旧代 `H:` 结构切块链整体退役后单独留在这里）。
 *
 * 主转换链在用：`run/ConvertSegment` 的自推进循环里，纯标题窗口（章标题
 * 直挂子标题）零内容——发 AI 只会白耗一次必然 `CAN_CONVERT:no` 的调用，
 * 故按窗口判定后直接推游标。
 *
 * 本模块**纯函数**，不依赖任何旧代结构切块设施。
 */

/** 标题行（markdown/kramdown 通用形态）。 */
const HEAD_RE = /^[ \t]{0,3}(#{1,6})[ \t]+(\S.*)$/;

/** 纯标题块：去掉标题行与空白后无内容（「章标题下直接挂子标题」的
 *  层级结构常见，20260902 真机：一篇 159 批的题解文档有 9 批）——
 *  发批前跳过，省掉必然 CAN_CONVERT:no 的空调用与面板噪音。 */
export function isHeadingOnlyChunk(text: string): boolean {
    return !text.split(/\r?\n/).some((l) => l.trim() && !HEAD_RE.test(l));
}
