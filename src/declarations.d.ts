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
// 「title 不许硬编码中文」这类跨文件口径），逐个 `?raw` 导入不现实。
// 两种形态都声明（口径见 `src/testkit/readSource.ts`，读源码统一走它）：
//   - `eager: true` —— 键相对**本文件**、值即源码（跨层同名会撞车）；
//   - 省略 `eager` —— 键相对**仓根**（`/src/...`）、值是取值函数
//     （适合按路径取单个文件；本仓 `readSource` 走这条）。
//   ⚠️ 懒加载的 `?raw` 取值返回的是**原始字符串**（不是 `{ default }` 模块壳），
//   故值类型取 `unknown`，由取值处判形。
interface ImportMeta {
    glob(pattern: string, options: { query: string; import: string; eager: true }): Record<string, string>;
    // 懒加载形态（不带 `eager`）：值是「取值函数」而非源码本身。
    // 与 `eager` 形态的差别是实测口径（#189）：懒加载的 `?raw` 返回值是
    // **原始字符串**，`eager` 形态才是 `{ default: string }` 模块壳——
    // 故返回类型取 `unknown`，由取值处（`src/testkit/readSource.ts`）判形。
    glob(pattern: string, options: { query: string; import: string }): Record<string, () => Promise<unknown>>;
}
