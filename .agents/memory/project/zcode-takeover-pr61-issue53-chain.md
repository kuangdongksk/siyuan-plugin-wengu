---
name: zcode-takeover-pr61-issue53-chain
description: 20260914 ZCode 接管调度——#64 已并、#61 移动端退修两 finding、#53 三期已派、quiz 链 #53→#56→#57 串行
metadata:
    node_type: memory
    type: project
    originSessionId: sess_969ca68a-bf33-46d2-b24d-db8d84de0e4a
---

20260914 ZCode 接管在途调度（用户令「你来接管」），**当日全部收官**：五个 PR 全并（#64=aa0d0d7 续跑游标、#61=dd37a22 移动端刷题、#65=b017a6f 词表入装饰层、#66=389c830 重叠并集、#67=43f94d9 三期残项清理、#68=6d65093 线索多色），五个关联 Issue（#59/#53/#56/#57+#62 补评）全关，远端零残留分支、开着的 PR/Issue 双零。审查工作流：worktree+软链 node_modules 直调 .bin，红绿闭环（回退改动看测试变红）+ 行数红线（合并态）+ production build（动入口才需要）。

**#57 线索多色落地形态**：`ClueColor.ts` 纯逻辑（`clueColors` 平行数组、缺位/越界落默认黄、CSS 变量探测走声明值非计算值）；`ColorMenu.svelte` 可复用零 style 竖排色板（armed 闸防 #36 式冒泡自关）；浮条主路径一步标默认黄不变、选色独立小色块钮 2 击；`MaterialDecorate` 拆出 `ClueDecorate`（施工）/`CanonDom`（观测）压 500 线，门面转出调用侧零改动。

**PR #61（移动端刷题 dock，Issue #59）已合并 `dd37a22`、#59 已关**（20260914）。退修一轮即过：青简按两条 finding 修（reRecord batch 分支按 `s.endedAt` 分流覆写、instant 判完 `if (ui.graded) checkAllDone`），4 条回归测试本机验证 load-bearing（回退即 2 红）。审查基准：四件套（svelte-check 5 条 node_modules 假错）+ 全量 1002 测试 + production build 全过。

**quiz 域串行链 #53 → #56 → #57**：#53 已并（PR #65=`b017a6f`，#53 已关）——词表联动迁入统一装饰层，`decorateMaterialEntry`/`decorate`/`redecorateClues` 门面化、GlossDom 变纯渲染契约模块、挂载点两段调用合一段；#56 已并（PR #66=`389c830`，#56 已关）——`mergeMarkSlots` 纯函数（同节点重叠/相接取并集、text 归最长线索、curLen 另记防并集拉长漂归属），双链接线（权威坐标路径 `MaterialDecorate.applyClues` + fallback `ClueMarkDom.applyClueMarks` 都在 markSlots 后过合并），退修零轮、CI 一次绿；#57 已派（线索多色 `ColorMenu.svelte` + `clueColors` 平行数组，派单评论注明 #56 归属语义可直接消费），轮询器盯 dev 外新分支。

**并行判定教训（20260914 实撞）**：「同域串行、异域可并行」按改动面文件交集判定时，**必须算消费方**——#61（mobile）import 了 `MaterialDecorate.decorateMaterial`，#53 把这个导出改名成 `decorateMaterialEntry`，两单并行导致 #65 CI svelte-check 红（merge 后 import 失配）。文本无冲突、mergeable 照样过，**语义断在我的盲区**。青简自己发现并自修（改 import+合 dev 进分支），没退修。往后判定：改动文件的**导出符号被谁 import** 也要查一遍，rename 是 API 破坏性变更。**另一条审查教训**：审 PR 别只看分支 diffstat，**合并态行数也要查**——#66 过审时单看它自己没破线，叠在 #65 上 dev 的 MaterialDecorate.ts 已 518 破 500 红线，靠 NPC 并后自补漏（PR #67，已并 43f94d9）才压回。

**等待手法**：后台 bash 轮询器 `git ls-remote cnb` 盯 `feat/mobile-drill` sha 变化 / `refactor/gloss-into-decorate` 分支出现（见 [[cnb-npc-full-workflow-first-run]] 的退修盯 head sha 口径）。两单都到齐后各自独立 worktree 审查、合并、删分支、关 Issue（#59 随 #61 合并关闭）。

关联：[[reading-select-gloss-batch-26-33]]（线索链前情）、[[quiz-annobar-select-clue-redesign]]。
