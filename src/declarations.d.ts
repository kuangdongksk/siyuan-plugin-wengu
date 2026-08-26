declare module "*.scss" {
    const content: Record<string, string>;
    export default content;
}

// *.svelte 的模块类型由 svelte 包自带的环境声明提供（svelte/types），
// 此处不再重复声明，避免 TS2300 重复标识符。
