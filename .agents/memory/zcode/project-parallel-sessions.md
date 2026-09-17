---
name: project-parallel-sessions
description: 本仓库有多个 AI 会话并行工作，回合中途会发生提交/合并——编辑前文件可能已被别的会话改掉；既定协作流程是 worktree 隔离开发+部署先行+对方停下后再合并
metadata:
    node_type: memory
    type: project
    originSessionId: sess_265f8127-992b-406c-9fe3-b3f644f5fb04
---

用户同时开多个 AI 会话操作 siyuan-plugin-wengu 仓库（2026-08-22 实证：一个
回合进行中，另一会话把我的未提交改动落盘成 562b3bb「另一会话的未提交
工作」，随后又合并了 steps 功能分支 af79513；2026-08-23 再证：回合中途
出现另一会话的单词本半成品 WordBook/WordStore/WordView + words.scss 和
index.ts 改动，且该会话把我先前的 batch-convert 分支自行合并进 dev）。

**Why:** Edit 报「File has been modified since read」往往不是 linter 而是
并行会话真的改了文件；git status 从「有我的未提交改动」变成 clean 说明
别人替我提交了。steps 合并还带进两个超 500 行硬约束的文件
（QuestionService 590 / QuizView 506，design-review 已标待拆）。

**How to apply:** ① 编辑失败先重读文件 + `git log --oneline -5` 摸清
现状，基于最新 HEAD 继续，绝不覆盖并行改动；② 我留下的未提交改动可能
被其他会话提交或合并，动手前先看 git log 确认自己的工作是否已落盘；
③ 别单方面重构刚被别的会话合并进来的代码（可能还在被那个会话改），
发现超限/冲突先报告给用户；④ 提交时只 stage 自己的文件，混在同一个
文件里的改动用 hunk 过滤（`C:/Users/awsd3/.zcode/cli/filter-patch.mjs` +
`git apply --cached`）；⑤ **npm run build 会把并行会话的半成品一并编进
bundle 并装进思源**——重载后看到陌生功能/异常先想到是并行工作，别当
自己的 bug 修。

**已跑通两轮的并行协作流程（2026-08-22/23）：**

- 开发在 `.worktree/<名字>` 的 git worktree 里建独立分支（主区只加一行
  `.gitignore`），worktree 内四绿（tsc/eslint/dprint/build）后提交；
- **部署先行**：把 worktree 的 dist 拷到插件目录 + petal 重载，用户立即可用；
  合并不急；
- 合并前查主区脏文件 mtime：几分钟内还在动 = 对方活跃，先不合；脏文件
  与合并重叠时 git 会干净拒绝（无损伤）。判断依据用 `ls -lt --time-style=+%H:%M`
  对比当前时间；
- 被脏文件挡住且对方已停（mtime 陈旧多时）：把对方未提交工作**一字不改**
  落盘成独立提交（提交信息注明「另一会话的未提交工作，原样落盘」），再
  合并自己的分支，冲突按双方意图合；
- 每轮开工先快进 worktree 到最新 dev（对方可能已合并我的分支并继续
  重构，如 QuestionGrading/Flashcards/ConvertHost 拆分），动手前重确认
  目标函数的新位置；
- **主区干净且对方停摆（无脏文件、mtime 陈旧）时可直接在 dev 上做小改**
  （2026-08-23 转换进度行细化即如此，无需 worktree），但动手前仍要先
  `git status` + mtime 确认；
- **高频冲突点：i18n json**——双方都在文件尾追加键，冲突解法=两边键
  都保留（按 JSON 解析验证）；UI 类冲突常因对方把组件迁移到 FormHtml
  表单构件（formGroup/formRow），解决时把我的新 UI 也改用该规范；
- git push 到 origin（GitHub）时通时不通：2026-08-22/23 多次 Connection
  reset，但 2026-08-24 一次成功（9497b64）——失败别反复重试，但值得每轮
  合并后试一次；本地 dev 始终是事实源；2026-08-27 再证：SSL 超时/连不上
  持续约 3 分钟后自愈，`for i in 1..8; do git pull && break; sleep 30; done`
  循环拉取有效；
- **2026-08-27 新实证：并行会话的「半成品窗口」会污染校验链**——对方
  正在改 Prompt.ts+Prompt.test.ts（签名加了参数、测试还没跟上）时，我的
  tsc 报 TS2554、vitest 全量红；几分钟后对方改完自愈。遇到「单文件绿、
  全量红/凭空红」先 `git status` 看有没有我没碰过的文件在动（本轮是
  companion 域 + i18n + CHANGELOG），确认不是自己的改动后等对方收敛，
  别去修别人的半成品；
- **2026-08-29 新战术一：对方脏文件在飞时，dist 构建走干净 worktree**——
  `git worktree add --detach ../wengu-build-tmp HEAD` + `pnpm install
--prefer-offline` + 全套检查 + build，dist 从 worktree 拷贝部署，确保
  只含已提交代码（对方半成品绝不进 bundle）；`worktree remove --force`
  被节点模块锁挡就 `rm -rf` + `git worktree prune`；
- **2026-08-29 新战术二：同文件混入双方改动时用 awk 过滤 hunk 摘取提交**——
  `git diff <file> | awk '/^@@/{h++} h<=N {print}' > patch` + `git apply
--cached`，只 stage 自己的 hunk（旧的 filter-patch.mjs 同思路，内联更
  轻）；注意先确认对方的相关改动已进 HEAD，否则自己的 hunk 上下文对不上；
- **对方可能提交红 tsc**（20260829 波B 的 `new Error(msg,{cause})` 需
  ES2022 lib 而仓库 lib es2020）——干净 worktree 里 tsc 可辨归属；修
  tsconfig lib es2020→es2022（05efcb0）属加法型变更可放心提交；对方以
  「三轮审查波B/C/D/E」命名成波连续提交，脏文件域会换（word→quiz→…）；
- GitHub 断连可持续整轮（20260829 TCP 级连不上重试无效），一轮恢复时
  会把双方积压全部推上 origin——本地 dev 仍是事实源，下轮开工先 push；
  自愈时长不一（20260829 一次约 5 分钟，60s 间隔循环第 7 次成功）；
- **2026-08-29 部署竞态**：并行会话从其 worktree 构建部署会**整体覆盖
  插件目录产物**且缺我最新提交——对方 12:46 的部署把我刚提交的 css
  守卫（1bb4ce1）盖回旧版（内容少 414 字节），用户看到的「没修好」实
  为被覆盖。对策：每次部署后 `md5sum dist/xxx 插件目录/xxx` 复核；发现
  被盖直接从共享树重建部署（共享树含双方已提交内容），并提醒对方下轮
  先 pull 再 build；
- **对方的提交本身也可能红 tsc**（f260ef8 把 beginDrill 改名
  beginDrillFor 漏改 QuizShell import，HEAD 全红）——HEAD 红不一定是
  自己或半成品窗口，看提交归属顺手补漏并在提交信息注明。
- **2026-09-04 提交竞态新实证**：我准备摘 hunk 提交时对方抢先 commit
  （723c9ef）——同窗口改过的四个文件被**整文件**卷进对方提交（点名
  纪律防不住同文件混改，唯一防护是提交时机），我的测试文件因对方点名
  而幸免、按剩余独立文件补提交（e320629）。教训=**摘 hunk 前先
  `git log` 摸一遍；`git diff <file>` 突然变空=已被对方提交的信号**，
  白做拆分。随后 rebase 整合机器 B 同日推的 LICENSE 变更（3a73a04），
  CHANGELOG「双方各加条目」型冲突解法=两边都留；
  相关：[[feedback-delegate-decisions]]
