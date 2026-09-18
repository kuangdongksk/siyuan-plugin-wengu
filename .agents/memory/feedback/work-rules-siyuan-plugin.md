---
name: work-rules-siyuan-plugin
description: 温故开发工作规则：真实思源验证、tsc --noEmit 零错误、先查 siyuan .d.ts、参考同机成熟插件
metadata:
    node_type: memory
    type: feedback
    originSessionId: sess_3bdb5d2e-1541-4791-98ce-e871f3905338
---

用户简报中的工作规则：

- 每步用真实思源验证：`dist/` 拷到 `data/plugins/siyuan-plugin-wengu/`，改代码后 `pnpm build` 并在思源里重载插件实测；
- 保持 `pnpm exec tsc --noEmit` 零错误（模板本身不达标，别倒退）；
- 思源 API 用法先查 node_modules 里 `siyuan` 包的 `.d.ts`（core 侧还有 `/api/*` 内核 API，参考 sy-lively 的 constant/API路径.ts 有枚举）；
- 同机参考插件：`/Volumes/baiWeiNV7200/sasa/siyuan/siyuan-access-controller` 和 `sy-lively`（作者成熟插件）；
- 不确定 API 行为时，先在 kernel/前端日志打出来验证再封装。
- **命令一律 pnpm**（`pnpm exec tsc` / `pnpm run build` / `pnpm add`），禁 npm/npx——仓库 packageManager 是 pnpm@11.4.0（2026-08-24 用户在统计面板计划里专门纠正过一次）。
- **格式化用 Prettier**（紧凑规则 `.prettierrc`：120 列/4 空格/双引号/json+scss 2 空格），`pnpm exec prettier --write .`。2026-08-24 用户拍板从 dprint 切换（dprint 新工具链断行过松，把文件撑爆 500 行红线），dprint.json 已删、依赖已移除。别再跑 dprint。

**Why:** 用户强调真实环境验证优先、类型零错误红线，避免纸上接口错误（本次已实际踩到 Protyle 取文档 id 的字段路径、blocks 表列名等）。
**How to apply:** 每次改动后先 `tsc --noEmit` 再 `pnpm build`；需要验证的 API 在真实思源里确认后再封装。相关：[[siyuan-api-patterns]]。
