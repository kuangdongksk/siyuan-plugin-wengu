---
name: wengu-batch-convert-resume-issue62
description: 批量转换中断续跑 Issue #62 已合并进 dev(109f5a8)未装机——三块机制+P3边缘挂账,真机验收1~6待用户
metadata:
    node_type: memory
    type: project
    originSessionId: sess_7d7ff9d5-1179-4f64-a078-840c06e65317
---

**Issue #62（批量转换中断后可继续）已合并 PR #63，随 20260914 装机部署两区（dev `4deab77`，测试区已重载、工作区待下次开思源生效）。**

三块咬合机制（缺一闭环即断，改这块前先读 AGENTS.md convert 域 #62 段）：

1. 逐批断点检查点：`onCheckpoint` 仅 `inQueue=true` 接（单篇流程逐字节不变）；中途 `batches`=已落库批数、`total` 恒 0（与收口「AI 调用批数」两口径，不许混账）。
2. 重发队列跳过已完成篇：`classifyQueueItem(resume, hasSet, reconvertDone)` 纯函数；判据=「无记录+题库有该 srcId 题集」；出路=弹窗「重转已转换过的篇」勾选（仅队列模式）；查库失败按无题集处置（宁多烧不漏转）；QueueTail 五段口径。
3. 面板「继续生成」恢复整个队列：`BatchMeta.rootId`（optional 只加）；预填根+resumeQueue 自动勾「连同子文档」；存量无 rootId 记录退化单篇续跑。

**待办**：

- 真机验收 1~6（Issue 正文）——**已装机（20260914）待用户验收**。
- **P3 边缘挂账**：队列进行中，面板「未完成记录」区会出现当前篇的检查点记录；此刻对它两击「丢弃进度」→ 半成品题集被删 → 下一批 append throw 按既定 failed 收口、队列继续（无数据损坏）。修复方向=未完成区过滤 running 篇（snap.batch.items），需要时单独开 Issue。
- 关联：[[wengu-dispatch-20260913]]、#37 批量队列、#61（#59 移动端）仍在办。
