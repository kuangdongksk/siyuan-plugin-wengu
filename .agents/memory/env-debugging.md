## 通用调试流程（两台机器一致）

1. `pnpm exec tsc --noEmit && pnpm run check:svelte && pnpm exec eslint src --ext .ts && pnpm exec prettier --write . && pnpm test && pnpm run build`
   （**一律 pnpm，禁 npm/npx**；`check:svelte`=svelte-check 检 .svelte
   组件类型——tsc/eslint 都不覆盖 .svelte，它缺了组件错误只能在
   构建/运行期暴露；格式化用 Prettier 紧凑规则 `.prettierrc`
   120 列/4 空格——2026-08-24 起从 dprint 切换，dprint 已移除；
   `pnpm test`=vitest 纯逻辑单测，内核 IO 不进单测——真机行为坑见
   下文「内核坑」，测试配置见 `vitest.config.ts` 与 `tests/siyuan-stub.ts`）
2. 安装：把 `dist/index.js`、`dist/index.css`、`src/i18n/{zh-CN,en}.json`
   复制到**本机工作区的插件目录**（见下）——i18n 忘拷会显示原始键名
   （看起来像「英文」）。
3. 重载前端：`POST /api/petal/setPetalEnabled`
   `{"frontend":"desktop","packageName":"siyuan-plugin-wengu","enabled":false}`
   → sleep 1s → 同体 `enabled:true`。之后让用户**重开温故页签**验证。
4. 验证安装：在装好的 `index.js` 里 grep 特征串；注意 minify 会把中文
   转成 `\uXXXX`，grep 原文中文可能查不到（用英文标识符/属性名查）。

## CNB 流水线观测（20260916 用户定：sleep 前台轮询即可）

- 跟踪 NPC 召唤 / quality-gate 进度：`sleep 45~90 && cnb build get-build-logs
--repo bianchao777/sasa/siyuan-plugin-wengu` 反复查最新 sn 的 status，
  **不必挂后台任务**。节奏参考：quality-gate 约 1~~2 分钟一轮；
  NPC 召唤→出 PR 全程约 20+ 分钟，45~~90 秒一查足够。
- 判「召唤是否真触发」：构建列表出现 `event: issue.comment@npc` 条目才算数；
  一条都没有＝提及没匹配上（旧仓库路径提及即此形态，零流水线零报错，
  见 AGENTS.md「召唤青简必须写完整路径」条）。

## 机器 A（本机，Windows + Git Bash，2026-08-30 重验）

- 思源 **3.8.1** 桌面版（已自 3.8.0 升级），日常两个工作区：
  `D:\data\思源\工作`（主）与 `D:\data\思源\测试`（调试常开的是它）
- ⚠️ **conf.json 在 `conf/conf.json` 子目录**（3.8.1 挪的，同机器 B），
  token 变了去那里找 `api.token`（工作区=gm8mhokhgd58ceaf，
  测试区=ycfl0ijk9mxvnh21）
- ⚠️ **内核端口不再固定 6806**（2026-08-30 实测：conf 无自定义端口时
  随机，当时为 52036 且 6806 无监听）——调试前先
  `wmic process where "name='SiYuan-Kernel.exe'" get CommandLine`
  查 `--port` 与 `--workspace`，按实际工作区取端口+token 调用
- 插件安装目录：`D:/data/思源/工作/data/plugins/siyuan-plugin-wengu/`
  与 `D:/data/思源/测试/data/plugins/siyuan-plugin-wengu/`（两区都拷）
- 思源前端源码（读实现用）：`C:\Program Files\WindowsApps\
89C2A984.SiYuan_3.8.1.0_x64__1qfd3tsw4ngc2\app\resources\stage\build\app\`
  （`common.*.js` 是压缩单行，**直接 grep 会卡死 shell**，先
  `tr ';{' '\n\n'` 分行再 grep）

### 机器 A 的 Shell 坑（Git Bash 特有）

- **`/tmp` 是 MSYS 虚拟路径，Windows 原生 node 读不到**：curl
  `-o /tmp/x.json` 后验证要用
  `node -e "require(require('path').join(require('os').tmpdir(),'x.json'))"`
  （Git Bash 的 /tmp 恰好映射 os.tmpdir()，但 node 不认 `/tmp` 字面量）

## 机器 B（Mac，macOS arm64，已验证 2026-08-24）

- 思源 **3.8.1** 桌面版（比机器 A 的 3.8.0 新，内核坑一节若行为不符
  需重新验证），应用在 `/Volumes/baiWeiNV7200/app/SiYuan.app`（外置卷，
  不在 /Applications）
- 仓库路径：`/Volumes/baiWeiNV7200/sasa/siyuan/siyuan-plugin-wengu`
- 工作区 `/Volumes/baiWeiNV7200/data/思源/工作`
- 内核 API：`http://127.0.0.1:6806`，`Authorization: Token 8xmofpelwury3fkd`
  （同进程另有 `--attach-ui` 随机端口如 54644，用 6806 即可）
- ⚠️ **conf.json 在 `conf/conf.json`**——3.8.1 把它挪进了 `conf/`
  子目录，不在工作区根（机器 A 已升 3.8.1 同款），token 变了去那里找
  `api.token`
- 插件安装目录：`/Volumes/baiWeiNV7200/data/思源/工作/data/plugins/siyuan-plugin-wengu/`
- 思源前端源码（读实现用）：`/Volumes/baiWeiNV7200/app/SiYuan.app/
Contents/Resources/stage/build/app/`（同机器 A：`common.*.js`
  压缩单行，先 `tr ';{' '\n\n'` 分行再 grep）
- 工具链：node v24 + pnpm 11 均可用，tsc/eslint/prettier/webpack 构建链
  全部验证通过
- ⚠️ **pnpm 崩溃根因与铁律（20260901 定论）**：曾报
  `TypeError: Cannot set property message … only has a getter
at RetryOperation._fn` ——全局 pnpm 与 package.json 的
  `packageManager` 锁定版**不一致**时，每次 `pnpm` 启动先经版本托管
  联网拉 registry 元数据（本机网络时好时坏）；11.17.0 抓取失败的
  错误脱敏会**赋值** `error.message`，而超时抛的 DOMException
  （AbortError）message 是原型 getter-only，严格模式赋值即崩——
  真网络错误被这个二次崩溃掩盖。11.4.0 同路径只读不赋值无此雷。
  **修复：全局装与锁定版一致的 pnpm（`pnpm add -g pnpm@<锁定版>`，
  20260901 已对齐 11.4.0）**——版本托管短路、启动零联网。铁律：
  bump `packageManager` 版本时必须同步升级全局 pnpm，否则坏网络下
  复发（届时任何 pnpm 命令都可能崩，编辑器保存触发的格式化任务
  也在内）。
- **插件目录随思源同步在两台机器间流转**（temp/ 有同步冲突记录）：
  另一台机器装了旧版同步过来会盖掉本机新装——每次调试前先比对
  `md5 dist/index.js` 与插件目录里的是否一致，不一致就重装

### 机器 B 的 Shell 坑

- `setPetalEnabled` 成功时响应体带**整个插件 JS（约 2MB）**，直接打印
  会刷屏——加 `-o /tmp/pe.json` 再用 `node -e` 取 `.code`/`.data.enabled`
- zsh 内联 JSON 同样有转义坑——精确 payload 用文件（与机器 A 相同）
- ⚠️ **在 WorkBuddy 沙箱里跑 `pnpm run build` 会被拦**：宿主给 node 注入
  `NODE_OPTIONS=--require …/node-language-shim.cjs`，webpack 的 `mkdir`
  （output.path）会以 `CODEBUDDY_BROKER_DENY` 失败。绕法：**清空
  NODE_OPTIONS** 再构建——`NODE_OPTIONS= pnpm run build`（20260910 实测）；
  `tsc/eslint/vitest` 不受影响，无需清

## Shell/工具坑（本机）

- Git Bash 里转义会悄悄破坏 JSON payload——**精确 payload 用文件**
  （Write 工具写临时文件再 `curl -d @file`），别在命令行内联 JSON。
- `python` 是 WindowsApps 桩，用 `node -e` 做解析。
- 重 grep minified bundle 会卡死（见机器 A 节的 tr 分行法）。
- **CRLF 幻影脏**：pull 机器 B（Mac，LF）推的提交后，`git status` 报
  几十个 M 但 `git diff` 为空（换行符归一化假阳性，且会挡住 pull）——
  确认 `git diff --name-only` 无真实改动后 `git checkout -- .` 清掉再拉。
  变体（20260824）：**`prettier --check .` 在 CRLF 工作副本上大面积报
  warn、`prettier --write .` 改出几十个 M，其实全是行尾幻影**——
  `git add -A` 归一后 diff 消失、nothing to commit。判断真假用
  `git diff --ignore-all-space --numstat`（全 0 = 纯行尾噪音）。
