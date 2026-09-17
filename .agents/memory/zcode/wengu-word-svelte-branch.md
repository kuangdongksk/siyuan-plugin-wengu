---
name: wengu-word-svelte-branch
description: word 域 Svelte 化已并 dev(01e3b8f)并已推送；worktree/分支仍在（dock-icon 未并，其验收部署被 svelte 覆盖需重部署）
metadata:
  node_type: memory
  type: project
  originSessionId: sess_f778963a-362a-4fc1-ae13-a5c3aa9b8b3e
---

word-svelte 分支（dfd658b，背单词 UI 层 Svelte 5 化）**已并入 dev 并推送**（merge 01e3b8f，2026-08-26；合并干净无冲突，随合并部署重载过）。worktree `D:/code/siyuan/siyuan-plugin-wengu-word-svelte` 与分支暂留未清。姊妹分支 **dock-icon（6a19cfc）未并 dev**，其验收部署曾被 svelte 构建覆盖，验收前需从该分支重部署。

要点（AGENTS 速览已记，此为架构备忘）：
- 结构：`word/index.ts`=mountWordView 编排，控制器 `WordView.ts`（471 行），响应态 `WordUi.ts`（$state 深代理在 WordApp.svelte 内创建），组件 `word/comp/` 12 个；控制器经 context（`WORD_VIEW_CTX`）注入组件，不传 prop（避免 state_referenced_locally 警告）。
- 构建链：svelte-loader@3.2.4 + svelte@5.56（组件内 TS 原生支持免预处理）、prettier-plugin-svelte、eslint ignore `*.svelte`。**勿设 resolve.conditionNames**（拉进 svelte 服务端运行时 + fflate 炸）。
- 删除：WordHome/WordStats/WordActs；WordBind 只剩键盘分发 wordKeydown。
- 行为微调两处（提交信息已注）：Dock destroy 补卸载；showanswer 按钮改走 reveal() 补计时结算。
