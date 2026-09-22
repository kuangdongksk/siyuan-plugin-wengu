---
name: no-legacy-before-first-release
description: 20260922 用户定：插件未发版=无存量用户数据，数据演进守则冻结约束发版前不生效，发版即装闩
metadata:
    node_type: memory
    type: project
---

20260922 用户明确（「没有存量，记住除非发版」）：插件**至今未发版**（main
从未 release，无真实用户存量数据）。AGENTS.md《数据演进守则》的冻结清单/
版本闩/字段只加不改名等约束，是为「发版后的存量兼容」设计的——**发版之前
不构成重构限制**。

**Why:** 守则防的是清存量用户的库；没有存量就没有可清的库。rename/重构/
删字段/改 kramdown 契约的成本此刻为零，同样的改动一旦发版就变成迁移负担。

**How to apply:** 审查或设计数据结构时按「发版前是唯一免费重构窗口」评估，
改动项标注【免费 / 发版后变贵】。**一旦发版本条立即作废**，守则全效力。
数据结构全量问题盘点已派「复核」NPC 承接（Issue #218，20260922，只读审查
不开替我上班）；已知四条种子问题（kramdown 注释措辞、kpRefs→knowledge→
chapter 隐式降级链、clues 平行字段下标对齐、batch/batches 双口径）见该
Issue 任务书；本地结构地图 docs/data-structures.md（未推送，人读用）。
