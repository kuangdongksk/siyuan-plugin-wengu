---
name: wengu-preview-mode
description: 预览模式+快捷复制已落地(76496f7)；长卷性能修复已提交(c3c0ade)；挂账：复习模式无通用退路、错题回顾完整版设计意向
metadata:
  node_type: memory
  type: project
  originSessionId: sess_9a9fcf94-774e-4e0c-aadf-ff8c624c0c20
---

2026-08-26 预览模式会话成果（dev @76496f7 已提交；长卷性能修复已提交 c3c0ade，等用户 193 题真机验收）：

- **入口统一**：开刷面板三按钮「预览 | 开始刷题 | 错题回顾」；**页签头部「做题|复习」切换器已删**（用户拍板）。switchMode 仍是内部统一入口；预览工具行带「退出预览」。
- **预览实现**：PreviewFlow 装饰做题壳题卡为只读态（作答位摘除/正确项描绿/答案解析全展开）；「模糊答案」=模块级 secret 开关，模糊**答案区**（非题干——用户原话"题目部分模糊"，按剧透保护语义实现，若用户本意是模糊题干需改）；快捷复制 questionToMd 拼 markdown→剪贴板（供贴思源 AI 对话，类内置「添加到智能体对话」）。
- **挂账①复习退路**：切换器删后错题本回做题只剩组头「重刷本文档」（须有未掌握），契约已记挂账；用户未提需求，待其撞上再说。
- **挂账②错题回顾完整版**：用户界面没想好，先维持现状；意向=直接答案+当时所选答案+当时思路（若有）+AI 解析/点评。
- **长卷性能（193 题真机）**：装载 QuestionBatch.hydrateAll 整卷 JOIN 分页（~390→~4 次串行请求）；>50 题（PROTYLE_INLINE_MAX）走 mountStatic 静态渲染；批量子块序=id 字典序≈写入序（手工重排不保证，单题 hydrate 保序）。题号栏 max-height: calc(100vh-200px)。
- QuizShell 自 QuizView 拆出主区渲染+绑定（index.ts 曾 516 行破红线）；QuizView 多个成员已放开 public 供 QuizShell 取用。

**Why:** 头部切换器与面板按钮双入口冗余，用户选择面板三按钮为主；长卷卡死是 193 题真机阻塞问题。

**How to apply:** 动 QuizView 行数前先想 QuizShell 是否该吸收；错题本 UI 改版时先问用户界面意向（[[feedback-discussion-style]]）；性能问题先数串行请求×N 与 N 个 Protyle 实例两笔账。相关：[[wengu-review-mode-branch]]、[[wengu-kernel-extra-traps]]。
