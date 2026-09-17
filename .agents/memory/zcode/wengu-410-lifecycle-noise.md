---
name: wengu-410-lifecycle-noise
description: 410 生命周期闸噪音 20260904 已收口并推送——flush 撞 isLifecycleGone 不弹不重排、void save() 链尾 .catch；源码闸随 2db456a、尾款 e320629/c31c44c
metadata:
  node_type: memory
  type: project
  originSessionId: sess_2386d4b3-597b-4f0a-863d-b3cda11babba
---

2026-09-04 用户问为何老是报 `{"code":410,"Plugin lifecycle has ended"}`。定性：思源 3.8.2 生命周期闸+开发重载循环固有噪音——旧实例残骸的防抖落盘（题库 2s/ai-sessions 600ms）与熬过重载的长 AI 任务收口，落在截止线后每笔吃 410；新实例/磁盘数据无恙。当日用户点单「收干净」后**全部落地、已推送（origin/dev 至 c31c44c）、已部署两区（测试区 setPetalEnabled 重载成功）**：

- QuestionBank.flush / AiSessions.flushNow：`isLifecycleGone(e)` 提前 return——不弹 Notify、不重排防抖（普通失败照旧通知+重试）；
- QuizLoader.savePrefs 与 index.ts settings.save：`void save()` 改链尾 `.catch`（try/catch 接不住异步 reject=控制台裸 JSON 来源）；
- 测试：QuestionBank/AiSessions.test 用 `vi.mock("../../ui/Notify")` 断言「410 静默/普通失败仍弹」——**mock 调用累计跨用例，断言前必须 mockClear**（同文件版本闩用例先调过 notifyStoreForeign，踩过）；新建 QuizLoader.test.ts（未捕获拒绝 vitest 判整文件挂=真回归护栏）；
- 提交拆两半：源码闸被并行会话 723c9ef（rebase 后 2db456a）整文件卷走，尾款（settings.catch+三测试+CHANGELOG 补记）在 e320629/c31c44c；AGENTS.md 内核坑节已同步口径。

**Why:** 机制与修法已定论并入库，再遇 410 勿重新审计——直接辨来源：toast 格式化文案=已捕获路径；控制台裸 JSON=某处漏 `.catch` 的未捕获 reject，找新路径补上即可。
**How to apply:** fire-and-forget 存储调用必须显式 `.catch`；Notify 弹落盘失败前先过 isLifecycleGone。关联 [[wengu-audit-20260903]]、[[project-parallel-sessions]]。
