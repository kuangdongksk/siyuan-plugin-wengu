/**
 * kramdown 文本工具（纯函数，零内核调用）。
 *
 * IAL 残渣清理（20260829 题库真机踩坑）：思源 kramdown 读回时，列表项/
 * 块引用等子块的 IAL 会行内尾随或带缩进/引用前缀独立成行落盘——如
 * `- {: id="…" updated="…"}A. …`、`  {: id="…" …}`、`> {: id="…" …}`。
 * 按行解析 kramdown 的消费方（题库解析/渲染/体检）一律先过 stripIal，
 * 否则渲染侧变成 "updated=…"}A. 字面泄漏。
 */

/** 整行属性行（允许缩进/引用前缀）。 */
export const IAL_LINE = /^[ \t]*(?:>[ \t]*)*\{:[^}\n]*\}[ \t]*$/;
/** 行内尾随片段（key="value" 全形态约束，不误伤公式里的 \{ 之类）。 */
export const IAL_INLINE = /\{:(?:[ \t]*[a-zA-Z-]+="[^"\n]*")+[ \t]*\}/g;

/** IAL 残渣清理：整行属性行删行、行内尾随片段删片段。 */
export function stripIal(text: string): string {
    return text
        .split("\n")
        .filter((ln) => !IAL_LINE.test(ln))
        .join("\n")
        .replace(IAL_INLINE, "");
}
