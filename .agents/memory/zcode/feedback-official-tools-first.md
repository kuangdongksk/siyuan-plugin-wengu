---
name: feedback-official-tools-first
description: 平台操作一律优先官方工具（cnb→cnb-cli、GitHub→gh），禁手搓旁路（内嵌token/裸curl调API）
metadata:
  node_type: memory
  type: feedback
  originSessionId: sess_d169247f-5f10-46c8-bf8a-67217b560e33
---

2026-09-12 用户定夺：「不管什么时候都要用官方的工具」。起因：cnb remote 内嵌 token 过期排查中，我用 curl 裸调 CNB API 探测、手工抽 token，随后接好 cnb-cli 官方凭证链路，用户认可并升格为总则。

**Why:** 官方 CLI 自带鉴权管理、参数校验和正确的接口封装；旁路（token 硬嵌 remote URL、curl 裸调 API）会静默过期、报错误导（「仓库不存在」实为凭证失效）、且绕过工具的口径（如 CNB pulls 的 state 枚举是 `open` 而非 `opened`，CLI 里根本不会踩）。

**How to apply:** CNB 操作用 cnb-cli（登录 `cnb login`、PR 用 `cnb pulls …`、Issue 用 `cnb issues …`），git 鉴权走已配的 [[wengu-cnb-cli-credential]] helper；GitHub 用 gh；包管理一律 pnpm（AGENTS.md 既有约定）。查/改远端状态先想「官方 CLI 有没有现成命令」，没有再考虑 API，且调用也优先借 CLI 的凭证（`cnb git-credential get`）而非自存 token。
