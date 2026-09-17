---
name: feedback-merge-cleanup-closure
description: 合并后清理闭环（用户定）：PR 合并即关关联 Issue（收口评论带 sha）+ 删远端功能分支，仓库常态只留 dev；调度轮收尾必做别攒账
metadata:
  node_type: memory
  type: feedback
  originSessionId: sess_13cc5808-cda1-47b8-bd2b-df517017ad32
---

2026-09-13 用户指示：「pr，issue 该关闭就关闭，分支该删除就删除，记住这个」。

**Why:** 仓库卫生——CNB 上曾攒下 5 个已合并未关的议题（#44/#45/#46/#51/#52）和一个已合并未删的分支（feat/clue-anchor-canon），开放列表被噪音淹没，调度核账变慢。

**How to apply:**
- PR 合并当轮立即：①给关联 Issue 留一句收口评论（带 merge sha，**不含 @提及**——避免误触 NPC 流水线）→ `cnb issues update-issue --repo … --number N --state closed --state-reason completed` 关闭（⚠️ 快捷命令 `issues close` 不吃 `--repo`；参数是**连字符** `--state-reason` 不是下划线，`state` 单独传会 400「state and state_reason must either both exist or both be absent」）；
- ②删远端功能分支：`cnb git delete-branch --repo … --branch <分支>`；
- NPC 正在办的 Issue 不动；排队中的 Issue 不动。
- 规则已落 AGENTS.md 分支与协作段（dae8aad）+ 仓库根 .zcode/MEMORY.md。

相关：[[feedback-npc-parallel-by-overlap]] [[wengu-dispatch-20260913]]
