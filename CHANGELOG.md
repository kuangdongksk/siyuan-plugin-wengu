# Changelog

## v0.1.1 unreleased

- 判分反馈用色规范化（20260828 用户提出，设计评审 §〇 新增第 10 条）：
  词域对错反馈行从「灰字+彩色小图标」改为文本/底色成对的思源语义
  色——答对 success、答错（含看答案按错计）error，12% color-mix 底
  与 base.wengu-status-ok/err 同公式；回想引导语等非判分行保持中性。
  浏览器实测 is-ok 行 color=oklch 绿 + 12% 底生效
- 词尾四点梯进度（仿不背单词，20260827 用户需求）：新词四步梯进行中
  在词尾渲染 4 个小圆点——已完成步 primary-lighter 实心、当前步
  主色放大、未到步 border-color 灰点；listen 步词面隐藏时随题面隐去；
  复习词/已出师词不显示。WordView.ladderOf 只读访问器 + QuizCard 三
  处挂点（英选中·回想大词尾/中选英释义行尾/详情词条行）

- 详情视图定稿（20260828）：词条释义紧跟头部自然下排，删除上一轮的
  垂直居中——居中会在单词与头部间留大块空白（用户反馈「单词和顶部
  有一块空白」）；剩余空间聚在 sticky 按钮行上方，横向溢出复测为零

- 客观题作答后直接切详情视图（20260827 用户反馈）：选择/听音/拼写
  答完后题面大字与禁用选项组不再滞留——只留反馈行（答对/答错/看了
  答案）+ 错选提示 + 词条详情（含朗读）+「下一个/记错了」，与回想
  翻面结果视图同构；正确答案本身就在详情里，选项高亮不再重复展示。
  详情态内容不满屏时信息块垂直居中（上下 auto margin 平分空隙），
  按钮仍贴底——不再中段一大块空白
- 新词四步梯接线（20260827 用户定稿）：口述版梯序 英选中→中选英→
  听音选义→英文回想（参考流草案作废，readalong 挂账未接线）+ §六
  决策 2「仅认识前进」——模糊/忘记/答错/看答案原步不动，靠流水线
  后位自然隔卡重现。新学建队改 pipelineLadder 四词错峰流水线（组宽
  ≤4 轮转出镜，相邻四张=四个不同词各占一梯；词少自动缩组），AI 组
  边界重排按剩余梯步折算出镜次数（rebuildTail 增 remainOf 入参）。
  配套：listen 题面大喇叭进卡自动播+空格重听、单词隐藏；选择/听音
  「看答案」小字钮（peek 按答错计）；详情区翻面后小喇叭朗读；
  speechSynthesis 发音小模块 WordSpeak（en-US·0.9x，离线系统 TTS，
  redesign §一落点）+ 自绘 iconVolume 符号；i18n 六键 zh/en；新增
  WordLadder.test 锁梯序与流水线轮转性质
- 查词结果行去原生按钮壳：列表行对齐思源文档树 ghost 风（无边框
  无灰底、悬停浅底、词左粗体释义右省略），结果列不再限宽 420
- 修查词列表横向滚动条+排版散架：结果行的「单词左/释义右省略」flex
  规则挂在旧渲染器的 `.wengu-word-opt[data-act="lookuppick"]` 上，
  Svelte 迁移后按钮无 data-act 整条失效——按钮退化 block、inline span
  上的 nowrap+ellipsis 双双无效，长释义把卡片内容撑到 ~800px 顶出横向
  滚动条（浏览器实测 scrollWidth 814/356）。行改挂专用类 wengu-word-lk，
  meaning 补 min-width:0 让省略号真正生效；布局复测 sw=cw、截图确认
- 刷卡右上角工具组常驻「回首页」按钮（列表图标，同头部入口）：中途
  退出不再依赖标题行小图标；goHome 语义不变（重进按到期/新学重构队）
- 回想三档按钮全阶段统一为 认识/模糊/忘记：空翻兜底结果页原本写反成
  忘记/模糊/认识（正面直选档是 认识(3)/模糊(2)/不认识(1)），两态按钮
  位置互换易误触——统一左起 认识(1)/模糊(2)/不认识(3)，键盘 1-3 映射
  与 i18n 快捷键编号（zh/en）同步重排
- 修回想卡「直接显示答案」：鼠标点「下一个」/档位按钮收尾后，同一次
  点击冒泡到卡根的翻面 onclick，把刚换上的新卡当场翻面（enterPrompt
  同步写 phase=prompt，冒泡晚于状态更新）——卡根翻面改为忽略来自
  button/input 的点击，键盘路径不受影响
- 测试兜底接入：vitest（node 环境，`siyuan` 别名到 tests/siyuan-stub，
  内核 IO 不进单测）+ GitHub Actions CI（tsc/eslint/prettier/test/build
  与 AGENTS.md 调试链同序）；首批 7 个测试文件 67 例锁纯逻辑回归面
  ——判分矩阵、选项洗牌不变量、分批切块确定性、AI 回复规整
  （extractBatchQuestions）、题库/文档双路 kramdown 装配、契约归一化
- 修小数选项误判（测试首跑挖出）：optionDisplayMd 的有序列表标记
  剥除改为「标记后须有空白」（与 splitOptionMd 同约定）——旧正则会把
  「0.5」「1.5」的 `1.` 当列表标记吃掉，数学题内容比对必错判
- 内核调用全量收拢进 src/siyuan 工厂（新增 KernelQuery，EApi 补
  agent/chat·chatGPT·forwardProxy；13 文件 33 处散落直调清零）；
  修 getBlockKramdown 把 `{id,kramdown}` 对象当串返回的 bug
  （真机探针实锤，题库 refreshDoc 静默失败根因）；ConvertBatch
  496→440 行；生成核/Flow DOM 件/hydrate 样板三处复制粘贴收敛
  （GenCore/FlowDom/fetchChildParts）
- 背单词 UI 层 Svelte 化：word 域渲染从 innerHTML 全量 paint 换成
  Svelte 5 组件（`word/comp/`，WordApp 根组件 + 各屏幕/卡片组件），
  控制器拆 `WordView.ts`（会话状态机与语义动作）、响应态形状
  `WordUi.ts`（$state 深代理，组件细粒度更新）；旧字符串渲染层
  （WordHome/WordStats/WordActs 与各 renderXxx）删除，WordBind 只留
  键盘分发；样式类名不变（仍走全局 scss）。构建链接入
  svelte-loader（Svelte 5 编译器原生支持组件内 TS，无需预处理），
  prettier 加 prettier-plugin-svelte、eslint ignore `*.svelte`；
  插件 Dock destroy 补卸载（旧版空置会泄漏监听）
- 图标定稿：手绘 SVG 换成思源官方图标集原始 path（温故=iconRiffCard
  卡牌堆、背单词=iconLanguage 地球），仍以自有稳定 id 经 addIcons 注册
  ——直接引用内置 sprite id 会被 uiLayout 持久化的旧 dock 图标引用
  打穿渲染空白（iconLanguage 也非核心图标，部分环境 sprite 未收录）
- UI 标准落地（design-review §〇 新增 6/7/8 条）：弹窗底部操作行按钮
  统一 8px 间距（原生 b3-dialog__action 无间距规则，多按钮贴死）；模型
  选择从原生 select（几百项不可搜）改为模仿官方 commonMenu 的带搜索
  浮层（`src/ui/ModelPicker.ts`，b3-menu__filter + b3-list，转换弹窗与
  设置页共用）
- 文档选择器（源文档/父文档/知识点「选择…」）从大 Dialog 改为官方
  风格可搜索下拉浮层（b3-menu__filter + b3-list，同 ModelPicker 交互）：
  单选点击即回填，多选行内勾选+底部「清空/确定」，Esc/点外部取消
- 「更多选项」折叠行：内置 iconRight 箭头随开合旋转、隐藏原生三角
  marker、悬停变色、间距入 8px 体系
- 删除页签头部「做题 | 复习」切换器（样式不达标且头部信息行拥挤；
  开刷面板三按钮「预览 | 开始刷题 | 错题回顾」为统一模式入口，另保留
  侧栏文档右键「错题复习」）；switchMode/会话恢复机制保留，契约见
  docs/review-mode.md §二 D1 v3
- 源码按功能分域重构（组织方式借鉴 sy-lively）：`src/siyuan`（内核 API
  工厂：EApi 路径枚举 + KernelBlock/KernelDoc/KernelNotebook，迁自
  sy-lively 构建工厂）+ quiz/convert/review/word/stats/bank/ui 六域，
  各域 `index.ts` 为入口编排（禁纯 re-export barrel），词库数据入
  `word/data/`
- 转换落盘改走 appendBlock 增量追加（sy-lively 同款通道，20260826
  八轮真机探针定论）：首批 createDocWithMd 建文档（IAL 整体解析），
  之后每题一次尾插——不再每批删旧重建，块 id 稳定、回收站无每批
  尸体；继续生成直接在旧渐进文档上续写
- 转换流程页面化：弹窗只收参数，点「开始转换」即关窗——批次循环交
  ConvertRun 单例运行器，温故页签内转换条展示进度并支持停止/保留
  进度/全部丢弃；原位替换也每批渐进落盘（原文档旁临时《·习题》，
  页签像做题一样逐批出题，终态替换原文档后删临时文档，转换期间
  原文档不动）；源文档/父文档/知识点改为选择器（可搜索）+ hint 槽
  回显路径，原位模式收起「生成位置」两行
- 错题复习模式（错题本）：入口=开刷面板「错题回顾」按钮 + 侧栏文档
  右键（原页签头部「做题|复习」切换器已删，2026-08-26 入口统一
  开刷面板三按钮）；全局错题清单（SQL 直查块属性）+ 单题回看（历次
  作答时间线 / AI 评语 / 错因 / 跳源块 / 复制题目）；组头「重刷本文档」
  以 scope=wrongAll 直落开轮；会话落 scope 字段（继续上次按范围恢复）；
  统计总览加错题概况 / 薄弱 Top8 / 错因分布三块（详见
  docs/review-mode.md）
- 插件题库/专题/知识点反链体系补记：bank 主记录 + 按知识点收集专题 +
  悬空对账 + 题卡重生成 + 右键「查相关题目」+ 薄弱针对性加练（详见
  docs/question-block-contract.md）
- 专题会话独立归档（`col:<id>`）：专题作答不再误记到无关文档的轮次
  统计里；专题轮次可读——「继续上次 / 只刷错题」在专题模式生效；
  重开页签恢复上次专题（prefs.colId）
- 专题模式材料并集装载：按题目来源文档合并材料、解析 group 占位，
  材料组在专题里分栏渲染（静态 Lute + KaTeX）
- 专题可编辑：管理对话框展开专题逐题移除、删除两击确认、创建后直接
  切换过去开刷
- 「收集并补题」：按勾选知识点收集已有题后，AI 生成（错题变式/概念
  辨析，逐题自检）按缺口补入专题（≤10 题/次；非反链键自动降级变式）
- 薄弱加练专题名走 i18n；知识点引用解析器合一（BankParse.parseKpRefs）
- 修复：AI 生成的选择题正确答案恒为 A——prompt 让模型先写正确项再补
  干扰项，输出天然正确项居首；转换/生成规整链尾部统一做选项均衡洗牌
  并同步改写答案字母（single/multiple/steps；「以上都对」类位置敏感
  措辞跳过，OptionShuffle）
- 新增「结束本次做题」：做题中头部一键提前收卷，报告/批改只含已答
  部分；薄弱画像按结果水位增量（同轮多次收卷不重不漏）；下次
  「继续上次」接着做（大卷 100~200 题分次刷的场景）
- 修复：批次超时等失败收口不清运行器单例——一次超时后「继续转换」
  永久被拒、弹窗误报「已有转换在进行中」（ConvertRun failed/catch
  路径 active 复位；待抉择期间也拒绝开新转换）
- 转换超时改判据：串行通道（agent/chat SSE）按**空闲**计——每收到
  一段流数据即续期，慢模型长批次只要在出字就不掐；并发直答通道
  （chatGPT 非流式）总时长放宽到 10 分钟（原 5 分钟总时长误杀）
- 新增转换管理面板（ConvertPanel）：转换弹窗被拒不再一句报错——
  直接转进面板单独管理；面板两区：进行中（进度/终止/终止后保留-
  丢弃抉择，订阅运行器实时刷新）+ 未完成进度记录（prefs 持久，逐条
  「继续生成」回弹窗预填源文档 /「丢弃进度」清记录并删保留的渐进
  文档）；弹窗打开时若有转换在跑，底部露出「查看进行中的转换」
- 新增预览模式：开刷面板三按钮「预览 | 开始刷题 | 错题回顾」统一
  模式入口（页签头部切换器已删）；预览复用做题壳渲染，题卡只读
  全揭示——作答位/提交/自评/思路摘除、正确项 chip 与 steps 选项
  描绿、题级答案/解析全展开、题号与徽标不透历史对错；工具行
  「模糊答案」（答案区打码+隐去描色，点答案区单卡揭示）与
  「退出预览」；QuizShell 自 QuizView 拆出（500 行红线）
- 快捷复制：预览每卡 + 错题本详情「复制题目」——题型/题干/选项/
  steps/slots/答案/解析拼 markdown 写剪贴板（含 clipboard 兜底与
  轻提示），供粘贴到思源 AI 对话
- 修复长卷卡死（193 题真机触发）：①装载改批量——整卷子块×part
  一条 JOIN SQL 显式分页拉全（QuestionBatch，~390 次串行请求 →
  ~4 次，fetchSyncPost 仍串行）；②渲染分流——题量 >50
  （PROTYLE_INLINE_MAX）与题库模式同走静态 Lute+KaTeX，不再逐卡
  挂内嵌 Protyle（N 实例 × 8s 等待为主源）；③题号栏 max-height
  视口近似封顶（原 100% 对自适应父级无效，题多时栏底不可达）

## v0.1.0 2026-08-22

First usable cut of Wengu (温故), the drill plugin:

- Quiz tab from the top bar: collapsible sidebar of generated exercise
  documents (question count / drilled / correct / total time per doc),
  question-number rail with a "show numbers" setting toggle
- "AI: make questions" turns any note into a sibling `Title·习题`
  exercise document via SiYuan's built-in AI (suitability verdict first,
  then kramdown question blocks per the block contract)
- Per-type answering widgets; auto-grading for single/multiple/judge/fill
  tolerant of real AI output (content answers, merged option blocks,
  `$…$` delimiters); self-assessment for brief questions
- Timing modes (count-up / countdown / none) with per-round session
  history and a persisted per-document `total-time` attribute
- Wrong answers sync into the "温故错题" flashcard deck (added on wrong,
  removed on correct)

## v0.5.1 2026

- [Add an editor breadcrumb button demo](https://github.com/siyuan-note/siyuan/issues/18856)

## v0.5.0 2026-08-13

- [Migrate the kernel plugin sample from MCP tools to Agent capabilities](https://github.com/siyuan-note/siyuan/issues/18638)

## v0.4.9 2026-8-4

- [Add documentation for the kernels field in plugin.json](https://github.com/siyuan-note/plugin-sample/issues/48)

## v0.4.8 2026-6-30

- [Upgrade devDependencies and implement kernel plugin demo](https://github.com/siyuan-note/plugin-sample/pull/42)
- [Enhance KernelPlugin with MCP tool registration and update ESLint](https://github.com/siyuan-note/plugin-sample/pull/47)
- Migrate i18n locale codes from legacy underscore form (`zh_CN`/`en_US`) to [BCP 47](https://tools.ietf.org/html/bcp47) (`zh-CN`/`en`)
    - Aligns with SiYuan kernel RFC 5646 / BCP 47 lang code refactor (see https://github.com/siyuan-note/siyuan/issues/7098)
    - `plugin.json` keys, i18n file names (`src/i18n/*.json`) and `README.zh-CN.md` filename updated accordingly
    - Bump `minAppVersion` to `3.7.0` (older SiYuan versions will fall back to `default` locale for this plugin)

## v0.4.7 2026-04-14

- [Improve the dock panel title and tooltips](https://github.com/siyuan-note/siyuan/issues/17366)

## v0.4.6 2026-03-11

- [Improve error handling and security for plugin data storage methods](https://github.com/siyuan-note/siyuan/pull/16717)

## v0.4.5 2025-12-27

- [Improve minimum version requirements for marketplace packages](https://github.com/siyuan-note/siyuan/issues/16688)

## v0.4.4 2025-12-23

- [Delete plugin data when uninstalling the plugin](https://github.com/siyuan-note/plugin-sample/pull/37)

## v0.4.3 2025-12-02

- [Add onDataChanged method to handle data changes in the plugin](https://github.com/siyuan-note/siyuan/pull/16244)

## v0.4.2 2025-08-26

- [Upgrade ESLint to 9.33.0](https://github.com/siyuan-note/plugin-sample/issues/30)
- [Adjust `addTopBar` and `addStatusBar` from `onload` lifecycle to `onLayoutReady`](https://github.com/siyuan-note/siyuan/issues/15455)

## v0.4.1 2025-07-22

- [Add plugin function `saveLayout`](https://github.com/siyuan-note/siyuan/issues/15308)

## v0.4.0 2025-04-08

- [Add plugin function `openAttributePanel`](https://github.com/siyuan-note/siyuan/issues/14276)

## v0.3.9 2025-03-04

- [Add parameter `nodeElement` to `protyleSlash.callback`](https://github.com/siyuan-note/siyuan/issues/14036)

## v0.3.8 2025-02-11

- [Add plugin util `openSetting`](https://github.com/siyuan-note/siyuan/pull/13761)
- [Add plugin method `updateProtyleToolbar`](https://github.com/siyuan-note/plugin-sample/issues/24)

## v0.3.7 2024-11-05

- [Add plugin util `platformUtils`](https://github.com/siyuan-note/siyuan/issues/12930)
- [Add plugin function `getAllEditor`](https://github.com/siyuan-note/siyuan/issues/12884)
- [Add plugin function `getModelByDockType`](https://github.com/siyuan-note/siyuan/issues/11782)
- [Replace `any` in IProtyle with the corresponding type](https://github.com/siyuan-note/petal/issues/34)
- [Add `data-id` attribute to menu button](https://github.com/siyuan-note/plugin-sample/pull/20)

## v0.3.6 2024-09-27

- [Add plugin event bus `opened-notebook` & `closed-notebook`](https://github.com/siyuan-note/siyuan/issues/11974)
- [⬆️ Bump braces from 3.0.2 to 3.0.3](https://github.com/siyuan-note/plugin-sample/pull/16)

## v0.3.5 2024-04-30

- [Add `direction` to plugin method `Setting.addItem`](https://github.com/siyuan-note/siyuan/issues/11183)

## v0.3.4 2024-02-20

- [Add plugin event bus `click-flashcard-action`](https://github.com/siyuan-note/siyuan/issues/10318)

## v0.3.3 2024-01-24

- Update dock icon class

## v0.3.2 2024-01-09

- [Add plugin `protyleOptions`](https://github.com/siyuan-note/siyuan/issues/10090)
- [Add plugin api `uninstall`](https://github.com/siyuan-note/siyuan/issues/10063)
- [Add plugin method `updateCards`](https://github.com/siyuan-note/siyuan/issues/10065)
- [Add plugin function `lockScreen`](https://github.com/siyuan-note/siyuan/issues/10063)
- [Add plugin event bus `lock-screen`](https://github.com/siyuan-note/siyuan/pull/9967)
- [Add plugin event bus `open-menu-inbox`](https://github.com/siyuan-note/siyuan/pull/9967)

## v0.3.1 2023-12-06

- [Support `Dock Plugin` and `Command Palette` on mobile](https://github.com/siyuan-note/siyuan/issues/9926)

## v0.3.0 2023-12-05

- Upgrade Siyuan to 0.9.0
- Support more platforms

## v0.2.9 2023-11-28

- [Add plugin method `openMobileFileById`](https://github.com/siyuan-note/siyuan/issues/9738)

## v0.2.8 2023-11-15

- [`resize` cannot be triggered after dragging to unpin the dock](https://github.com/siyuan-note/siyuan/issues/9640)

## v0.2.7 2023-10-31

- [Export `Constants` to plugin](https://github.com/siyuan-note/siyuan/issues/9555)
- [Add plugin `app.appId`](https://github.com/siyuan-note/siyuan/issues/9538)
- [Add plugin event bus `switch-protyle`](https://github.com/siyuan-note/siyuan/issues/9454)

## v0.2.6 2023-10-24

- [Deprecated `loaded-protyle` use `loaded-protyle-static` instead](https://github.com/siyuan-note/siyuan/issues/9468)

## v0.2.5 2023-10-10

- [Add plugin event bus `open-menu-doctree`](https://github.com/siyuan-note/siyuan/issues/9351)

## v0.2.4 2023-09-19

- Supports use in windows
- [Add plugin function `transaction`](https://github.com/siyuan-note/siyuan/issues/9172)

## v0.2.3 2023-09-05

- [Add plugin function `transaction`](https://github.com/siyuan-note/siyuan/issues/9172)
- [Plugin API add openWindow and command.globalCallback](https://github.com/siyuan-note/siyuan/issues/9032)

## v0.2.2 2023-08-29

- [Add plugin event bus `destroy-protyle`](https://github.com/siyuan-note/siyuan/issues/9033)
- [Add plugin event bus `loaded-protyle-dynamic`](https://github.com/siyuan-note/siyuan/issues/9021)

## v0.2.1 2023-08-21

- [Plugin API add getOpenedTab method](https://github.com/siyuan-note/siyuan/issues/9002)
- [Plugin API custom.fn => custom.id in openTab](https://github.com/siyuan-note/siyuan/issues/8944)

## v0.2.0 2023-08-15

- [Add plugin event bus `open-siyuan-url-plugin` and `open-siyuan-url-block`](https://github.com/siyuan-note/siyuan/pull/8927)

## v0.1.12 2023-08-01

- Upgrade siyuan to 0.7.9

## v0.1.11

- [Add `input-search` event bus to plugins](https://github.com/siyuan-note/siyuan/issues/8725)

## v0.1.10

- [Add `bind this` example for eventBus in plugins](https://github.com/siyuan-note/siyuan/issues/8668)
- [Add `open-menu-breadcrumbmore` event bus to plugins](https://github.com/siyuan-note/siyuan/issues/8666)

## v0.1.9

- [Add `open-menu-xxx` event bus for plugins](https://github.com/siyuan-note/siyuan/issues/8617)

## v0.1.8

- [Add protyleSlash to the plugin](https://github.com/siyuan-note/siyuan/issues/8599)
- [Add plugin API protyle](https://github.com/siyuan-note/siyuan/issues/8445)

## v0.1.7

- [Support build js and json](https://github.com/siyuan-note/plugin-sample/pull/8)

## v0.1.6

- add `fetchPost` example
