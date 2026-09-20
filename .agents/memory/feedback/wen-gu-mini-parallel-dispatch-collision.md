---
name: wen-gu-mini-parallel-dispatch-collision
description: wen-gu-mini 双调度链同域撞车（20260918 PR #9/#10）——派发前必查「最近合并的
  PR 与 dev 新提交」而不只查 open，占坑评论先于 NPC 召唤
metadata:
  node_type: memory
  type: feedback
---

2026-09-18 wen-gu-mini 撞车实录：用户并行开两个会话跟踪同一条设计评审流水线。
会话 A（另一个我）在复核出结论后直接派发修订并合并（PR #9 "R1"，还在各 Review
issue 贴销项说明、宣布设计冻结）；本会话同一时间检查「open issues + open PRs」
均无动静（#9 已 merged 所以 open 列表看不到），于是也开了 Issue #8、召唤青简，
产出重复的 PR #10（conflict），只能关闭让位。

**Why:** 「open 状态查询」看不到刚合并的工作；两个会话都按流程走，同域串行
约束跨会话失效，浪费一条 NPC 流水线（计费）＋制造噪音。

**How to apply:**
- wen-gu-mini（或任何用户可能开并行会话的仓库）派发前必查四样：
  `cnb pulls list-pulls --state open` 之外，还要 `--state closed`（近几小时）、
  dev 最新提交（`git fetch && git log`）、各在办 issue 的**最新评论**
  （并行会话会在 issue 上留销项/占坑说明）；
- 派发 NPC 前先在相关 issue（或新 issue）发一条**占坑评论**说明「本会话即将
  派发 XX」，隔几分钟确认没有并行会话抗议再召唤；
- 撞车既成事实的处置：后到 PR 关闭让位（留对照说明），不重放；
- 关 issue 用 `cnb issues update-issue --state closed --state-reason completed`
  （不带 state-reason 会 400）；关 PR 用 `cnb pulls patch-pull --state closed`。
- 相关：[[wen-gu-mini-init]]、[[recall-repo-memory-before-market-answers]]
