---
name: wengu-know-index-issue39
description: 知识索引自管化已合并——Issue #39 随 PR #40 并入 dev（know-index 快照+AI 索引升级），待真机验收；计划 B 题目源锚已解堵待开
metadata:
    node_type: memory
    type: project
    originSessionId: sess_d169247f-5f10-46c8-bf8a-67217b560e33
---

2026-09-12 由「张宇基础30讲概率索引噪音」分析引出的数据模型改造，已开 [Issue #39](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/39)（P1）并召唤 NPC 青简（work-mode，构建 cnb-j1o-1k29pbe1g，dev@bc22c6b）。

**噪音根因**（测试区 `/MinerU/张宇基础30讲概率/` 六章，45/38/21/17/6/30 节）：MinerU 把题干（1.1~~1.19 整段）、例题/示例、空壳节（习题/解答/基础知识结构）标成 h1~~h6；这些章无 AI 树，面板走实时 SQL 文档标题路裸奔，噪音还经 canonical 传导进 know-synonyms。

**定稿设计**（用户三决策：快照为底+AI 覆盖 / 噪音由 AI 治理非确定性过滤 / 例题反哺切分）：

- 新店 `know-index` 嵌套快照，节点 id=**真实标题块 id** → kpRefs 往返、col-kp-{id}、kp:{id}、route-cache 四条外键链零迁移；快照存全量原始树（即 AI 滤除内容的找回处），无 filtered 清单、不挂题库体检（体检是题库域功能，用户纠正过）。
- 懒捕获：装载遇缺根现场捕获落库；装载零内核 SQL；staleness 沿 know-hash。
- AI 索引 prompt 升级：不收录题干/例题/空壳、参考例题细化知识点、`BankKnowNode` 加 optional `srcId` 挂源标题块（块级跳源）；bank.knowTrees 存量格式冻结。
- 硬约束：route-cache 代数输入不变、src/quiz/index.ts 不碰、数据演进守则。

**进展（20260912 调度轮）**：PR [#40](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/pulls/40)（feat/know-index-snapshot，2 提交含 NPC 复审修补）已本地审查（worktree 四件套+tsc 全绿+人工读 diff）并合并 dev（3bfe86f），Issue #39 已关（completed），构建已部署两区待真机验收。本地 worktree `prettier --check` 报 401 文件=已知 CRLF 幻影（CI 同 sha 绿），不作数。**计划 B（题目 srcBlockId 新题采集+块级查看原文）已解堵，开 Issue 前先出设计稿过审**——用户明确要求两块改动分开做计划（见 [[feedback-plan-scope-split]]）、设计先出审核文档（见 [[feedback-discussion-style]]）。

**Why**: 知识索引数据此前不归插件管（实时查文档标题），用户对此不满且定调「理应都归插件管」——是对 [[feedback-data-source-simplicity]] 在索引维度的显式收窄。
**How to apply**: 真机验收样本=测试区张宇概率六章（AI 索引后题干/例题/空壳不出树、快照节点点击直跳源标题块）；首次装载会懒捕获全部登记根（存量根零动作）。
