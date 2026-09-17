---
name: feedback-plan-scope-split
description: 两块独立改动不许混进同一计划/Issue——一次一件事，分开排队（2026-09-12 用户否决混合计划）
metadata:
  node_type: memory
  type: feedback
  originSessionId: sess_d169247f-5f10-46c8-bf8a-67217b560e33
---

2026-09-12 出实施计划时把「知识索引自管化」和「题目源锚」两块内容写进同一个计划，用户直接否决：「你都做的什么计划，两块内容的改动怎么能混在一起做计划」。同一轮还纠正：题库体检是题库域功能，知识侧方案不该挂靠它。

**Why**: 与仓库「一次只跑一个 NPC 任务」的协作约定同源——混合计划让 Issue 验收标准互相绑架、PR 体量失控、回滚边界模糊；用户审计划时按「一个 Issue 一件事」的心智逐条过。

**How to apply**: 出计划/Issue 前先自问改动是否单一关注点；两件相关但可独立验收的事=两个计划、两个 Issue，明确排队顺序（如 #39 先、计划 B 后），在计划里只留一行「另出 X」的指针，不展开对方内容。相关：[[feedback-discussion-style]]、[[wengu-know-index-issue39]]。
