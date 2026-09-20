---
name: clue-color-token-names-bug
description: #57 线索颜色全透明根因=用了不存在的裸令牌名 --b3-card-info（官方只有 -background/-color 全名）；Issue #70 已派青简修复
metadata:
    node_type: memory
    type: project
    originSessionId: sess_21f5ca61-5129-49c7-8938-6e114cf78c7a
---

20260914 用户报「所有颜色都是空的」（截图：色板四格空圈）。定诊：思源官方主题
（daylight/midnight theme.css 一致）只定义 `--b3-card-{info,success,warning,error}-background`
与 `-color` 八个令牌，**不存在 `--b3-card-info` 裸名**；交叉印证=思源「内联样式」
设置页 DOM 用 `var(--b3-card-error-background)`。

#57 六处全用裸名当背景：ClueColor.ts:55（clueColorStyle）、ClueColor.ts:80
（themeVarsUsable 探测裸名恒 false ⇒ 内联样式根本不写，fail-closed 把 bug 挡成全透明、
单测也测不出）、english.scss:374（默认黄兜底同裸名 ⇒ 透明）、english.scss:438
（annobar 角标）、ColorMenu.svelte:89（色板色块）、MaterialFlow.ts:103（chips 色点）。
前景推导 `${cssVar}-color` 反而本来就对。StatsCharts.ts:81 用的是正确全名。

修复口径：`CLUE_COLORS[].cssVar` 保持基名，背景一律 `${cssVar}-background`；
**20260914 全部收官**：#71 并入（888d50d）→ #70 关；#73 并入（7ce262c）→ #72 关
（转换族面板停止=abortFlow 总闸，顺带修「停止后多烧一个窗口」）；#69=另一条
并行会话 02:50Z 派的同题单（cssVar 全名+fgVar 方案），撞车关闭留档——**同一
bug 两会话各派一单的撞车实录**，派单前先 list-pulls 查在途。删远端分支×3、
prune、rebase 本地两笔（08a31f3 串行链 + 8affba9 设计稿）到新 dev、重构建装机
（md5 3055879f）并重载，四件套+svelte-check 全绿。落库 clueColors 零迁移。

同日第三批：**Issue #74**（题集源级哈希+分段边界表：set.srcContentHash + set.segs
{s,e,h} 每批落库段表；重导判定=续跑记录>未变更短路>逐段比对从失配段起重转>存量回退；
用户拍板 A+分段增强，痛点=逐段题集源没改也整卷重烧），流水线 cnb-t6g-1k2f8sefh。
另：停止入口 UX 设计稿已出 `design/UI/转换/convert-stop-redesign.html`（流级横幅+去掉记录级
停止），实现单未派待用户发话。教训：stdio 探针 start_run 的 grep 要配转义引号，
重复派单两次（cancel_run 补救）。

同日第四批：本地两笔已**推双远端**（08a31f3 串行链+8affba9 设计稿 → cnb
7ce262c..8affba9、origin 57e94cd..8affba9，用户明示授权直推）。中途插件目录被删
（用户卸载）→ 全新重装（plugin.json+icon+dist 产物+i18n，md5 3055879f，setPetalEnabled
重新注册）。**Issue #76** 全局 AI 在途信号灯已派（流水线 cnb-6cg-1k2f9l8v2）：
实锤=面板重试 `SessionPanelCtl.retry→agentChatContinued` 零闸直发、判分/伴学同无约束，
4 并发转换+重试=5；闸=client.ts 信号灯容量注入（默认 4）、abort 感知排队、超时取槽
后起算、FIFO 唤醒链不吞异常、转换 worker 池不动。**停止 UX 设计稿我已审通过**
（四结论全认可：流级横幅/去掉记录级停止换归属说明/两层密度分篇全景/进度三级分配），
两条落地口径=①横幅框架按「多调用流→横幅、单调用流→记录即流保留停止」判定，
AI 索引与增量重导入必须被横幅覆盖才能去其记录级停止（#73 给它们接过停止）；
②六批流本就整流共用一个 aiAbort（launchAiFlow 一条句柄贯穿），记录级停止已是整流
语义，横幅覆盖后一并收编；③横幅抉择态直挂 keep/discardConvertRun，二次确认走
两击惯例。停止实现单排 #76 并后同域串行派。

**20260914 下午调度收官（三 PR 全并）**：#78 并（af430cb）→ #76 关（在途闸：
queue.ts 信号灯+缩容 debt 存量债防自锁+入队竞态补 drain，容量=convertParallel
设置注入）；#79 并（86200d7）→ #77 关（流级横幅：FlowRegistry 单条约束/ConvertFlow
**订阅快照单向同步**=ConvertBatch 零改动化解与 #74 冲突面/八个 launchAiFlow 调用点
全接 meta/页内停止钮两击确认同口径）；#75 并（567a33f）→ #74 关——**退修一轮**：
分支混入范围外的阅读间距实现（75e8132，无 issue 无验收）+设计稿格式化（a414188
含 .prettierrc override，属多余），评论召唤退修，NPC 按指令摘除并把间距实现留存
**`feat/reading-spacing` 分支**（阅读实现单认领时取用后删）；重放提交改动集与原审
通过版本逐字一致（比对法：各相对自己 parent 的 diff --stat，不能直接 diff 两 sha
——base 不同必含已并 PR 的噪音）。合并后 dev 全量 vitest 1166 绿。

当日新坑三条：① **Open Design 出稿 HTML 不过 Prettier ⇒ 挂所有 PR 质量门**
（三个 NPC 各自叠「格式化自救」提交；convert-stop-redesign.html 同病，已本地
格式化 a52f84a 推双远端——**出稿入库前必须跑 prettier --write**，该步进流程）；
② **CNB PR CI 用 merge-sha**：list-pulls/get-pull 的 head sha ≠ CI statuses 的
sha 是常态（merge(base,head) 的产物），不等于 NPC force-push，别误判；③
update-issue 关单必须带 `--state-reason completed`，只给 --state 不生效。
