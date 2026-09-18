---
name: dataset-empty-attribute-pitfall
description: 空值布尔 data-* 标记属性在 dataset 里是 "" 不是 undefined——?? 链短路成空串、被 if(!x) 吞掉整段分支
metadata:
    node_type: memory
    type: project
    originSessionId: sess_ad1d1d85-0150-480b-b8c9-0da0f0c5b21a
---

2026-08-28 踩坑：KnowledgePanel 行内按钮用无值标记属性 `data-krelated`/`data-kopen`/`data-krm`，docId 写成 `opBtn.dataset.krelated ?? … ?? ""`——空属性 dataset 返回 `""`（非 undefined），`??` 全不生效 → docId="" 被 `if (!docId) return` 吞掉，三个按钮静默无反应（查相关题/打开文档/移除全灭）。

**Why:** 仓库字符串模板区域大量使用「容器级事件委托 + 布尔 data-* 标记属性」模式（Svelte 迁移完成前仍有效），同款写法容易复发。

**How to apply:** 标记属性只判存在（`dataset.x !== undefined`）；业务 id 一律从所在行取（`opBtn.closest("[data-kdoc]")?.dataset.kdoc`）。排查「按钮点了没反应」先查 dataset 取值是否踩了空串短路。相关 [[ui-rendering-strings-not-vue]] [[svelte-migration-dead-selectors]]
