---
name: knowledge-tree-chapter-echo
description: AI 索引树头部章节名回声（「1-行列式/行列式/…」双层嵌套）根因与 stripChapterEcho 修复口径
metadata:
    node_type: memory
    type: project
    originSessionId: sess_becdfd3a-2831-46b6-819c-ecdbe69f215e
---

20260908 修复（7162351 已装机推送）：AI 索引归纳常把章节名本身写成首个 h1 包住全树
（prompt 规则 1 明令禁止仍违逆，真机两棵树均中雷）——面板呈现「1-行列式/行列式/…」
双层嵌套、回声标题还会混进文本关联词表（lexicon 走 expandKnowDocs→treeHeads）。
修复=`stripChapterEcho`（bank/data/KnowTrees.ts）：标题去编号归一（「1-行列式」/
「四、分块矩阵」/「第2章 极限」→裸名；**中文数字必须带分隔符**——否则「一维随机
变量」的「一」会被误剥），只剔头部**连续 level-1** 且归一同名的节点。三个接入点：
生成侧入库前剔、重索引旧树同口径剔（treePathsOf 路径对齐，同路径复用旧 id 不悬空）、
展示侧 treeHeads 带章节名同剔（存量带回声的树读取时免迁移，存量数据不动）。

**Why:** prompt 合规不可靠，回声是 AI 行为常态；归一匹配必须保守（连续头部+level-1+
精确同名）防误剔真节点。
**How to apply:** 新增消费 knowTrees.nodes 的代码一律走 treeHeads/stripChapterEcho，
别直接 .nodes.map（回声会漏）。关联 [[knowledge-heading-order-sql-pitfall]]（同一
treeHeads 并流点的文档序修复）。
