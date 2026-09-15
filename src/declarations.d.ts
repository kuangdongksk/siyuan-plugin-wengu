declare module "*.scss" {
    const content: Record<string, string>;
    export default content;
}

// *.svelte 的模块类型由 svelte 包自带的环境声明提供（svelte/types），
// 此处不再重复声明，避免 TS2300 重复标识符。

// 源码原文导入（vitest 支持）：单测做「组件结构/文案键」类源级断言时
// 用它替代 node:fs——本仓没有 @types/node，node 内置模块无法通过
// svelte-check 的类型检查。
declare module "*?raw" {
    const content: string;
    export default content;
}

// `import.meta.glob` 的类型（vitest/vite 提供运行时，本仓不引 vite/client
// 全量类型，故在此单独补最小声明）：源级断言要**扫全仓**（死键盘点 /
// 「title 不许硬编码中文」这类跨文件口径），逐个 `?raw` 导入不现实，
// glob + `{ query: "?raw", eager: true }` 是唯一可行形态。
interface ImportMeta {
    glob(pattern: string, options: { query: string; import: string; eager: true }): Record<string, string>;
}
