---
name: wengu-mobile-drill
description: 移动端刷题：#61功能腿已合并(src/mobile ~2700行)但照稿视觉还原未做(101区块稿vs六组件骨架)；设计稿design/wengu-mobile-drill.html与OD原版一致；下一步=OpenDesign对比流程出差距再派精修
metadata:
    node_type: memory
    type: project
    originSessionId: sess_3a4adb84-2c73-4b34-a360-9cc6ba1d8619
---

2026-09-13 设计初稿完成。走 **OpenDesign 本地管线**（Vela 云未登录、amr-runtime 不可用，不影响本地出稿）：

- **产出**：项目 `wengu-mobile-drill-4971`，交付 `wengu-mobile-drill.html`（82KB 单文件零外部依赖，九屏 390×844 并排：①开刷面板(续刷卡+判分模式+本次题数) ②多选题 ③判断题(C代码块) ④材料组题(英语阅读) ⑤解答题分步 ⑥即时判分反馈 ⑦收卷模式 ⑧轮次报告 ⑨题号抽屉；思源蓝主色+对/错语义色、内嵌线性 SVG、触控≥44px；屏内可点按交互）。20260913 本机浏览器评审通过：内容自洽（多选 A/C 正确集与「已选2项」自洽）、九屏全齐、刷新后首屏完整。⚠️ 页面 #deck 的 scrollLeft 会存 localStorage 恢复，内层 .scroll 若见内容「被裁」先刷新再看——多半是会话滚动污染非缺陷。文件在
  `C:\Users\awsd3\AppData\Roaming\Open Design\namespaces\release-stable-win\data\projects\wengu-mobile-drill-4971\wengu-mobile-drill.html`；
  daemon 活着时预览 `http://127.0.0.1:7456/api/projects/wengu-mobile-drill-4971/raw/wengu-mobile-drill.html`（重启后 get_run 重取）
- **桌面稿（20260913 同日加做）**：项目 `wengu-desktop-drill-06df`，交付 `wengu-desktop-drill.html`（96KB，7 屏 1440×900 纵排：开刷面板/单选作答/多步题/即时判分揭示/收卷+交卷确认/轮次报告/错题本）。**跟 Neo+ 深色暖调主题**（主色 #c5866a 陶土橙、底 #272e33、正文暖米 #d3cab4——用户实际跑的是 Neo+ 深色，移动稿假定的白底亮色是错的假设）。喂素材法：思源 web 界面（内核端口 /stage/build/desktop/ 免认证）实拍两张运行截图 + getComputedStyle 读 b3 变量，写进项目 `reference/`（theme-tokens.md + PNG），prompt 里让 agent 先读。本次干净收尾无截断
- **桌面稿（20260913 同日加做）**：项目 `wengu-desktop-drill-06df`，交付 `wengu-desktop-drill.html`（7 屏 1440×900 纵排：开刷面板/单选作答/多步题/即时判分揭示/收卷+交卷确认/轮次报告/错题本）。**跟 Neo+ 深色暖调主题**（主色 #c5866a 陶土橙、底 #272e33、正文暖米 #d3cab4——用户实际跑的是 Neo+ 深色，移动稿假定的白底亮色是错的假设）。喂素材法：思源 web 界面（内核端口 /stage/build/desktop/ 免认证）实拍两张运行截图 + getComputedStyle 读 b3 变量，写进项目 `reference/`（theme-tokens.md + PNG），prompt 里让 agent 先读。⚠️ **用户会在 OD 桌面端自行 refine 重跑并覆盖文件**（b0aa8473 已替换我的 8522e2a6 版且更优：真 2020 Text1 原文、dataviz 环形图规范）——验收前先对 mtime/runId 确认看的是哪版。**我修过一版**：.sel 类名撞车（下拉框 .sel{min-width:300px} 撞上树节点 class="node lvl3 sel"，选中题集标题与题数挤一行并溢出侧栏）→ 下拉框改名 .dropdown（行首锚定 sed 防误伤 .node.sel）
- **看渲染图的保底路**：IAB/浏览器 MCP 挂了就用本机 Chrome 无头——`chrome.exe --headless=new --screenshot=x.png --window-size=1520,980 file:///...`；逐屏看用 sed 给副本注入 `<div style="position:relative;top:-Npx">` 平移再截；量布局用 --dump-dom + 注入 script 写 document.title。Read 工具可直接看 PNG
- **桌面稿定夺（20260913 用户）**：**桌面端不改版**——现有布局已经很好，不需要设计稿那种一体化重排；稿里做得好的是间距/留白，仅留作以后桌面视觉微调的参考，不据此开任何活。移动稿才是要落地的：过审后出审核文档 + 开 Issue
- **落地（20260913 用户拍板）**：移动稿过审转开发。设计稿已入仓 `design/`（wengu-mobile-drill.html 九屏 + wengu-desktop-drill.html 七屏留档 + theme-tokens-neo.md），走 PR #58 合并进 dev；**开发 Issue #59 已派发**（含九屏清单/移动端硬约束/六条可验证验收标准）。**与线索链并行召唤已执行**（20260913，用户批准三连：改并行约定/审PR#60/召#59）：评论里加「并行提示：勿动线索域文件、AGENTS.md 只追加移动端段落」。⚠️ **召唤坑（20260913 实测）**：提及放引用块（行首 `> `）**不触发流水线**且零报错——顶格重发 1 秒内触发；坑已补进 AGENTS.md 召唤约定段。NPC 已在跑（11:18 `issue.comment@npc` 触发）
- **待办**：NPC 开 PR → 我审 PR（重点：桌面零回归=无 `.wengu-mobile` 标记时逐字节不变、与线索域文件零交集核查）→ 真机验收
- **20260914 晚核实（用户问「移动端怎么感觉没开始做」）**：#59/**PR #61 已合并**（feat(mobile): 移动端仅刷题 dock 面板与作答流）——`src/mobile/` 独立域 ~2700 行：HomeScreen/DrillScreen/QuestionBody/NumDrawer/ReportScreen 六组件 + MobileModel/MobileDrill/MobileAnswering/MobileMaterials 核心 + 单测，真机 dock 能跑通全流程。**但照稿视觉还原一行没动**（101 区块稿 vs 六组件骨架）——「能用骨架≠设计稿样子」，观感即「没开始」。设计稿 `design/wengu-mobile-drill.html` 与 AppData 项目原件逐区块核对一致（101/101），无需再迁。下一步=移动端视觉还原：建议走 OpenDesign 对比流程（同 AI 会话面板，见 [[feedback-opendesign-for-visual-compare]]），最好先要用户手机实拍三张（首页/答题/报告）喂给对比。
- **daemon 坑**：MCP 工具报「cannot reach daemon at 127.0.0.1:7456」= daemon 没跑（MCP stdio 通道本身是好的）。无头启动：
  `ELECTRON_RUN_AS_NODE=1 OD_DATA_DIR=C:\Users\awsd3\AppData\Roaming\Open Design\namespaces\release-stable-win\data OD_SIDECAR_IPC_PATH=\\.\pipe\open-design-release-stable-win-daemon "D:\program\Open Design\Open Design.exe" <resources\app\prebundled\daemon\daemon-cli.mjs> --host 127.0.0.1 --port 7456 --no-open`
- **run 坑两则**：① 首轮 17 分钟纯思考后被 `AGENT_CONNECTION_DROPPED`（stream_disconnected）掐断——本机网络老毛病，标记 retryable 时直接再 start_run（新 requestId）即可；② 收尾时 agent 自行重构压缩文件，重构跑到一半 run 终止（`endedWithUnfinishedWork:true`），文件被砍剩一屏——**完整版在项目 `.file-versions/<hash>/0001-*.html` 快照里，直接 cp 回来即修**（agentMessage 描述的是完整版内容）。验标签配平别用 grep 数 `</div>`（MSYS 把参数里 `/div` 当 POSIX 路径转换成 Git 安装路径），用 node 在运行时拼正则
- **agent 运行时**：本地 `claude`（Claude Code CLI 2.1.239）可用，codex/opencode 亦在但本轮用 claude；消耗 Claude 配额（本轮 ~7.8 万 uncached + ~178 万 cache-read tokens，run 约 29 分钟）。IAB 截图自检没走通（webview 挂不上，仅 iab 后端），视觉验收靠用户开文件

相关：[[wengu-dispatch-20260913]]
