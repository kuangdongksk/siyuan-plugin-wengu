---
name: wengu-dispatch-20260913
description: 20260913调度轮：#52已合并(PR#60→d95bc6f)部署工作区；#59并行召唤NPC跑着；并行约定已改条文推dev(1b9eab0)+顶格坑(7e557eb)；#53/#56/#57线索域串行待派；#44/#45/#46/#51议题未关待清
metadata:
  node_type: memory
  type: project
  originSessionId: sess_4482839f-2c9e-4f41-959d-e1f76daa9b53
---

2026-09-13 调度轮（链式：召唤→NPC实现+复审→本地审查→合并→召唤下一个）。

**晚间用户拍板三连已全部执行**：① AGENTS.md 并行约定改「同域串行、异域可并行」（1b9eab0 推 dev，协作段本地直改合规）；② PR #60 双轮审查后合并（d95bc6f，见 [[wengu-clue-anchor-redesign]]），工作区部署+petal 重载（内核 60271；测试区内核没开着只拷了文件）；③ #59 并行召唤——⚠️ 首召放引用块**没触发**（零流水线零报错），顶格重发 1 秒触发（11:18 `issue.comment@npc`），坑已补进 AGENTS.md（7e557eb）。#59 NPC 跑着，改动面与线索域不相交（addDock 挂载层/移动 scss/新组件）。

**当日晚点核账（cnb-cli 实查）**：开放议题 9 个：#59/#57/#56/#53/#52 在册，**#44/#45/#46/#51 已合并进 dev（2846d81）但议题没关——清账待办**。

**NPC 调度队列**：~~#44~~（PR #47+#48，merge 729a9ab）→ ~~#45~~（PR #49，merge 97eb02c）→ ~~#46~~（PR #50，merge fc2c203）→ ~~#51~~（PR #54，merge 5f56c90；真根因=SKIP_SELECTOR 含 gloss-link）→ ~~#52~~（PR #60，merge d95bc6f）→ **#59 并行跑着** → #53（三期，吃 #60 的 MaterialDecorate）→ #56 → #57（[[wengu-clue-overlap-multicolor]]）——#53/#56/#57 与线索域同文件交集，**必须串行**且基于合并后的新 dev 拉分支。

**#60 审查记录**：独立 worktree（`git worktree add /tmp/... cnb/<branch>`）双轮验证——首版我审出 3 缺陷（选项行丢失/CanonMap 缓存别名错位纯函数实锤「选 CCCC 得 DDDD」/fallback 匹配源污染），NPC 同时自审 5 缺陷 force-push 重写（+惰性升格没真写、NON_CANON 两类写反），修复版 964 测试全过、CI 双绿后合并。审查坑复确认：worktree 全局 `core.autocrlf=true` 会把 prettier --check 打成 430 文件假红——`git diff --ignore-all-space --numstat` 或去 CR+带 `--config .prettierrc` 复验（CI 在 Linux LF 是权威）。

**#45 审查记录**：组题材料面板 `.wengu-gmat` 是 `.wengu-gqs` 的**兄弟节点**不在 `.wengu-card` 里 → `AnnoScope.annoOwnerQid` 按组内可见卡回落。

**#44 复审补丁（PR #48）**：「回顾」死钮——`switchWorkspace("drill")` 必须排 `switchMode("review")` 之前（QuizShell workspace 优先早退），`ModeOps.test` 锁次序。

**待用户真机验收**：①相关题弹窗四动作；②浮条——预览/复习零浮条、非英语卷无标生词；③#52 二期线索标/删/嵌套高亮/chips 无上标噪音；④#59 移动端（等 NPC 交付）。

相关：[[wengu-dispatch-20260912]] [[wengu-related-dialog-upgrade]] [[wengu-annobar-bugs-issue45]] [[wengu-clue-anchor-redesign]] [[feedback-npc-parallel-by-overlap]]
