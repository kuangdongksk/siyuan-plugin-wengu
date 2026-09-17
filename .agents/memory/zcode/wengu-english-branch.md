---
name: wengu-english-branch
description: wengu/english——E0-E4 已并入 dev（1de759d，2026-08-24）；剩用户 UI
  验收与挂账优化项；分支/worktree 保留未删
metadata:
  node_type: memory
  type: project
  originSessionId: sess_5d6c2f17-72f9-4421-b118-a25c2a2ec98c
---

考研英语题型支持分支。**2026-08-24 已并入 dev（merge 1de759d，
最终 dev=03d9075 全分支合流）并推送 origin**。E0-E4 全部落地
（材料组分栏/完形逐空/翻译作文 AI 判卷/线索标注/生词联动），
设计 `docs/english-question-review.md`，契约 `question-block-contract.md`
§七。合流时与 ai-gen 的调和见 [[wengu-ai-gen-branch]]（AiJudge 判分
融合 SCORE+CAUSE、QuizView 双套访问器、ConvertHost materials 透传）。

**仍待用户 UI 验收**（装机版已是合流后 dist）：重开温故页签刷
「输出/wengu-E0-英语样卷·习题」。**挂账（未做，非阻塞）**：score
独立字段与战报分数呈现、答错自动判线索、线索文中高亮、生词例句随词、
排序题配对作答、分栏比例可拖、精读模式译文开关、复习/学习模式实现。
开放问题剩 Neo 主题复验与完形 right 口径确认。

**Why:** 分支生命周期完结，验收与挂账仍是后续迭代入口。
**How to apply:** 在 dev 上直接迭代挂账项；不再动 wengu/english 分支
（worktree 已于 2026-08-26 前后清理完毕，2026-08-26 确认列表已无）。
相关：[[user-kaoyan-exam-prep]]、[[wengu-word-timing-branch]]
