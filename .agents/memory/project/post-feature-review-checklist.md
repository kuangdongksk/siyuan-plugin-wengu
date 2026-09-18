---
name: post-feature-review-checklist
description: 功能落地后的文档三件套同步 + 全仓审查清单（20260828 审查实跑有效——抓到三处文档欠账与一个真 bug）；UI 改版要同步面板 hint 文案（aiPanelHint 教训）
metadata:
    node_type: memory
    type: project
    originSessionId: sess_ad1d1d85-0150-480b-b8c9-0da0f0c5b21a
---

20260828 用户要求「审查项目文档和代码」，实跑一轮抓到 6 项：契约文档孤儿行、AGENTS.md 域描述过时、CHANGELOG 缺条目、死导出、监听叠加、disabled 按钮兼停止键点不动（真 bug）。

**Why:** 功能提交时只记得同步 question-block-contract.md，AGENTS.md 域描述与 CHANGELOG.md 容易漏——AGENTS 是下轮会话的活地图，过时会误导后续施工。

**How to apply:**

- 功能落地提交前自查文档三件套：契约文档、AGENTS.md 对应域描述、CHANGELOG.md 版本条目。
- 全仓审查清单（命令都很快）：i18n zh/en 键数对齐、全文件 ≤500 行、各域 index.ts 非纯 barrel、fetchSyncPost 仅特殊通道直用、grep 死导出/TODO、贴线文件（如 quiz/index.ts 493 行下次动它先拆）。
- UI 长任务弹窗：兼作「停止」的按钮运行中**不要 disabled**（点了没反应），用单一点击处理器按运行态切换语义。
