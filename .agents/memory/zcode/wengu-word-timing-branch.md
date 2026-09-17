---
name: wengu-word-timing-branch
description: wengu/word-timing——已全部并入dev并推送；worktree 已于 2026-08-24 清理；含
  addDock同名type坑、存量回填坑与易混组设计债备查
metadata:
  node_type: memory
  type: project
  originSessionId: sess_5d6c2f17-72f9-4421-b118-a25c2a2ec98c
---

背单词计时/组复盘分支。主体+追加 9 提交全部并入 dev（54818c9）并
推送；**worktree `siyuan-plugin-wengu-timing` 已于 2026-08-24 删除**，
分支生命周期彻底完结。

**题型分流定稿（勿回退）**：新学首题=看英语选意思（choiceEn）、
复习/星标首题=看英语回想（recallEn）、答错隔卡重现才进轮换
（choiceEn→recallEn→choiceZh→spell→recallZh）。

**addDock 坑（Dock 面板空白的根因）**：`addTab` 与 `addDock` 注册
**同名 type** 会让 init 分发到页签实例、Dock 面板空白。背单词现在
只有 addDock 一个入口。**存量数据坑（已修）**：words.json 回填必须
覆盖全部集合字段（现含 notes 共九个）。落地契约：`docs/word-timing.md`
+ `docs/confusable-words.md`（决策勿重议）。

**易混组设计债（用户拍板「先这样」暂不动）**：①evidence 组与
mistakes.confused 冗余；②预置空导致组实体价值弱；③误认 A→B 后 A
永远优先拿 B 当干扰（位置线索风险）；④组笔记 key=ids 串，组变挂空。
简化方向：evidence 不落组、从 mistakes.confused 实时推导（现结构兼容）。

**How to apply:** 分支完结无待办；动易混组前先读设计债与契约文档。
相关：[[wengu-english-branch]]、[[wengu-wordbook-multi-model]]
