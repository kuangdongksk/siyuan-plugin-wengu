---
name: cnb-npc-full-workflow-first-run
description: 20260910 CNB NPC 云端开发全流程首跑成功——CLI 命令细节、时长、worktree 审查两个环境坑、基线竞态无害论
metadata:
    node_type: memory
    type: project
    originSessionId: sess_c19f257f-dba7-4341-a2ee-ab884bba45b1
---

20260910 全流程首跑成功（Issue #7 → NPC 23 分钟出 PR #9 → 本地审查合并，修复转换批数双重累计）。可复用的操作细节：

**cnb CLI 命令口径**（已登录态，repo 参数=`sasa1107/open-source/si-yuan/siyuan-plugin-wengu`）：

- 开 Issue：`cnb issues create-issue --repo … --title … --body-file /tmp/x.md --priority P2`；
- 召唤 NPC：`cnb issues post-issue-comment --repo … --number N --work-mode --body "@sasa1107/open-source/si-yuan/siyuan-plugin-wengu(青简) …"`——`--work-mode` 必带；
- 关 Issue 用 `cnb issues update-issue --state closed --state-reason completed`（快捷命令 `close` 不认 `--repo`，别用）；
- 合并 PR：`cnb pulls merge-pull --repo … --number N` 单发报 400「invalid HTTP body, EOF」——**必须带 body 字段**（如 `--merge-style merge --commit-title "合并来自 <分支> 的合并请求 #N"`）才 200；`get-build-status` 也要 `--repo`（与 get-build-logs 不同）；
- 跟踪：`cnb build get-build-logs --repo …`（找 sn）+ `cnb build get-build-status --sn …`；PR：`cnb pulls list-pulls --state open` / `get-pull -v`（列表接口 body 恒空串，完整描述要 -v）。
- 20260911 复跑补充（#25/#11 审查合关 + #26 派单，全链路照旧顺畅）：`cnb pulls check-status` 快捷命令**不吃 `--repo`**——查 PR CI 用 `cnb pulls list-pull-commit-statuses --repo … --number N`；等 NPC 出 PR 可后台轮询 `list-pulls --state open` 计数（PR 一出现即审查）；NPC 分支删除后残留的历史已并分支可逐个核对 PR 映射后批量 `git push cnb --delete` 清光（远端只剩 dev）。
- 20260914 接管日补充：**PR 评论用 `cnb pulls post-pull-comment --repo … --number N --work-mode --body-file x.md`**——issues 的 `post-issue-comment` 打 PR 号报 404（PR≠issue 两套评论接口）；issues 的快捷 `comment` 命令缺全局参数会直接打帮助、用全名 `post-issue-comment`；`cnb git delete-branch` 的选项名是 `--branch`（不是 `--branch-name`）。
- 20260915 两坑：① **评论正文里有反引号必须走 `--body-file`**（heredoc 加引号界符生成）——`--body "…\`iconEye\`…"`会被 zsh 先做命令替换吞掉反引号内容，评论发出去了才发现缺字（patch-pull-comment --comment-id 可补救，NPC 流水线已触发不受影响，跑时读的是补正后的正文）；② 后台轮询取 PR head sha 要用`get-pull -v`的 JSON 输出 grep`"sha":`（非 -v 表格输出的 sha 值**不带引号**，按带引号写的 sed 剥不掉前缀 → 基线比对恒不等 → 误报 head 已动）。
- 20260915 审查补充：`get-pr-files` 必带 `--file-path`（单文件粒度，不便整 PR 拉清单）——**范围核对直接 `git fetch cnb` 后 `git diff --stat <base-sha> <head-sha>`**（两 sha 取自 get-pull 输出），顺手 grep 确认「声称零 diff 的文件」真不在清单里；查某 PR 的 CI 结论用 `get-build-logs` 输出 grep `-B14 "pulls/N"` 找同块 `status`。
- 20260916 补：NPC 流水线观测用 `cnb npc-observability npc-observability-actions --repo … --event pull_request.comment@npc --start-time <ISO>`（模块名+工具名连用，非顶层命令）；`get-pull` 可 grep 的关键字段是 `mergeable_state`（`conflict`/`mergeable`/`blocked_on: code_conflict`）与 `is_merged`，list 接口的 head_ref 类字段名对不上直接 grep 原始输出最稳；**worktree 里跑 build**：pnpm 崩 → 直调两条 webpack 且必须按序——先 `./node_modules/.bin/webpack --config webpack.kernel.config.js --mode production` 再 `webpack --config webpack.config.js`（app 配置引用 `dist/kernel.js` glob，跳过 kernel 产物直接 ERROR）。
- 20260916 午后批量收口四坑：① **merge-pull 撞冲突时静默返回空输出**（无 error 无 message）——合并后必须 `get-pull | grep mergeable_state` 确认真并上了；② **i18n 尾部撞键成并行惯例**：两单都在 zh-CN/en.json 尾部追加必 conflict（当日两例：#142 撞 matSplitTitle、#149 撞 colMore），后合并者 PR 评论召唤 NPC rebase「手工合尾+别丢键别重复+JSON.parse 校验」即可，不用慌；③ **NPC 会静默 rebase 不评论**：#149 召唤后零新评论但 mergeable_state 翻 mergeable，fetch 才见 force update 且多两个自查提交——轮询别只盯评论时间戳，**mergeable_state 翻转即 fetch 分支核对 head**；④ 仓库转移后老路径 API 有重定向别名但 git not found，且钥匙串缓存旧 token 要手动清（见 [[git-remote-push]]）；worktree 依赖在外置卷抖动期改用 /tmp 共享依赖（见 [[machine-b-env-pitfalls]] 第 6 条）。
- 20260916 转移后 **NPC 全体失灵根因=提及路径跟着仓库路径走**：CNB 仓库转移到 `bianchao777/sasa/siyuan-plugin-wengu` 后，旧 `@sasa1107/open-source/si-yuan/...` 提及**永久失效且零流水线零报错**（API 有重定向别名但提及没有）；新召唤语=`@bianchao777/sasa/siyuan-plugin-wengu(青简)`，重发 1 秒触发实证。排查顺序：`git remote -v` 看新路径 → `list-issue-comments` 看召唤用的哪条路径 → `get-build-logs` 找 `issue.comment@npc` 事件。**旧路径会藏在三处**：召唤评论、`.cnb/ISSUE_TEMPLATE/` 两个模板的预填召唤语（从默认分支读）、AGENTS.md 协作段——已全量换新（8233417+0649b45 直推 dev）。⚠️ AGENTS.md 也在 prettier 覆盖内，改完必须 `pnpm exec prettier --check AGENTS.md` 再推，否则 quality-gate 第一关 format:check 就挂。
- 20260916 定：**跟踪流水线/PR 用 sleep 前台轮询（用户认可）**——`sleep 45~90 && cnb build get-build-logs --repo …` 反复查最新 sn 的 status 即可，不必挂后台任务（quality-gate 1~2 分钟、NPC 召唤→出 PR 20+ 分钟）。口径已入仓库域笔记 `.agents/memory/env-debugging.md`「CNB 流水线观测」节（a772810 双推）。
- 20260915 再补：`list-issues` 默认只列 **open**（已关的不出现，核对已关单号用 `get-issue` 或看 list 总数）；**本地重构 vs 在途 NPC PR 的时序**=先并在途 PR、再落本地重构——stash 重构→合并 NPC PR→pull→pop→把 NPC 对旧结构的文档增量折进新位置（#106 的 AGENTS.md 移动端增量折进 `.agents/memory/mobile.md`），避免打回 NPC rebase。

**NPC 流水线节奏**：issue.comment@npc 触发后两段 npc go（实现 ~12 分钟 + 云端复核 ~10.5 分钟），全程 ~23 分钟、约 3 核时；`Ref: #N` 不会自动关 Issue，合并后要手动关。

**worktree 审查两个环境坑**：

1. 软链 node_modules 后 `pnpm exec/test` 会触发 verify-deps-before-run 想清空重装、无 TTY 直接崩——**直接调 `./node_modules/.bin/{tsc,vitest,svelte-check,eslint,prettier}`**，绕开 pnpm；
2. 同环境下 svelte-check 会报 5 条**假错误**（全在 node_modules 里 vitest 自身 .d.ts 找不到 vite/module-runner）——src 侧 0 错即可判过，别误打回。

**基线竞态无害**：NPC 分支基线=其 fetch 时的 dev 头；期间本地侧往 dev 推新提交会让 PR 落后 dev 一两个提交，只要 CNB 判 mergeable 就不必打回重拉（首跑实测：基线 c95fa45、dev 已到 57e94cd，照常合并无冲突）。

**合并后收尾三步（用户 20260910 定规）**：①删远端功能分支 `cnb git delete-branch --repo … --branch <name>`——删前先 `git merge-base --is-ancestor cnb/<branch> cnb/dev` 验证已全并入（PR #8 这类还开着的、或 feat/auto-index-on-know-import 这类 git 层面有未并入提交的，不删、报给用户）；②本地 `git fetch --prune cnb` 清陈旧 tracking 引用；③关 Issue。

**NPC 产出质量基线**：按 Issue 里「背景+诊断+验收标准」写清，青简产出小而准（顺手修了 Issue 没点名的同源注释、AGENTS 补防复发条目、反向验证写进 PR 描述）；云端复核角色在第二段 npc go 里跑。审查仍按 [[work-rules-siyuan-plugin]] 独立复跑四件套，不信自述。

**20260916 教训：「自检全绿」≠功能对，纯函数测试不锁装配链**——#141 首版五件套+规格断言全绿但分隔条 5 处静默失效（上限取自身=棘轮、比值分母同源=持久化永不落、复位不清库、键盘起点折 0、手柄闸棘轮死锁），NPC 拿真机几何口径复算才翻出；#142 首版单测全绿但闸装配链断裂（mountSideFor 出口写成空函数+壳侧漏接 switchGuard ⇒ 生产主路径全程死代码，测试只锁了 needsSwitchConfirm 纯函数）。审查除独立复跑四件套外，必须**核对生产链路真的接线**（壳侧访问器字段、出口回调是否真执行体），并警惕「断链不报错只静默直切/无反应」这类失效形态。两单的静默失效都是 NPC 自己第二轮复核抓出的——它自述「已完成零回归」时恰是最危险时点。

**NPC 模型配置（20260911 用户问、配置+实跑双核实）**：两角色在 `.cnb/settings.yml`（青简=实现、复核=审查），模型在 `.cnb.yml` 的 `npc:go.options`——`$` 兜底两个事件均为 `deepseek-v4.1-flash`、`复核` 角色覆盖为 `glm-5.3-flash`，thinkingLevel 均 high。实跑审计 `cnb build get-build-ai-audit --repo … --sn <sn> --pipelineId <sn>-001`：#26 召唤流水线 18,005,974 tokens 全落 `"deepseek-v4.1-flash"`；审计只对**已完成**流水线有数据（在跑的查 404）。复核角色（glm）至今没被召唤过——本地审查一直由 ZCode 承担。

**NPC 会自行复审补漏（20260911 起，已两例）**：合并后它会对已并 PR 自己开后续修复 PR（#31 复核钮归属、#32 user-select 级联洞，均 base=dev、CI 绿、质量高），审查节奏要多轮。退修时它推**同分支**新提交（如 #29 的 87eab0b→66b5cb8）——等修复的后台轮询要盯 **PR head sha 变化**，CI 状态恒 success 不能当新提交信号；轮询基线 sha 取自当前 PR 而非别的 PR（拿错过一次立即自纠重挂）。

**20260915 新坑——zsh 数组建单错位**：`declare -a T=(…)` 在 zsh 是 **1 起始**，
循环里 `${T[$((i-1))]}` 首项静默取空 → 首个 create-issue 被空标题拒绝（输出只有
5 个号），其余整批**标题比正文错一位**；批量建单后必须抽查「标题 ↔ 正文首行」
对齐（get-issue 两个 grep）。NPC 以**正文**为准开工，错位时改标题对齐正文即可，
不必重派；补缺维度用 update-issue 换 body 再 --work-mode 重召。
