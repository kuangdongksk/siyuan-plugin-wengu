# AGENTS.md — 温故插件开发与调试备忘

给 AI 编码代理的项目说明。**调试环境按机器区分**，两台机器各自一节，
在别的机器上先确认本节路径/端口/token 再动手，并回填缺失信息。

## 项目速览

- SiYuan 插件「温故（wengu）」：笔记文档 → AI 转习题 → 页签刷题。
- 源码 `src/`（入口 `src/index.ts`，模块在 `src/wengu/`，样式 `src/scss/` 分片）。
- **硬性约束：仓库内单文件 ≤500 行**；界面规范见 `docs/design-review.md §〇`
  （图标用 `FormHtml.svgIcon` 禁 emoji；表单统一 FormHtml 行样式）。
- 改行为必须同步 `docs/question-block-contract.md`。

## 通用调试流程（两台机器一致）

1. `pnpm exec tsc --noEmit && pnpm exec eslint src --ext .ts && pnpm exec prettier --write . && pnpm run build`
   （**一律 pnpm，禁 npm/npx**；格式化用 Prettier 紧凑规则 `.prettierrc`
   120 列/4 空格——2026-08-24 起从 dprint 切换，dprint 已移除）
2. 安装：把 `dist/index.js`、`dist/index.css`、`src/i18n/{zh-CN,en}.json`
   复制到**本机工作区的插件目录**（见下）——i18n 忘拷会显示原始键名
   （看起来像「英文」）。
3. 重载前端：`POST /api/petal/setPetalEnabled`
   `{"frontend":"desktop","packageName":"siyuan-plugin-wengu","enabled":false}`
   → sleep 1s → 同体 `enabled:true`。之后让用户**重开温故页签**验证。
4. 验证安装：在装好的 `index.js` 里 grep 特征串；注意 minify 会把中文
   转成 `\uXXXX`，grep 原文中文可能查不到（用英文标识符/属性名查）。

## 机器 A（本机，Windows + Git Bash，已验证）

- 思源 3.8.0 桌面版，工作区 `D:\data\思源\工作`
- 内核 API：`http://127.0.0.1:6806`，`Authorization: Token gm8mhokhgd58ceaf`
  （token 变了去工作区 `conf.json` 里找 `api.token`）
- 插件安装目录：`D:/data/思源/工作/data/plugins/siyuan-plugin-wengu/`
- 思源前端源码（读实现用）：`C:\Program Files\WindowsApps\
89C2A984.SiYuan_3.8.0.0_x64__1qfd3tsw4ngc2\app\resources\stage\build\app\`
  （`common.*.js` 是压缩单行，**直接 grep 会卡死 shell**，先
  `tr ';{' '\n\n'` 分行再 grep）

## 机器 B（Mac，macOS arm64，已验证 2026-08-24）

- 思源 **3.8.1** 桌面版（比机器 A 的 3.8.0 新，内核坑一节若行为不符
  需重新验证），应用在 `/Volumes/baiWeiNV7200/app/SiYuan.app`（外置卷，
  不在 /Applications）
- 仓库路径：`/Volumes/baiWeiNV7200/sasa/siyuan/siyuan-plugin-wengu`
- 工作区 `/Volumes/baiWeiNV7200/data/思源/工作`
- 内核 API：`http://127.0.0.1:6806`，`Authorization: Token 8xmofpelwury3fkd`
  （同进程另有 `--attach-ui` 随机端口如 54644，用 6806 即可）
- ⚠️ **conf.json 在 `conf/conf.json`**——3.8.1 把它挪进了 `conf/`
  子目录，不在工作区根（和 3.8.0/机器 A 不同），token 变了去那里找
  `api.token`
- 插件安装目录：`/Volumes/baiWeiNV7200/data/思源/工作/data/plugins/siyuan-plugin-wengu/`
- 思源前端源码（读实现用）：`/Volumes/baiWeiNV7200/app/SiYuan.app/
Contents/Resources/stage/build/app/`（同机器 A：`common.*.js`
  压缩单行，先 `tr ';{' '\n\n'` 分行再 grep）
- 工具链：node v24 + pnpm 11 均可用，tsc/eslint/dprint/webpack 构建链
  全部验证通过
- **插件目录随思源同步在两台机器间流转**（temp/ 有同步冲突记录）：
  另一台机器装了旧版同步过来会盖掉本机新装——每次调试前先比对
  `md5 dist/index.js` 与插件目录里的是否一致，不一致就重装

### 机器 B 的 Shell 坑

- `setPetalEnabled` 成功时响应体带**整个插件 JS（约 2MB）**，直接打印
  会刷屏——加 `-o /tmp/pe.json` 再用 `node -e` 取 `.code`/`.data.enabled`
- zsh 内联 JSON 同样有转义坑——精确 payload 用文件（与机器 A 相同）

## 内核坑（3.8.0 真机实测，两台机器通用）

- **fetchSyncPost 必须串行**：并发调用互相吞响应挂起（12 题卡「加载中」
  的根因）。逐题/逐卡请求都要 await 串行。
- **内核 attributes 索引有数秒延迟**：新建文档立刻查 SQL 查不到，
  轮询（1s 间隔，15s 超时）。
- 未知路由返回 **200 + 空 body**，不能用状态码判断端点存在。
- 闪卡 API 是 `/api/transactions`（复数）+ `{reqId: 数字, transactions:
[{doOperations:[…]}]}`；旧 `/api/riff/addFlashcards` 等已不存在。
- `insertBlock/appendBlock` 在 3.8.0 不可用，写 kramdown 用
  `/api/filetree/createDocWithMd`；改块内容用 `/api/block/updateBlock`
  （markdown 里带 `{: id="…" 属性}` 可保留 IAL）。
- **没有可靠的「向已有文档追加内容」通道**（20260822 真机验证）：
  `updateBlock` 打文档根传多块 → 全部并成**一个段落**；打普通子块传
  多块 → **只保留第一段、后续段丢失**（危险）；`/api/transactions`
  的 `insert` 操作返回 code 0 但**静默无效**。增量写入只能
  「累积内容后整体 createDocWithMd 重建」。
- 内置智能体：`/api/ai/agent/chat` SSE，body `{message, language,
references:[], model?}`，model=设置里模型 id；`event:content` 的
  `data.token` 是回答增量，`event:error` 报错。**并发互斥**：同时两个
  调用，后到的直接返回 `{"code":-1,"msg":"session is busy in another
instance"}`（20260823 真机验证）。
- 旧直答端点 `/api/ai/chatGPT`（`{msg}` → `{code,data:回复全文}`）
  **支持并发**（真机验证），模型跟随设置默认、不可按次指定；插件要
  并发 AI 只有这条路。conf.json 里 providers 的 apiKey 是**内核加密
  密文**（hex，长 224/512），插件拿不到明文、无法绕开内核直连供应商。
- 插件 addDock 的 config **必须带 position 与 size**：缺 position 会在
  内核 dock 布局初始化里 `.startsWith` undefined 直接崩，且是 onload 级
  崩溃（整个插件不可用，20260823 真机踩坑）。
- Lute：自建实例必须 `SetInlineMath(true)`（编辑器默认关行级公式，
  否则 `$...$` 原样输出）；内嵌 Protyle 必须**逐卡串行挂载**（并发
  getDoc 挂起）。

## Shell/工具坑（本机）

- Git Bash 里转义会悄悄破坏 JSON payload——**精确 payload 用文件**
  （Write 工具写临时文件再 `curl -d @file`），别在命令行内联 JSON。
- `python` 是 WindowsApps 桩，用 `node -e` 做解析。
- 重 grep minified bundle 会卡死（见机器 A 节的 tr 分行法）。
- **CRLF 幻影脏**：pull 机器 B（Mac，LF）推的提交后，`git status` 报
  几十个 M 但 `git diff` 为空（换行符归一化假阳性，且会挡住 pull）——
  确认 `git diff --name-only` 无真实改动后 `git checkout -- .` 清掉再拉。
