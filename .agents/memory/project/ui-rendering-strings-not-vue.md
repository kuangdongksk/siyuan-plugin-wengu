---
name: ui-rendering-strings-not-vue
description: UI 渲染选型史：2026-08-24 曾评估维持字符串模板；2026-08-27 起方向定为 Svelte 5 全仓渐进迁移（练手优先序），见 [[svelte-migration-roadmap]]；字符串模板维护铁律在未迁区域仍有效
metadata:
    node_type: memory
    type: project
    originSessionId: sess_a3b0cb7d-df8e-45e9-85e7-a604f01ca2ce
---

2026-08-24 用户问「HTML 必须用字符串吗，能不能用 Vue / 更轻前端 / cash-dom」，当时结论：字符串模板 + `data-act` 委托事件 + 定点更新是局部最优。

**2026-08-27 方向推翻**：用户主动提出「项目复杂度越来越高，引入 Svelte 分模块渐进转换」。word 域 2026-08-26 已迁 Svelte 5 验证了可行性（$state 深代理 + 四件套），正式定为全仓六批渐进迁移（顺序练手优先：companion 面板 → bank 面板 → review → stats → convert → quiz），样板与暗雷清单沉淀在仓库 `docs/svelte-migration.md`（各域开工前必读，仓库文档是权威，别凭记忆施工）。**Why:** 当年反对框架的理由（Protyle/Lute/echarts 命令式岛、bundle 体积）被 Svelte 方案逐一化解——命令式挂载用 action 壳保留、Svelte 运行时增量小、渐进迁移不推倒真机验证过的行为。

**How to apply:** 不要建议 Vue/preact/lit-html；新 UI 一律 Svelte 四件套 + `ui/mountApp.ts` 挂载。**下列字符串模板维护铁律在尚未迁移的区域（quiz/convert/bank/stats 大部）依然全部适用**：

- （2026-08-26 真机 bug）innerHTML 整块覆盖 = 旧节点监听全丢，任何重绘路径必须与「渲染+绑定」配对函数走。ReviewFlow.refreshReview 异步完成后直接调 renderReviewFor 绕过 bindHeadFor 导致死按钮——异步回填只允许调宿主完整重渲染入口（rerenderView），局部重绘不得覆盖带监听节点，竞态用 seq 代数防串台。
- （转换流程页化）页签高频重渲染会冲掉状态槽，跨渲染存活的 UI 要自建「快照+重放」（ConvertHost lastBar + replayConvertBar；终态 clearConvertBar 防旧条复活）。
- 这两类坑正是 Svelte 迁移要根治的（响应式就地更新、状态不落 DOM）；迁完一个域该域的铁律补丁即可退役。相关：[[product-decisions]]、[[svelte-migration-roadmap]]。
