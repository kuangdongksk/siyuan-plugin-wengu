---
name: scheduling-20260915-aipanel-chain
description: 20260915 调度日：AI 面板三单（#91/#93/#94）全并 dev=ec433d9 双清零；
    退修抓出索引流停止理由缺口与停止态文案空引号对，成句级断言成新口径
metadata:
    node_type: memory
    type: project
    originSessionId: sess_52d2d05b-f693-475f-be6b-5e82a1315a07
---

20260915 调度日（青简三单全并，PR/Issue 双清零，本地 dev 已 ff 至 ec433d9）：

- **#91**（feat/ai-panel-design，827f4ea）＝#88 停止态补齐：`AI_STOPPED` 哨兵
  （status 仍 error、error 字段落哨兵）+ `ai/client.isUserStopOf`（判据=
  aborted **且** reason===AI_STOPPED，分辨用户停止与兄弟失败连坐）+ 面板四态
  （run/done/fail/**stop**，`leafStateOf`）+ 组行去色点 + 时间线只取真实锚
  （user=createdAt、ai=endedAt）。**退修一轮**：AI 索引流三处用户停止
  （KnowPanelCtl 页内再点/面板点停、KnowOutlineFlow 横幅）漏带理由——
  三处同一个自建 ctrl，漏一处就有条路径把停止显示成失败。
- **#93**（feat/aipanel-gap-list，c17482b，关 #92）＝照施工规格精修一体卡与
  全部数值差：`.wengu-aipanel` grid（292px+1fr、横幅入卡作跨栏首行）、组行
  A1 缩进、行尾三件化、详情 meta 折 title、轮次日志一行一轮（S6）、横幅
  分篇清单尾行汇总（只报可确定数）。**rebase 后退修一轮（阻断）**：停止态
  own-note 与在途态共用 body/tail ⇒ 拼出空引号对「」+「要停止请用横幅」
  指令下给已停记录（测试只锁段键序列，锁不住成句语义，CI 全绿带病）。
  修后=停止态持独立一整套词（aiOwnStoppedBody/Tail、BatchBody），**成句级
  断言**（真实 i18n 表拼整串，查停止指令子串/空引号对/引号配对）锁死。
- **#94**（docs/stop-reasons-note，ec433d9）＝青简在 #91 合并后**自查**抓到
  client.ts `isUserStopOf` JSDoc 残留「唯一写入点」清单性表述，纯注释修复。
  feat/ai-panel-design 被它重建过一次（同内容双分支），并 #94 后两个分支都删。

**Why**（教训）：

1. 分段文案的测试锁段键 ≠ 锁成句——两态共用的模板段一旦有语言写法耦合
   （引号对夹 accent 词），省段即拼坏；文案改造必须加**成句级断言**。
2. NPC 合并后还会继续自查补漏出新 PR——**收工前必须再看一眼远端分支与
   open PR**，别以为删分支=结束。
3. 两 dot `git diff dev..branch` 会把「分支基线旧于 dev」显示成大段删除，
   误判成回退；判 PR 实际改动用 `list-pull-files`（merge-base 三方口径）。

**后续三单（同日下午，用户报「AI 会话列表过长整页滚动」后）：**

- **#95**（baf1945）＝#93 修复引入的**幽灵键**缺陷：批流停止支读的收尾键
  `aiOwnStoppedBatchTail` 在 i18n 里根本不存在，而插件取词是 `i18n[k] || k`
  ——**缺键回落键名（truthy）**，`if (tail)` 把字面键名渲染进面板。教训：
  「读一个可缺省的键、靠空值判不渲染」在 key-fallback 取词下是坑，**要么键
  一定在、要么代码根本不读**；#95 的测试升级成「探针 t」（记录每次取词键，
  断言全部在词典且非空、成串不泄漏键名），把测试环境与运行时回落差距焊死。
- **#96/#97**（ae56599）＝**整页不滚动**（用户 20260915 拍板并要求落规范）：
  `docs/design-review.md` **§〇 第 11 条**成硬性规范——面板高度适配宿主视口、
  滚动收进面板内部滚动窗、常驻件（标题/hint/过滤条）与横幅钉在视野里。
  实现＝`.wengu-ws-main--fit` 档（共用骨架的 overflow-y:auto 一字不动，挂载/
  卸载**配对开关**在 SessionPanel.ts）+ 高度链每级 `min-height:0` + **grid
  行高必须显式分配**（`auto minmax(0,1fr)`，缺了列拿不到剩余高——本单最隐蔽
  坑）+ 两列 `overflow-y:auto` + `scrollbar-gutter:stable`；≤1000px 折单列
  行高同步改（否则树行被压成 0 高）。宿主 `PanelFit.workspaceFits` 白名单
  当前只有 ai，其余管理面板迁移等用户发话。
- **调度增量教训**：NPC 会在**合并后**继续自查出新 PR（#95 就是并完 #93 又
  冒出来的），轮询召唤目标分支时先 `ls-remote` 全表看有没有意外分支；NPC 按
  旧基线出的分支与刚合并的 PR 表面上「互相回退」，**以 merge-base 判定**——
  分支没碰的文件三方合并时 dev 侧胜出，可直接放行。UI 交互验收用户自行真机
  走查（「我验收即可」），我不必开浏览器自动化代验。

**How to apply**：调度收尾三步（验远端只剩 dev、open PR/Issue 清零、本地
ff）之外加第四步：合并后轮询期里再查一次 ls-remote 与 PR 列表，接住 NPC
的迟到自查单（如 #94，CI 绿即快并）。停止入口全清单住 AGENTS.md「中止 ≠
失败」段；新增停止入口必须并入该组并带 AI_STOPPED。参见
[[open-design-mcp-design-comps]]、[[clue-color-token-names-bug]]。

**傍晚续终（用户关掉原会话，我接管审查）**：AI 面板链的两张合并后自查单
**#101**（`fix/aipanel-detail-expanded`→8078934，展开/可展开判据落
`ai/core/SessionDetail` 的 `isRowOpen`/`canExpandRow` 带单测——组件 $state
挂不进 vitest 判据就没回归锁；块间距 `:last-child`→`+ .wengu-aipanel-logseg`
相邻块，修单块行留白被收）与 **#103**（`fix/ai-panel-no-page-scroll`→738462a，
`fitTargetOf` 只动本面板宿主子树那份 `.wengu-ws-main` 骨架——document 级
`querySelectorAll` 会改坏别的页签主区；aipanel.scss 576 行拆出
`aipanel-tree.scss`，`@use` 必须排在基础片**之后**因 @media 源码序决胜）均审过
即并。同会话还并了 **#102**（feat/start-panel-design→5363e83=dev 头，关 #100
＝开刷面板同步设计稿屏①：双卡片/范围行恒渲染/「开始刷题」唯一 primary/
统计条分段，退修一轮补 CHANGELOG+AGENTS）。三 PR 同段 hunk 不重叠自动合并；
分支全删、#96/#98/#100 全 closed、真机走查待装机。
