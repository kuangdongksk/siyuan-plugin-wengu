---
name: wengu-opendesign-mcp
description: OpenDesign MCP 派对比/生成任务的实操要点——喂料法(本机路径直读不传参)、轮询纪律、项目与产物位置（20260914 实操验证）
metadata:
    node_type: memory
    type: reference
    originSessionId: sess_7d7ff9d5-1179-4f64-a078-840c06e65317
---

OpenDesign MCP（daemon `127.0.0.1:7456`，本机）派「对比/出稿/细化」任务的实操要点（20260914 AI 会话面板对比 run 验证；daemon 启动命令与 run 坑见 [[wengu-mobile-drill]]）：

- **建项目**：`create_project` 不带 skill（skillId 传 website 会 SKILL_NOT_FOUND，本机 skills 列表为空）。既有项目：wengu-mobile-drill-4971 / wengu-desktop-drill-06df / wengu-aipanel-redesign-fc7d（AI 面板对比）。
- **项目指定到仓库文件夹（20260915 用户要求「建项目必须指定文件夹」）**：MCP `create_project` 不支持目录；要 `POST /api/import/folder` JSON `{baseDir:"D:/...",name:"..."}`（baseDir 必须绝对路径且非根/非数据目录），daemon 会把整个文件夹导成项目（`metadata.baseDir` + `importedFrom:"folder"`），**run 产物直写该文件夹=直接入仓**，无取回拷贝环节。实测项目 `fdbb75ad-…` 根=仓库 design/。同文件夹既有文件对 run 只读（prompt 里要写明禁改历史交付物）。
- **目录规范（20260920 起）**：baseDir 一律指 `design/UI/<主题>/`——design/ 已按主题分目录（UI/刷题、UI/转换、UI/AI面板、UI/背单词），不再平铺；共享令牌表仍留 `design/theme-tokens-neo.md`。出稿流程已固化成 CCW 工作流（`.ccw/workflows/`），优先复用。
- **喂料法（关键）**：**不要把大文件读出来经手传参**（102KB HTML 无法塞进工具调用）。start_run 的 prompt 里直接给 ①本机文件绝对路径（`D:/...`，run 的 agent=claude 在本机跑、能直接 Read）②本地 http 服务 URL（`node -e` 一行起静态服务，如 design/ 目录 → 127.0.0.1:18923）③真机截图的临时文件路径。agent 自己读。
- **轮询纪律**：get_run 每 30-60s；`status:"running"` 且文件 mtime 不变 = 内部 agent 在思考/compacting，**不是挂了，禁止 cancel**（官方 hint 明确警告）。进度信号：tail 事件流 `C:\Users\awsd3\AppData\Roaming\Open Design\namespaces\release-stable-win\data\runs\<runId>\events.jsonl`（JSONL，看 tool_use/turn_end/compacting）。正常一单 5-30 分钟。
- **产物**：写进项目文件（prompt 里点名文件名，如 gap-list.md / xxx.html），`get_artifact`/`get_file` 取回；previewUrl/studioUrl 重启后要 get_run 刷新。
- **项目数据落盘位置**：`C:\Users\awsd3\AppData\Roaming\Open Design\namespaces\release-stable-win\data\projects\<id>\`（用户会直接引用这里的路径）。
- **生成 HTML 的格式门坑**：agent 写的 HTML 里正文/注释会出现 `` `<style>` `` 这类**字面量标签**（无闭合），prettier 的 HTML 解析器当真标签 → `SyntaxError: Unexpected character "EOF"`（报在文件尾行，极具迷惑性——真因是中间未闭合）→ CI 格式门 error。**产物入仓前先 `prettier --check`**，挂了用栈式配平器定位未闭合标签、字面量改写（如「style 块」）。同理 markdown 字面量 \`\` \`标签\`\` 在 HTML 文件里都不转义。
- **完成判定**：run 主体做完后状态可能长时间挂 `running`（收尾写总结慢）——以事件流里 TodoWrite 全勾 + 产物文件落盘为准判完成，别 cancel 也别当挂了重复派。
- **单 run 纪律**：同一任务**不许并行派发多个 OpenDesign run**（20260914 用户明确要求「注意不要派发多个 OpenDesign」）；断流重试=同任务新 requestId 重发，不是再开一单。
- **macOS（外置卷机器）无头启动（20260920 实测通过）**：app 不在 /Applications，在
  `/Volumes/baiWeiNV7200/Applications/Open Design.app`；`open -g -j <app> --args --headless`
  即起（launcher→sidecar supervisor 全链起来，socket 落
  `/var/folders/bk/2q8v1brx7mjf7qkhphjw_gzm0000gn/T/od-sidecar-501/`）。REST 直启 =
  Helper 二进制 + `…/prebundled/daemon/daemon-cli.mjs --host 127.0.0.1 --port 7456 --no-open`，
  env `ELECTRON_RUN_AS_NODE=1 OD_DATA_DIR=~/Library/Application Support/Open Design/namespaces/release-stable/data OD_SIDECAR_CLIENT_ENDPOINT=<活 sock>`。
  REST 路由在 `prebundled/daemon/chunks/server-CQLNCSGE.mjs`（POST /api/import/folder、
  POST /api/runs、GET /api/runs/:id、GET /api/projects/:id/files/:name）。
- **MCP stdio 探针坑（20260920）**：`/tmp/od-mcp.mjs` 探针 spawn 的 Electron Helper 把
  带空格的 daemon-cli 路径按空格截断（`Cannot find module '/Users/sasa/Library/Application'`）
  → initialize 超时；修法候选=sh -c 显式引号包路径或复制 daemon-cli 到无空格路径
  （注意 __dirname 资源解析）。修通前优先走 REST。

相关：[[feedback-opendesign-for-visual-compare]]、[[wengu-mobile-drill]]
