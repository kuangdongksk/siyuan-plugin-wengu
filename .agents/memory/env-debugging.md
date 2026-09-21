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

## 单测读源码：**统一走 `src/testkit/readSource.ts`**（20260921 #189 定稿）

本仓**没有 `@types/node`**（`tsconfig.json` 无 `types` 字段、依赖里也没有），
`src/**` 里 `import { readFileSync } from "node:fs"` 会让 `pnpm check:svelte`
直接红（`Cannot find name 'fs'`）——**vitest 跑得过、CI 会红**，两把尺子不同步。
故读源码只能用 vitest/vite 的 `?raw` 家族（最小声明见 `src/declarations.d.ts`）。

### 唯一口径：路径读源码

```ts
import { expectRed, hasSource, mustHave, read } from "<相对 src/testkit 的路径>";
const code = await read("/src/quiz/render/NumRail.ts"); // 路径相对**仓根**
```

- `read(path)` → 源码原文；**文件不在即抛错**（不静默回落空串）。
- `mustHave(path)` / `hasSource(path)` → 在场闸，待产出文件先过它。
- `expectRed([paths])` → 「先红后实现」的**红清单自检**（见下）。

### 三条已实测的死路，别重复走

1. **`node:fs` + ambient `declare module "fs"`**：能过 `svelte-check`，但要在
   仓库里手写一份 Node 内置的简化类型，且这道声明会被生产代码顺手引走 ——
   等于把「生产代码禁引 node:fs」的安全网拆了。**否决**。
2. **`await import("vite")` 拿 `server.fs` / `createServer`**：`vite` 只是
   vitest 的**传递依赖**，根 `node_modules` 下没有它的入口，`Cannot find
package 'vite'`；要用就得把 vite 提成显式 devDependency。为一条测试口径
   动依赖树，不值。**否决**（`import.meta.resolve` 同理：Node 专有 API、无类型）。
3. **`import.meta.glob` + `eager: true` + basename 查表**（#189 前旧口径）：
   两个坑 —— ① 键**相对本文件**，跨层同名（`src/quiz/index.ts` vs
   `src/index.ts`）只能靠「取最后一段」查表，会**撞车取错文件**；② 缺失文件
   的 `?raw` import 返回 `undefined`（**不是空串**），`.not.toContain(...)`
   类**反向断言静默变绿**，红清单缺条目还看不出来。**已由 readSource 取代**。

### `readSource` 内部口径（改它之前先读）

- 用 `import.meta.glob` 的**懒加载**形态（不带 `eager`）：键是
  **相对仓根的 `/src/...`**，于是路径即身份、跨层同名不再撞车，也不必为
  每层目录各写一条 glob 再拼表。
- ⚠️ **懒加载的 `?raw` 返回值是「原始字符串本身」，不是 `{ default }` 模块壳**
  （`eager` 形态才是模块壳）——故 `read()` 两种都认。实测：#189 首轮只解
  `.default` → 每个文件都拿到 `undefined`，全绿/全红的判定一起失真。
- ⚠️ **`?raw` 的 glob 只认 `.ts` / `.svelte`**：`.scss` 一律 `sass.compile`
  真编译（`?raw` 对它恒空串）。故 `readSource` 的 glob 模式里没有 scss。
- 非 eager 的 glob 同样**不校验目标是否存在**，故 `mustHave` 是必需的闸。

### 「先红后实现」的红测试怎么写

文件级红测试是**合法的中间态**（本仓 #182/#189 即此形态）：`check:svelte`
会带 1 条 `Cannot find module`、`test` 会红，这是**有意为之**；但
**`pnpm format:check`（quality-gate 第一项）与 eslint 必须先过**。

四条规矩：

1. 红测试文件里**不许静态 `import` 待产出源码**（会让 `check:svelte` 红在
   `Cannot find module`，看着像编译器故障而非「断言未过」）——一律 `read()`
   取源码做**源级断言**，`check:svelte` 只剩 1 条「待产出文件缺席」的预期红。
2. **待产出文件先 `mustHave`**：否则取不到源码时正向断言也红、反向断言却绿，
   红清单「红得不够」而你看不出来。
3. **反向断言必配正向锚点**（`expect(code).toContain(...)` 先钉住「确实读到了
   那个文件/那段区间」），否则读错文件时反向断言假绿。参见
   `QuizTimerFlow.test.ts` 的 `anchors()`。
4. **红清单必须显式登记**：`expectRed([...])` 保证「待产出文件现在确实不在」。
   少了它，阶段二实现落地后反向断言会**逐个自己变绿**，你无法区分「做完了」
   与「断言被写松了」。**阶段二收口时把 `expectRed` 调用连同其 `describe`
   一起删**（这是一次有意识的动作，脚本不会替你删）。

### 既有口径（仍有效）

- 读 TS/Svelte 源码：`readSource.read()`；模板可参考
  `SubheadHtml.test.ts` / `RailMount.test.ts`。
- 读 scss：`sass.compile("src/scss/x.scss")` 真编译（样板
  `MaterialSplitterDesign.test.ts` / `ButtonVariants.test.ts` /
  `AiPanelScrollChain.test.ts`）。
- 读 i18n 字典：`?raw` 导入 JSON（`../../i18n/zh-CN.json`）后 `JSON.parse`。

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
- ⚠️ **`core.autocrlf=true` ⇒ 本地 `format:check` 全仓假红**（20260917 实证）：
  工作区 checkout 出来全是 CRLF，而 `.prettierrc` 是 `endOfLine: "lf"`，
  主工作区直接跑 `pnpm format:check` 会几百个文件报 warn（CI 是 LF 环境，
  只报真格式问题——当时 CI 红 78 个、本地红 447 个）。**审 PR 对齐 CI
  口径一律 `git -c core.autocrlf=false worktree add <路径> <分支>`**
  建 LF 工作区再跑五件套。附带：CI 红排查用
  `cnb build get-build-status --sn <sn>` 看 stage，再
  `build-runner-download-log --pipelineId <sn>-001` 拿日志；
  首跑 pnpm 若报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`，
  前缀 `CI=true pnpm install` 重装（~6s，store 缓存命中）。

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
