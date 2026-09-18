---
name: svelte-migration-roadmap
description: Svelte 渐进迁移六批路线与进度：首批（地基+companion 面板）2026-08-27 完成；后续 bank
    面板→review→stats→convert→quiz；施工手册在仓库 docs/svelte-migration.md
metadata:
    node_type: memory
    type: project
    originSessionId: sess_d92243c1-868e-4f6c-bb69-652c02ba06e0
---

2026-08-27 用户定方向：全仓 UI 从字符串模板渐进迁 Svelte 5（项目复杂度高、难维护）。练手优先顺序（用户拍板）：companion 面板 → bank 工作区面板 → review → stats → convert → quiz（quiz 拆多批：StartPanel → RoundReport → rail/Nums → 题卡 Protyle 壳 → Steps/AnswerFlow）。不迁清单：FormHtml.ts（两轨公共地基）、ModelPicker/KnowPicker 浮层（action 桥接）、SettingsDialog（末尾再评估）。

**首批已完成（2026-08-27，本会话）**：地基三件（`ui/mountApp.ts` 挂载帮手、`ui/FormRow.svelte` 表单行积木、svelte-check 接入——`pnpm run check:svelte` 用 `tsconfig.svelte.json` 的 bundler 解析，主 tsconfig node10 解析配 vitest 子路径导出会假报 node_modules 错）+ companion 管理面板四件套（CompanionPanelUi/Ctl + comp/CompanionPanelApp.svelte，删旧 core/CompanionPanel.ts）。全链验证通过、产物已拷进插件目录（md5 一致）；**思源内核进程当时已退出（前端壳还在，6806 无监听），插件重载待用户重启思源后真机点验**。

**Why:** 每批都要真机验证后再进下一批；quiz 的 renderList 全量重灌链上挂着 companion 重挂/转换条重放/stats 销毁等隐式契约，放最后用打磨熟的模式啃。

**How to apply:** 后续批次开工先读仓库 `docs/svelte-migration.md`（四件套样板 + 12 条暗雷清单是权威，包括 svelte-ignore 多规则要拆两条注释、use:action 名必须与 import 标识符一致等新踩坑）；重灌宿主先 detach 再 mount（renderQuizShellFor 开头位）；新域挂载一律 ui/mountApp.ts。相关：[[ui-rendering-strings-not-vue]]（未迁区域铁律仍有效）、[[companion-mascot-plan-deferred]]。
