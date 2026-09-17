---
name: feedback-data-source-simplicity
description: 数据源设计「文档为事实源、只存 ID、拒绝镜像搬运」——用户明确否决以题库镜像为主源的方案
metadata:
  node_type: memory
  type: feedback
  originSessionId: sess_39751bd5-26e4-4f25-aa05-7838383d3faa
---

2026-08-25 错题本设计（[[wengu-review-mode-branch]] D2）时用户否决以题库 bank 镜像为主源的方案：「不要以题库为主源。既然题库是按照文档走的，那就以文档为主源。你直接保存一个 ID 就可以了，不需要这么乱七八糟的。」

**Why**：块属性随文档走是事实源；bank 等镜像是派生副本，当主源会引入 kramdown 双解析路径、双轨同步与对账负担。用户对「为功能方便而复制/搬运数据」的方案天然反感，偏好最小持久状态。

**How to apply**：新功能数据源设计默认：① 块属性/文档为唯一事实源，SQL 直查（无 LIMIT 截断 64 行坑，必须显式分页）；② 持久化只落 ID 维度，不复制题目内容；③ 内容按 id 惰性回源取（getChildBlocks/getBlockKramdown，fetchSyncPost 串行天然合规）；④ 想拿镜像层当主源前先问用户。与仓库既有原则一致（design-review.md §五「不把块属性数据搬进插件存储——块属性随文档走是特性」）。

**2026-09-12 收窄**：用户对**索引/树形结构维度**显式改口「理应都归插件管」——知识索引标题树允许快照进插件存储（know-index，带源块 id 指针+哈希 staleness），见 [[wengu-know-index-issue39]]。题目内容镜像的否决仍然有效；「文档为事实源」体现为快照可校验过期，而非禁止快照。
