# 20260920 交接：单题计时切换三线派单 + 设计稿出稿（未完成，新会话按此续作）

> 本文档是会话交接自包含件：决策已由用户（飒飒）拍板，代码事实已核实到行号，
> 按本文执行即可，无需重derive。远端注意：**本机 `cnb`=CNB、`origin`=GitHub 存档**
> （与 AGENTS.md 93001b7 的口径相反，那是另一台机器；见记忆 remote-naming-per-machine）。

## 〇、用户拍板的最终方案（不许再改方向）

1. **单题计时器切换方案＝点击即切 + 非焦点题降亮度**：点任意卡＝计时切到该卡
   （切换时刻＝该题计时起点）；滚动/悬停**都不切**；作答必须点击（点选项本身就是
   切换动作），机制上保证「作答必先计时」。视觉只有一条：非焦点卡降亮度、焦点卡
   正常亮度。悬停 3 秒方案已被用户否决删除，其他视觉设计全砍。
2. **提交即结算、结算后冻结**：sec＝提交时刻−本题计时起点，向上取整（<1s 记 1s）；
   已作答记录必有 sec；改答只改对错、不动用时；brief 题在 await AI 判分**之前**结算。
3. 三线并行：线 A/B＝给在办 PR 补独立验收测试（只写测试）；线 C＝计时重做
   （先红测试后实现）。线 C 的 Issue 必须附设计稿路径 → **先出稿、用户过目拍板后才派线 C**。
4. 全程不合并任何 PR；全绿后复核 NPC（glm-5.3-flash）终审，用户拍板合并。
5. mock 库不引入（vitest 内置 vi.mock/vi.fn，仓内 151 处先例；DOM 断言走 ？raw 源级
   + sass.compile 既有范式）。

## 一、已完成（勿重做）

- **design/ 目录迁移**（CNB dev `05613d2`）：9 个平铺稿 git mv 进
  `design/UI/{刷题,转换,AI面板,背单词}/`，`theme-tokens-neo.md` 留 design/ 根；
  .gitignore/.zcodeignore 豁免改递归（`design/**/*.od-skills/`、`design/**/*.artifact.json`）；
  .agents/memory 内旧路径已全部更正；上一会话 8 个未跟踪记忆文件补录（f977c14）。
- ⚠️ github 存档远端推的是 rebase 前同内容提交（d9336e1），与 CNB 历史分叉——存档仓
  允许分叉，**别随意强推对齐**。
- **CNB dev 现状**：`5b81c8f`（并行会话已合 #171/#172/#174）+ `05613d2`。
  开放 PR：#178（`fix/shuffle-remap-solution` @ 2e82e2b，Ref #176）、#179
  （`fix/report-markdown-knowledge` @ c2ab78b，Ref #177）。开放 Issue：#175（无人认领）、
  #176、#177。
- **OD daemon 已无头启动成功**（本会话实测，见 §四）。

## 二、待办 1：OpenDesign 出「单题计时切换」UI 稿（先做）

1. 写任务书 `design/UI/单题计时/README.md`（该目录新建；内容见下方「任务书内容」）。
2. OD 调用（两条路，REST 已验证通、MCP 探针有 bug 待修）：
   - **REST 路（推荐，已验证）**：daemon 启动见 §四。然后
     `POST /api/import/folder` JSON `{baseDir:"<仓库绝对路径>/design/UI/单题计时", name:"wengu-focus-timer"}`
     → `POST /api/runs`（body 字段用 `GET /api/runs?projectId=…` 对照或从
     server chunk 的 registerRunCreateRoute 看；字段含 projectId/prompt）
     → 轮询 `GET /api/runs/:id`（30-60s）→ `GET /api/projects/:id/files/:name` 取产物。
     本会话已从 daemon-cli 的 server chunk 确认路由表存在（/api/import/folder、/api/runs、
     /api/runs/:id、/api/projects/:id/files/:name、/api/runs/:id/cancel）。
   - **MCP 探针路**：`/tmp/od-mcp.mjs` 已重建但仍有坑——spawn 的 Electron Helper 把
     带空格的 daemon-cli 路径按空格截断（报 `Cannot find module '/Users/sasa/Library/Application'`）
     → initialize 超时。修法候选：sh -c 显式加引号包 command 与 args[0]，或先把
     daemon-cli.mjs 复制到无空格路径（注意 __dirname 资源解析可能断）。修好后
     `node /tmp/od-mcp.mjs list` 看工具，`call import_folder …`、`call start_run …`。
3. **纪律**（记忆 wengu-opendesign-mcp 有全量）：单 run 不并行；prompt 喂本机绝对路径
   不传大文件；按 `design/theme-tokens-neo.md` 落色（常驻深色暖调）；产物入仓前必
   `prettier --write`，正文/注释禁未闭合的字面量 `<style>` 标签（prettier HTML 解析会炸，
   报错在文件尾）；轮询时 status=running 且文件 mtime 不变≠挂了，禁止 cancel；
   同文件夹既有文件对 run 只读（prompt 写明禁改 README）。
4. 产物建议名 `wengu-focus-timer-redesign.html`（单文件自包含高保真 HTML）。
   **出稿后贴给用户过目拍板**，不满意改 prompt 重跑；拍板后才进入待办 4。

### 任务书内容（写进 README.md）

- 主题：单题计时切换（focus-timer）。
- 交互链：多题长卷（现状形态勿改）→ 非焦点卡降亮度（可见但明显退后，如
  opacity≈0.45 或亮度压暗）→ 点击任意非焦点卡立即切焦点（亮度过渡 ≤150ms）→
  点选项作答本身即点击切换 → 提交判分后该题用时冻结，卡上有「本题用时 m:ss」注记。
- 屏清单：①全景（焦点在第 3 题左右，含一张材料组卡）②切换瞬间前后对照
  ③焦点卡作答态（选中 chip→提交揭示+用时注记）④头部计时标签+题号栏焦点题指示。
- 参照（prompt 给绝对路径）：`design/theme-tokens-neo.md`（落色）、
  `design/UI/刷题/wengu-sidebar-redesign.html`（题卡结构现状）。

## 三、待办 2：create-ccw 生成「OD 出稿」可复用工作流

- 用 Skill `claude-code-workflow:create-ccw`；`.ccw/workflows/` 本仓库还没有，从零建。
- 工作流参数：主题名、baseDir（默认 design/UI/<主题>/）、参照稿路径。
- 节点草案：目录规范校验（design/UI/<主题>/ 存在）→ 写/复核 README 任务书 →
  OD import folder + start_run → 轮询 get_run（45s 间隔）→ 取产物 + prettier --write →
  渲染自查（Chrome 无头截图，`--headless=new --window-size=W,H`，H 取真实 scrollHeight）。
- 目标：之后每次出 UI 一条工作流跑完。

## 四、OD daemon 启动（本机 macOS，已验证）

```bash
open -g -j "/Volumes/baiWeiNV7200/Applications/Open Design.app" --args --headless
```

- app 不在 /Applications，在本外置卷；数据目录
  `~/Library/Application Support/Open Design/namespaces/release-stable/data`。
- sidecar socket：`/var/folders/bk/2q8v1brx7mjf7qkhphjw_gzm0000gn/T/od-sidecar-501/*.sock`
  （daemon 重启会整批换新；MCP config 的 OD_SIDECAR_CLIENT_ENDPOINT 会过期）。
- 若 REST 需要直启 daemon-cli（绑 7456）：
  Helper 二进制 + `…/Resources/app/prebundled/daemon/daemon-cli.mjs --host 127.0.0.1 --port 7456 --no-open`，
  env：`ELECTRON_RUN_AS_NODE=1 OD_DATA_DIR=<上述 data 目录> OD_SIDECAR_CLIENT_ENDPOINT=<活 socket>`。
  MCP 配置在 `~/.zcode/cli/config.json` 的 `mcp.servers["open-design"]`。

## 五、待办 3/4：线 A、线 B 派单（可立即派，与出稿并行）

派发口径：`cnb issues post-issue-comment --repo bianchao777/sasa/siyuan-plugin-wengu
--number <PR号> --body-file <文件> --work-mode`；提及**顶格**
`@bianchao777/sasa/siyuan-plugin-wengu(青简)`；发后
`cnb build get-build-logs --repo …` 确认 `pull_request.comment@npc` 触发。
派发前查并行（open+closed PR、dev log、issue 最新评论）。NPC 铁律写「从 origin/dev
拉分支」——**本单明确例外：基线＝对应 PR 分支**（`git fetch cnb fix/...` 后在其上
加 commit，PR base 仍是 dev）。

### 线 A（评论到 PR #178）：洗牌解析错位独立验收测试

只写测试不改业务代码；基线＝`fix/shuffle-remap-solution`。测试放**新文件**
（≤500 行红线，别挤 ShuffleRemap.test.ts 的 367 行）。要求 NPC 先跑红、
红清单逐条「期望/实际/归因（测试错/代码错）」评论到 PR，实现错的修复等归因评审另派。

- 核心不变量：种子化随机 N≥200 组排列下，**解析中每个引用前缀字母与独立字母词符
  所指的选项文本，洗牌前后一致**（与 answer 重映射同源）；恒等排列时解析逐字节不变。
- 对抗矩阵：同一字母既在 `「A …」` 引用前缀又独立出现（单遍一致映射，无二次映射
  A→C→B——实现注释明确先 remapQuotedHead 再 rewriteLetters）；超范围字母（3 选项组
  解析写 E）原样；所有格 `A's`、英文语境 `plan A failed`、`维生素A`、`A4纸` 不改写；
  数学/代码保护区字母不动；stemMd 不改写；steps/cloze/match 不洗不改；WenguStep 无解析。
- 落库三链（SetWriter/GenQuestion/RegenDialog）`normalizeDraftOptionRefs`：幂等
  （跑两遍=一遍）；`A. 全文`→`「文本」` 无叠影；无凭据字母原样；次序 unpack→replace→normalize
  （Regen 链 reseat 后 render 前）。
- 移动端同源：MobileRound 三处洗牌走同一 shuffle 入口从而继承 remap（源级断言）。
- 既有回归锁（OptionRefReplace.test.ts 新口径三断言）与 CardDisplayShuffle.test.ts 全绿。

### 线 B（评论到 PR #179）：AI 报告下游独立验收测试

同模式；基线＝`fix/report-markdown-knowledge`；PR 自带 3 个测试文件（judge.test.ts/
agentPanel.test.ts/aiMdStyle.test.ts），独立测试放新文件补盲区：

- NaN 全传播矩阵：混合 session（缺 sec 键/sec=0/sec>0/多步 #k 部分缺）→
  byBaseQid 输出无 NaN；buildAnalysisPrompt 全文无 "NaN" 字样、缺用时行写
  TIME_UNKNOWN_TEXT；TimeBars 柱高有限值；timeStateOf 三态。
- 注入对抗：`<img src=x onerror=…>`、`<script>` 经 renderAiTextHtml 必须转义；
  `$…$` 公式占位保留；三处 innerHTML 写入都过 renderAiTextHtml（源级断言，无裸 textContent）。
- prompt 五段结构正则断言；知识点归组只用输入给的组名（反编造指令在场）。
- 既有 MdRender 33 断言、RoundReport.view.test 不回退。

## 六、待办 5：线 C 派单（设计稿拍板后才派；新 Issue + dev 拉新分支 fix/timing-capture）

先红测试钉行为再实现（允许改业务代码）。规格：

- R1 点击即切：点任意卡＝计时切到该卡（切换时刻＝该题计时起点）；滚动/悬停不切；
  作答必点击。
- R2 非焦点题降亮度、焦点正常（按设计稿；样式进组件 `<style>` 或登记共享片）。
- R3 提交即结算：sec＝提交时刻−本题计时起点，向上取整（<1s 记 1s）；已答必有 sec。
- R4 结算后冻结：改答只改对错不动 sec；brief 在 await AI 前结算（AI 等待不计入）。
- R5 后台/隐藏不计（保留现设计），恢复可见后锚点重置。
- R6 恢复轮从落点题起算，不误记第 1 题、不虚胖覆写。
- R7 同一秒连答两步/两空各记 1 秒。
- R8 移动端当前显示题即计时题（替换硬编码 0）。
- 兼容：sec 仍可选字段（存量无键不迁移）；整轮用时/15s flush 不动；与 #179 三态不冲突。

**代码事实锚点**（已核实到行号，实现/测试直接对）：

- 计时：TimerBinder 1s interval 四道闸（started/mode、document.hidden、
  el.getClientRects 为空）→ TimerController.tick 给 activeQid+1（TimerController.ts:79-96）；
  activeQid 唯一写口 setQuestion（:74-76）← QuizView.onActiveQ（src/quiz/index.ts:249-253）
  ← NumRail 滚动顶端规则（NumRail.ts:266-300）/题号点击（:216-227）/bindNumRail
  setActive(1)（:301）/组内导航 GroupUnitApp.svelte:180-190、挂载首帧 :262。
- 取时：takeQuestionSec（TimerController.ts:127-134）整题只读不清零、#k 增量游标
  stepTaken；restoreQuestionSec 只收 >0（:69-71）。
- 提交链：AnswerFlow.submitQuestion（AnswerFlow.ts:104-145）→ flushTime(:116) →
  gradeQuestion(:133) → recordAnswer(:134)；brief 在 judgeBriefAnswer 的 await
  judgeBrief 之后才 recordAnswer（:196→199）——R4 要改到这里。
- 记账：recordAnswerFor（AnswerMirror.ts:95-114，takeSec 在 :105）→ pushSessionAnswer
  （HistoryStore.ts:214-248；`if (sec>0)` 两处闸 :228/:239；upsert 覆写语义）。
- 恢复：StartPanel.ts:155-158 继续轮回填；恢复后整壳重建 → bindNumRail setActive(1)
  误记第 1 题（NumRail.ts:301）。
- 移动端：MobileAnswering.ts:347 硬编码 sec=0（另有 :248/:285/:309 各作答入口）；
  MobileDrill.startTicker 只有整轮墙钟（MobileDrill.ts:405-416）；移动无 steps/slots
  逐步作答。

## 七、收尾杂项

1. **chore 单（云端，可随时派）**：src 注释与 docs 的旧设计稿路径更正——
   `docs/design-spec.md:173,736,891`、`docs/design-review.md:46`、src 下 20 处注释
   （grep `design/wengu-\|design/sidebar-gap-list\|design/convert-stop\|design/aipanel-gap-list`
   即得全表）；CHANGELOG 历史条目不改。
2. 合并后收口闭环：关关联 Issue（带 merge sha 收口评论）+ 删远端功能分支。
3. 本会话遗留坑（已入记忆或见上）：本机远端命名与 AGENTS.md 相反（cnb=CNB）；
   zsh `echo ===` 报错用 `echo ---`；zsh 不分词 `$VAR`，批量 sed 用 for 循环。
