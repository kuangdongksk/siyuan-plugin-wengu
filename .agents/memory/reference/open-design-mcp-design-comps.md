---
name: open-design-mcp-design-comps
description: Open Design MCP 已挂 user 作用域，stdio 探针直驱出设计稿入库
    design/；三稿在库（阅读组题+转换停止入口+双端背单词）；socket 换批自愈与
    常驻 watcher 轮询坑已探明
metadata:
    node_type: memory
    type: reference
    originSessionId: sess_21f5ca61-5129-49c7-8938-6e114cf78c7a
---

20260914 用户授意：界面设计可用本机 **Open Design**（MCP）出稿，稿子入库存到仓库
`design/`（既有约定：单文件自包含高保真 HTML + Neo+ 令牌表 `design/theme-tokens-neo.md`）。

- MCP 注册：`~/.zcode/cli/config.json` → `mcp.servers["open-design"]`（user 作用域，
  会话启动自动连；当前会话可用 `/tmp/od-mcp.mjs`（`list` / `call <tool> <json>` /
  `call <tool> - <jsonFile>`）走 stdio 直驱。sidecar socket 是临时路径，重启后可能
  要用户重给（env 里 OD_SIDECAR_CLIENT_ENDPOINT）。
- ⚠️ **socket 换批自愈（20260916）**：daemon 重启后 sidecar sock 整批换新，探针
  硬编码路径失效 → initialize 永不回（探针只打 unsettled-await 警告，无错可读）。
  自愈：`ls -lt /var/folders/bk/*/T/od-sidecar-501/` + `lsof *.sock` 找被监听的活
  socket，sed 替换探针里的路径即可（sock 名按 client 派生，探针旧名会复现）。
  ⚠️ macOS 无 `timeout/gtimeout`——批量试 socket 时「全失败」是假象，直接裸跑 node。
- ⚠️ **轮询 get_run 必须常驻连接**：start_run 起跑后 daemon 忙，每次新 spawn
  daemon-cli 的探针 initialize 不再被响应；用 `/tmp/od-watch.mjs`（一次握手循环
  轮询到 terminalAt，45s 间隔，35min 兜底）。
- 工作流：`create_project`（自动带 skipDiscoveryBrief，无交互 brief 卡）→
  `start_run`（project+prompt；prompt 写足屏清单/真实文案/令牌兜底色值，它照单
  全收）→ 轮询 `get_run` → 拉产物（previewUrl `…/raw/<file>` 直接 curl 最快，
  get_file 也行）入库 + **必跑 prettier --write**。runs 约 10~15 分钟。
- ⚠️ **重复派单坑**：start_run 返回体是 JSON 转义串，grep `"runId": "` 匹配不上
  `\"runId\"` → 误判失败重发、实际双跑。找回 runId=按 mtime 列
  `~/Library/Application Support/Open Design/namespaces/release-stable/data/runs/`
  目录再 grep 项目名；`cancel_run` 可撤多余单。
- 渲染验收：chrome-devtools MCP 截图落盘受 workspace roots 闸限制（repo/temp 路径
  全被拒），用无头 Chrome 直渲（`--headless=new --window-size=W,H --screenshot=…`，
  H 用页面真实 scrollHeight）交 judge 读盘上 PNG。

3. `design/UI/背单词/wengu-word-redesign.html`（20260916，57bdade 出稿 + 4da21d5 换色双推）——
   双端背单词美化：桌面 dock 360px 8 屏 + 移动 390×844 6 屏，屏清单/文案逐条给足
   （首页三入口卡/先复习确认/四步梯三题型作答态/详情翻面态/完成+统计/查词），美化
   四板斧=卡片三层区分、主色节奏、tabular-nums 大数字锚点、梯进度「当前步拉长胶囊」。
   **出稿后用户点名换色**：OD 稿默认自造「亮色兜底 + prefers-color-scheme 暗色分支 +
   .theme-light 锁亮」不是仓库口径——已整稿换 [[theme-tokens-neo]]（design/
   theme-tokens-neo.md Neo+ 深色暖调实测值：陶土橙 #c5866a/深蓝灰 #272e33/青灰卡面
   #364852/暖米字 #d3cab4/暖沙低透明边框），与桌面刷题稿同口径（常驻深色、语义色用
   深底亮字变体 ok#9ec98a/err#f2a199/warn#e3c06b + 透明软底、画布 #20262b 比应用底
   深一档）。**以后 OD 出稿的 prompt 直接要求按 theme-tokens-neo.md 落色，省一轮返工。**
   实现单未派（等用户看过稿）。

两稿在库（均 judge 通过、已提交仓库）：

1. `design/UI/刷题/wengu-reading-unit-redesign.html`——英语阅读组题，核心诉求=材料正文
   过紧：段距 4px→17px、行高 1.75、68ch 行长、区内留白 22/24；含现状对照屏。
   用户问过文档在哪——答：仓库 design/ 文件直接开浏览器 + Open Design 应用内
   项目名可查；previewUrl 是 daemon 会话级、重启失效。
2. `design/UI/转换/convert-stop-redesign.html`——转换任务停止入口/进度，动因=面板记录级
   停止粒度错位（一条记录只是一次 AI 调用、停的却是整批）。稿内「本稿采用」结论：
   ① AI 面板顶部常驻「转换运行中」**流级横幅**（队列名 + 按篇着色构成条 + 第 i/N 篇 +
   累计题数 + 「停止整批转换」，与页内转换条同口径、二次确认一致）；② 记录级
   「停止」钮**去掉**、换归属说明行；③ 分篇六态=按篇着色构成条 + 计数徽标 +
   可展开逐篇行；④ 进度三级分配=页内全量/横幅摘要/记录只给本笔局部量。
   **我方审查已通过（20260914）**，落地补充口径：横幅框架按「多调用流→横幅、
   单调用流→记录即流保留停止」判定（六批流整流共用一个 aiAbort、记录级停止
   本就是整流语义；AI 索引/增量必须被横幅覆盖才能去其记录级停止）；横幅抉择态
   直挂 keep/discardConvertRun；二次确认走两击惯例非模态。**停止实现单已随 #79
   落地（20260914 并入 dev）——但只落了功能口径（单行简条），设计稿的视觉规格
   （构成条/六态计数徽标/可展开分篇清单/两行标题）整块未还原**；#79 收口评论
   遗留三偏差（计数缺 queued、六批流无进度摘要、六态无分色）问「要不要修」无
   下文=用户所说「停止的那次美化」。**还原单已派=Issue #85**（20260914 09:59Z
   召唤，范围=照稿还原视觉 + 补 queued 与六态分色，数据源 ConvertRunSnapshot
   .batch.items 透传不泄漏 convert 类型；范围外=六批流进度上报另开单）。
   **#85 已并 dev（4deab77）；面板侧 #88→#91 停止态→#92 精修（#93 落地
   c17482b，20260915）全链并齐，停止入口设计稿至此收口。**
   **阅读组题实现单已派=Issue #81**（20260914
   07:24Z 召唤，分支 feat/reading-unit，起点=cherry-pick feat/reading-spacing
   的 7e4d350 底子；最重口径=.wengu-reading 必须改英语卷条件挂载——底子是无条件
   挂会被数学卷误伤，判定复用 AnnoScope.isEnglishTypes 卷级先例；补齐三块=¶
   段落序号 CSS counter、悬停压深一档、稿内两处对比度修正映射 b3 令牌 color-mix
   派生）。实现硬约束：稿内烘焙的是 Neo+ 实测值（静态稿无运行时主题），落地
   全部映射回 var(--b3-*) 全名。**底子分支 feat/reading-spacing 在 #81 并后删除。**
