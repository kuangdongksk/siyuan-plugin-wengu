/**
 * 插件图标集（`addIcons` 载荷）：20260915 自 `src/index.ts` 的模块级常量原样
 * 搬出（形状与注释一字未改，纯 move 语义）——图标与装载编排不同源，入口文件
 * 压 500 行红线时它不该占着位置。
 *
 * 形状取自思源官方图标集（litheness 包 `iconRiffCard` / `iconLanguage` 的原始
 * path），以自有稳定 id 注册——不依赖运行环境 sprite 是否收录（`iconLanguage`
 * 非核心图标，dock 里会渲染成空白）；**id 保持不变**，conf.json `uiLayout`
 * 持久化的旧 dock 图标引用才能继续命中 symbol（换图标只换形状不改 id，
 * 20260826 定论）。
 */
export const WENGU_ICONS = `<symbol id="iconWengu" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>
</symbol>
<symbol id="iconWenguWords" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
</symbol>
<symbol id="iconVolume" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
  <path d="M11 5 6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.8 5.7a10 10 0 0 1 0 12.6"/>
</symbol>`;
