/**
 * .svelte 组件测试替身（vitest 无 svelte 插件，见 vitest.config.ts）：
 * 测试图只要求 import 可解析（挂载永不发生），故空壳即可。默认导出
 * 形状对齐 Svelte 5 组件（mount 的第一参），具名实例导出一律 undefined。
 */
const Stub = {} as Record<string, unknown>;
export default Stub;
