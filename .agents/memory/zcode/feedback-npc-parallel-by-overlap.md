---
name: feedback-npc-parallel-by-overlap
description: NPC 并行数不设一刀切上限——按改动面交集判断：同域串行、异域可并行（条文已推dev 1b9eab0）；召唤提及必须顶格（引用块不触发流水线，坑在AGENTS.md 7e557eb）
metadata:
    node_type: memory
    type: feedback
    originSessionId: sess_13cc5808-cda1-47b8-bd2b-df517017ad32
---

2026-09-13 用户纠正 AGENTS.md「一次只跑一个 NPC 任务」约定：**同一时间能跑的 NPC 数量取决于工作内容，不是全局单任务**。当日已执行三连（用户拍板）：①条文改「同域串行、异域可并行」推 dev（1b9eab0，协作段本地直改合规）；②据此并行召唤 #59（与线索链并行）；③顶格坑实测补录（7e557eb）。

**Why:** 每个 NPC 从 dev 拉独立分支、PR base=dev，跑时互不干扰；冲突只在合并时、且只在改动面重叠处出现。实证：#52 二期 PR #60 实改 18 文件（线索域）——#53/#56/#57 同域必须串行（#53 直接吃 MaterialDecorate）；而 #59 移动端（addDock/移动 scss/新组件）与线索域文件不相交，可并行（已实际并行跑）。AGENTS.md 虽是所有 NPC 都写的文件，但 git 按「区域」合并：不同段落各自追加自动合并，同段落追加才冲突——冲突风险跟域走，不跟这个文件走。

**How to apply:** 召唤 NPC 前判断改动面交集（代码文件 + AGENTS.md 同段落）：有交集排队（基于合并后新 dev 拉分支），无交集可同时召唤（评论里写明「并行提示：勿动对方域文件」）。合并顺序连带：先合并者落 dev 后，其他开着的同域 PR 会显示 conflict，可在 PR 里评论召唤 NPC rebase。⚠️ **召唤提及必须顶格**：`@sasa1107/...(...)` 放行首，**引用块（行首 `> `）里的提及不触发流水线且零报错**（20260913 #59 首召实测；顶格重发 1 秒触发）——发完召唤必须 `cnb build get-build-logs` 确认 `issue.comment@npc` 真起了，没起查格式重发。

相关：[[wengu-dispatch-20260913]] [[wengu-mobile-drill]]
