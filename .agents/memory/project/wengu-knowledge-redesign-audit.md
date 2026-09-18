---
name: wengu-knowledge-redesign-audit
description: 知识树方案四块落地（20260831 fe26ff3）；□4 rail 合并次日被推翻——b84aab4 拆回五钮+专题独立工作区（ColListSection 更名 CollectionPanelApp），现行为准；□1~□3 活视图专题机制不变
metadata:
    node_type: memory
    type: project
    originSessionId: sess_6c2e17d9-aa59-430b-a6da-6a0322ef54c1
---

20260830 审查+用户定调（合并两模块、h1~h6 载体、专题=动态视图）→ 20260831 机器 B
落地方案大半 → **同日晚四块剩余全部落地并并 dev（fe26ff3 已推送）**，
`docs/knowledge-tree.md` 已转落地存档（含各块设计要点与验收口径）。

## 四块落地形态（勿重做）

- □1 AI 建知识树（428d29c）：结构单薄章节行（小节<6或顶层<3）→
  KnowOutline 归纳 h1~h3 → `{章节}·知识树` 独立文档（同名进回收站=覆盖重建）
  +自动登记 knowRoots
- □2 生成题打标（428d29c）：GenCore kn:/ch: 键按登记根词表归一唯一命中挂引用；
  变式重练模板 kpRefs 直传路径本就存在（VariantDrill addGenerated）
- □3 活视图专题（4f59a65）：data/LiveCols——`col-kp-{块id}` 确定性 id +
  BankCollection{nodeKey,subKeys}；**questionsOf 读取时按 collectQids 实时刷新**
  qids、清单装载前 refreshLiveCollections 对账；col: 历史零新账（id 确定性=
  删了重建轮次连续）；手动快照不动零迁移。节点行「补题」=收集弹窗 preset
  预勾子树（0 题节点合成 0 计数行）
- □4 rail 合并（4f59a65）：**次日被 b84aab4 推翻**——rail 拆回五钮
  （刷题/专题/知识/AI会话/学伴），专题恢复独立工作区：ColListSection
  更名回 CollectionPanelApp.svelte、WenguWorkspace 恢复 collection 枚举；
  现行形态以 b84aab4 及之后为准，勿再按四钮口径改代码

## 状态

- 已部署两区（md5 一致）+ 测试区 setPetalEnabled 重载（内核 3.8.2 端口 64811）
  **待用户真机验收**；QuestionBank 571 行超红线挂账已由 d05f614 解决
  （对账/重生成/反查段外移 BankRegen.ts）
- knowledge-tree/opt-compact/review-20260831 三 worktree+分支已全部清理，
  仅剩主树 dev

## 踩坑记录（沿用）

- i18n JSON 2 空格缩进+CRLF 工作副本：内联正则锚定插入失败，改行数组匹配稳；
  勿 JSON.stringify 整文件重写（缩进差异全文件脏）
- node_modules 挡 `git worktree remove`：remove 会先注销再删目录、删失败留
  残壳——`rm -rf` 残目录 + `worktree prune` 收口
- git push 偶发断连，短重试循环有效；GitHub 时通时不通加剧

相关：[[wengu-treelist-unification]]、[[feedback-data-source-simplicity]]、
[[project-parallel-sessions]]。
