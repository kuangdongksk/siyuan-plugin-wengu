---
name: wen-gu-mini-init
description: 温故做题小程序 wen-gu-mini 已初始化——路径/远端/技术栈与三个环境坑（pinia4
    坏产物、vitest5-vs-vite5.2.8、wot 类型与 exactOptionalPropertyTypes 冲突）
metadata:
    node_type: memory
    type: project
    originSessionId: sess_23bd300a-b92f-49fa-88b6-f1785f66963d
---

2026-09-18 把温故「做题」迁小程序，新仓库初始化完成并首推 CNB：

- 本地 `/Volumes/baiWeiNV7200/sasa/x1-1/sasa/acdemic/wen-gu-mini`，
  远端 `https://cnb.cool/x1-1/sasa/acdemic/wen-gu-mini`（空仓首推 dev=默认分支）。
- 技术栈与云后端决策记录在该仓库根 README（uni-app Vue3+Vite+TS、
  tailwind v4+Less、wot-design-uni 只借行为壳、uniCloud 阿里云版），
  复用温故纯 TS 逻辑的清单在其 `src/core/README.md`。
- 本地门禁：`pnpm format:check && pnpm lint && pnpm test && pnpm check:lines && pnpm type-check`。

**Why:** 环境坑不在新仓库 README 里，复现/续作时省一轮排查。

**How to apply:**

- pinia 必须 2.x：4.0.3 dist 有坏 import `from "nostics"`，rollup 直接炸。
- vitest 锁 3.x：uni 模板钉死 vite 5.2.8，vitest 5 要 vite 6/7 的
  `module-runner` 导出；且 vitest 用独立 `vitest.config.ts`，别让它加载 uni 的 vite.config。
- wot 的全局类型 `wot-design-uni/global` 没挂进 tsconfig types：其源码
  .vue 过不了 `exactOptionalPropertyTypes`，挂上 type-check 必红，模板里
  wd-* 组件暂时回退 any。
- weapp-tailwindcss 会把 `page` 选择器扩写成
  `:host,page,.tw-root,wx-root-portal-content`（含真实 page 节点，令牌生效），
  并把 @theme 里的 `var(--wgm-*)` 静态解析成字面量——改令牌要重构建。
