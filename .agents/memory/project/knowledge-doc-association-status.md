---
name: knowledge-doc-association-status
description: 知识文档↔题目关联已三路齐全（2026-08-28 定稿）——转换时路由/事后「匹配」/「转习题」预填；导入递归展开、层级 h1~h6
metadata:
    node_type: memory
    type: project
    originSessionId: sess_ad1d1d85-0150-480b-b8c9-0da0f0c5b21a
---

题目↔知识文档的关联现在有三条路（2026-08-28 commits 9afc1b8 + a8b0193，已推 origin/dev）：

1. **转换时自动路由**（原有）：转换弹窗「知识点根文档」→ 两级 AI 路由 → 解析块尾注入 `((id))` 块引用。
2. **事后匹配**（新增，知识面板文档行「匹配」→ MatchDialog）：选已入库习题文档（存量/新建同权）→ 逐题 routeKnowledge（过 enqueueAi 共享队列）→ strip+inject 替换语义注入（默认跳过已关联题）；题库 kramdown/kpRefs 主记录更新（KnowRoots.mergeRecordKpRefs），源卷块 updateBlock 尽力同步——模式同 RegenDialog。存量题补关联的旧缺口已补上。
3. **转习题**（新增，行按钮）：转换弹窗预填源=知识点根=该文档（QuizView.openConvertPrefilled），新建题库生成时即挂自身小节反链。

手动「导入文档」仍只入册展示不建关联（0 题是预期）；导入已递归展开（expandKnowDocs 根+全部后代逐行；manual 标子树、registered 才有「移除」），小节层级 h1~h6。架构细节 AGENTS.md bank 段与 CHANGELOG v0.1.1 已同步。相关 [[pivot-to-ai-block-conversion]]

⚠️ 20260831 复审定诊：三路关联机制虽全，但 knowledge 文本/kpRefs/专题三套标签互不归一、kpRefs 在刷题主界面不可见——问题清单与改造方向见 [[knowledge-tag-three-systems-split]]。

**本轮面板修的两处死交互（新 UI 同类排查先看这两个键）：**

- 树化折叠 key 不一致：文档行箭头切的是树路径 `node.path`，小节容器显隐判的是 `secKeyOf(path)`（带 `::sec` 后缀）——key 永远对不上 → 文档行展不开（分支行两侧同 key 所以正常）。修法：toggleSlot 按 doc/分支分键。
- 行按钮 docId 误取空值布尔属性：`data-krelated` 等空值标记 `dataset.x` 是 `""` 不是 undefined，`??` 链短路成空串被 `if(!docId) return` 吞掉 → 三按钮全空转（[[dataset-empty-attribute-pitfall]] 的活样本）。修法：一律从所在行 `data-kdoc` 取。
