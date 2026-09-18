---
name: wengu-ai-gen-branch
description: wengu/ai-gen——题库①~⑥全部并入 dev（a485a5b，2026-08-24）；与 english 调和完成；全链路真机验收等用户第一次真转换
metadata:
    node_type: memory
    type: project
    originSessionId: sess_5d6c2f17-72f9-4421-b118-a25c2a2ec98c
---

题库插件数据化分支。**2026-08-24 全部并入 dev（a485a5b）并推送
（最终 dev=03d9075/d6712d5）**。①薄弱画像→⑥针对性生成全落地，
③~⑥ 的 wip 66bf56d 已被 29aac11 合并会话打磨完整（审查确认四功能
接线齐、tsc/eslint/build 绿），补录契约 §三点五「题库增量化」
（8d6543e）后合入。

**与 english 的手工调和（a485a5b，无先例可抄的交叉重构）**：
AiJudge 判分返回融合 SCORE 并入评语+CAUSE 错因两路；CardParts.
renderCardHead 承接 regen 按钮（english 把卡头挪过去了）；
QuizView 构造 11 参（history/weakness/bank/openSettings/wordStore）

- 双套访问器并存（DrillViewAccess/ConvertViewAccess/StatsViewAccess/
  TimerHostAccess）；**ConvertHost.applyQuizList 补 materials 透传**
  （aigen 重构时丢了 english 的材料预览语义——自动合并查不出的真 bug）；
  bindHead 拆 ViewBindings.bindHeadFor 压回 500 行。

**遗留**：本工作区仍无习题数据，①~⑥ 全链路（转换入库→专题→刷→
报告→薄弱加练→重生成→右键反查）等用户第一次真转换后验收。

**Why:** 分支生命周期完结；调和决策是下次并行分支合并的直接参照。
**How to apply:** 后续在 dev 迭代；worktree `siyuan-plugin-wengu-aigen`
保留可清理。相关：[[wengu-english-branch]]、[[wengu-pdf-import-branch]]、
[[project-parallel-sessions]]
