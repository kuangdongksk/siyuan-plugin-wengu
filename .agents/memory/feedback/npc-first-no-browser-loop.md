---
name: npc-first-no-browser-loop
description: 20260915 用户纠正：业务修复一律开 Issue 派 NPC 不本地直改；诊断靠读代码不靠浏览器 MCP 反复调试
metadata:
    node_type: memory
    type: feedback
    originSessionId: sess_a4167dd6-8d35-4de4-b4c5-62af2b92cda9
---

20260915 移动端刷题 UI 修复任务中用户两条纠正：①「不要自己改，直接派 npc」——
即使已完成本地实现且验证通过，也要还原工作区、把诊断结论写成 Issue（文件路径 +
可验证验收标准）召唤 NPC；②「你怎么能不停的使用 mcp 进行调试呢，理论上所有的
内容都在代码里」——诊断以读代码为准，浏览器/MCP 只做一次性抽查，不做迭代调试。

**Why:** 本地直改会让工作区与 NPC 在办分支冲突（污染前科，见
[[parallel-session-worktree-build]]）；浏览器反复调试慢且不可复现，代码与设计稿
才是单一事实源。20260914「小修直改」例外（[[git-remote-push]]）被本条收窄：
仅限用户当次点名「你来改」的场景，自作主张不算。

**How to apply:** 报障 → 读代码定位根因 → 结论写成 Issue（像 #105 那样列
改动清单/验收标准/禁区）→ 顶格召唤青简（--work-mode）→ 盯流水线与 PR →
本地已动的手一律 `git checkout --` 还原并用干净 HEAD 重建回部署。

相关：[[git-remote-push]]、[[cnb-npc-full-workflow-first-run]]、[[siyuan-web-desktop-url]]
