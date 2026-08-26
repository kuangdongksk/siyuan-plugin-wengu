# 温故设计梳理与统一机会（2026-08-22）

> 背景：功能是逐步加上来的（题目卡片 → Protyle 渲染 → 目录/题号 →
> 计时四模式 → 进度/范围/展示三组选择 → 会话历史 → 设置页 → 模型选择
> → 只刷错题）。本文档先**理清现状**，再列出**可统一的设计点**，作为
> 下一轮重构的依据。逐条执行，不做一次性大改。
>
> **进度**：P0 全部、P1 全部、P2-3/P2-5 已完成（2026-08-22）；模块化
> 拆分完成且全仓单文件 ≤500 行（最大 QuizView 500），新增
> CardHtml/ProtyleHost/AnswerFlow/StepsFlow/AiJudge/ConvertDialog/
> RoundReport/QuizLoader/OrphanCleaner/QuestionGrading/
> ConvertHost/ViewBindings/NumRail/AgentClient/FormHtml（Flashcards
> 20260823 删除——错题闪卡废弃，见 question-block-contract.md）；
> 20260825 复习模式（错题本）新增 ReviewFlow/ReviewHtml + ConvertAccess
> 拆出（见 docs/review-mode.md）。

## 〇、界面规范（2026-08-22 起硬性约定）

1. **图标一律用思源内置 SVG symbol**（`FormHtml.svgIcon("iconClock")`
   等），**禁止 emoji/表情/符号字符**（⏱⏰⟳✨⚙ 及 «»✓✗◐★ 一类，
   2026-08-23 清零：结果行状态图统一走 `FormHtml.statusIcon`，难度星
   用 iconStar）。symbol id 以
   `resources/appearance/icons/index.html`（官方图标清单页）为准
   （iconClock/iconRefresh/iconSettings/iconSparkles/iconInfo/
   iconList/iconLeft/iconRight/iconStar/iconCheck/iconClose/
   iconIndeterminateCheck 已验证）。
2. **全项目表单统一 FormHtml 行样式**：`formGroup`（分组+标题）+
   `formRow`（标题说明在左、控件在右）+ `formSelect/formSwitch/
formOption`。设置页、开刷面板、转换弹窗都走这一套，不再自写布局。
3. 图标型入口（如目录底部「设置」）只放图标本体，文字放 title 提示。
4. **带文字的按钮一律 `b3-button--outline` 带边框**（开始刷题/AI 转习题/
   开始转换/继续作答/AI 分析报告）；只有纯图标按钮可以无框
   （b3-button--text/icon）；取消类沿用 b3-button--cancel。
5. **AI 分析报告打开思源内置智能体**：DOM 自动化（dock `agentChat` →
   新会话 → 合成 paste 喂 prompt → 发送，选择器按 3.8.0 dump 校准），
   失配降级页内纯文本分析。
6. **间距体系（2026-08-26 起）**：基数 4px——弹窗底部操作行按钮间
   **8px**（`.wengu-dialog .b3-dialog__action { gap: 8px }` 兜底，原生
   无间距规则）；图标与相邻文字 4px；卡片内块间 8px；分组标题与条目
   8px。容器内边距/行高沿用思源原生（b3-dialog__action 7px 24px、
   config__item 原生 padding），不自造。
7. **长列表选择控件（2026-08-26 起）**：候选 >20 的下拉不用原生
   `<select>`（模型列表几百项不可搜），统一走「触发按钮 + 官方风格
   可搜索浮层」——类名照抄官方 commonMenu（`b3-menu__filter` +
   `b3-text-field` 搜索 + `b3-list--background` + `b3-list-item--narrow`，
   见 `src/ui/ModelPicker.ts` 模型单选、`src/ui/KnowPicker.ts` 文档
   单/多选）；浮层挂 body 用 fixed 定位，点外部/Esc 关闭。20 项以内
   短列表仍用 formSelect。
8. **插件级图标（顶栏/dock/页签，2026-08-26 定论）**：经
   `addIcons` 以**自有稳定 id**（iconWengu/iconWenguWords）注册，
   **形状抄思源官方图标集原始 path**（当前：iconRiffCard 卡牌堆 /
   iconLanguage 地球）。不直接引用内置 sprite id：①非核心图标
   （iconLanguage）在运行环境 sprite 里不存在会渲染空白；②conf.json
   uiLayout 持久化 dock 图标 id，启动恢复用存量数据不走插件新
   config——**id 永不改**，换图标只换 path。

## 一、现状全景

| 模块                           | 行数 | 职责                                                              |
| ------------------------------ | ---- | ----------------------------------------------------------------- |
| `src/wengu/QuizView.ts`        | 500  | 页签编排层：状态持有 + 各模块接线（模式切换/统计入口/下钻重开）   |
| `src/wengu/ReviewFlow.ts`      | 342  | 复习模式（错题本）编排：全局错题 SQL 分页 + 时间线索引 + 惰性回看 |
| `src/wengu/ReviewHtml.ts`      | 180  | 错题本纯渲染：分组清单 + 单题回看详情 + 历次时间线                |
| `src/wengu/ConvertAccess.ts`   | 167  | QuizView 的 ConvertViewAccess 实现体（转换状态/收尾，拆出压红线） |
| `src/wengu/CardHtml.ts`        | 470  | 纯 HTML 构建：题卡/作答位/目录/头部（信息行+计时）/主区外壳       |
| `src/wengu/StepsFlow.ts`       | 453  | steps 多步引导题作答流程                                          |
| `src/wengu/AnswerFlow.ts`      | 440  | 作答流程：判分/揭示/自评/恢复已答                                 |
| `src/wengu/ConvertDialog.ts`   | 425  | AI 转习题弹窗（原位/另存 + PDF 导入入口）                         |
| `src/wengu/QuestionService.ts` | 393  | 块读写内核 API：SQL 聚合、hydrate、记账（判分/闪卡 re-export）    |
| `src/wengu/RoundReport.ts`     | 337  | 一轮总结：图表 + AI 分析 + 收卷编排（openAgentWithPrompt 复用）   |
| `src/wengu/StartPanel.ts`      | 287  | 开刷面板：RoundConfig 表单渲染/读取/开轮                          |
| `src/wengu/ConvertService.ts`  | 258  | 转换编排：文档定位 + prompt + 落盘 + 生成位置 + 配对属性          |
| `src/wengu/SettingsDialog.ts`  | 255  | 仿原生设置页（左导航 + 分组）                                     |
| `src/wengu/types.ts`           | 247  | 领域类型 + 清洗/比较纯函数                                        |
| `src/index.ts`                 | 217  | 插件入口：topbar、页签注册、settings 装载、openSetting            |
| `src/wengu/AiJudge.ts`         | 217  | steps 题 AI 实时判分                                              |
| `src/wengu/AgentClient.ts`     | 179  | 智能体 SSE 客户端 + 模型清单/下拉选项                             |
| `src/wengu/StatsService.ts`    | 176  | 统计聚合纯函数：总览/单文档/错题清单 + AI 建议 prompt             |
| `src/wengu/StatsPanel.ts`      | 175  | 统计浮层编排：两 tab、数据拉取、下钻联动、AI 双路径               |
| `src/wengu/StatsHtml.ts`       | 165  | 统计纯渲染：数字卡/文档榜/逐轮评分/错题清单                       |
| `src/wengu/ProtyleHost.ts`     | 163  | 内嵌 Protyle 逐卡串行挂载                                         |
| `src/wengu/StatsCharts.ts`     | 161  | echarts 按需注册与图表 option/生命周期（插件自带非 window）       |
| `src/wengu/QuizLoader.ts`      | 147  | 一次装载：孤儿清理/文档/题目/轮次/prefs 恢复                      |
| `src/wengu/TimerController.ts` | 146  | 计时状态机（4 模式 + 逐题秒数）                                   |
| `src/wengu/HistoryStore.ts`    | 140  | N 刷会话历史（saveData("history")，allSessions 供统计）           |
| `src/wengu/QuestionGrading.ts` | 123  | 判分纯函数：客观题/多步题自动判分与选项描色                       |
| `src/wengu/Flashcards.ts`      | 92   | 「温故错题」闪卡卡组：懒创建与加/移卡片                           |
| `src/wengu/TimerBinder.ts`     | 88   | 计时编排（自 QuizView 外移）：tick/落库/标签/超时条               |
| `src/wengu/ConvertHost.ts`     | 82   | 转换编排：弹窗依赖组装/转换按钮/页内状态条                        |
| `src/wengu/FormHtml.ts`        | 60   | 共享表单构件（§〇 规范落地）                                      |
| `src/wengu/NumRail.ts`         | 60   | 题号导航渲染与绑定                                                |
| `src/wengu/OrphanCleaner.ts`   | 55   | 孤儿习题文档清理（源删则习题随删，进回收站）                      |
| `src/wengu/attrs.ts`           | 53   | 属性名常量                                                        |
| `src/wengu/ui.ts`              | 40   | esc/fmt/mmss/clampMinutes                                         |
| `src/wengu/MinerUClient.ts`    | 200  | MinerU 解析客户端（forwardProxy + OSS 直连 + fflate 解压）        |
| `src/wengu/PdfImport.ts`       | 150  | PDF 导入编排：插图落 assets + 建原文档                            |
| `src/wengu/ViewBindings.ts`    | 39   | 头部与目录事件绑定（搜索/委托点击/统计入口）                      |

分层：**内核 API（QuestionService/ConvertService/AgentClient）→
领域纯函数（types）→ 视图（QuizView 编排 + 各渲染/流程模块）→ 存储
（块属性 / prefs / settings / history 四类）**。原「QuizView 上帝类」
问题已由 2026-08-22 的拆分解决。

统计面板（2026-08-24 新增，StatsService/StatsCharts/StatsHtml/
StatsPanel 四件 + TimerBinder 自 QuizView 外移计时编排）：浮层两
tab（总览 + 本文档详情），只读聚合会话历史与已装载题目。图表为
**插件自带按需 echarts**（`echarts/core` + bar/line 最小组件集），
不用 `window.echarts`——官方未向插件开放该依赖（issue #8516 关闭
未采纳），也不走 chart 块路线（需活在 Protyle 里，浮层复用不了）。

## 二、一轮刷题的状态机（理清后的骨架）

```
load()（进文档/刷新/切换）
  └─ finishSession() 收卷上一轮 → 拉取 docs/list/fullList/rounds
     → !started：开刷面板（四组选择）
          ① 上次进度：继续上次 | 重新开始     （有未完成轮才出现）
          ② 刷题范围：全部 | 只刷上次错题     （上轮有错题才出现）
          ③ 答案展示：即时 | 做完统一展示
          ④ 计时方式：正计时 | 倒计时(分钟) | 逐题 | 不计时
     → beginDrill()：解析选择 → 定 scope(list 子集) → 建/续 session
        → started=true → 渲染卡片（Protyle 串行挂载）→ 计时走秒
          → submit()/selfGrade()：判分 → 记属性 + 记会话
             ├─ instant：当场揭示（revealCard）
             └─ after：全部作答完 → revealAll()
  └─ load()/destroy()/selectDoc() → finishSession() → flushTime()
```

一个「轮次配置」实际是 4 维选择（progress × scope × reveal × timing），
其中 progress 仅在 continue 时影响会话，scope 仅影响题目集合，
reveal/timing 影响作答与展示全程——**这是最重要的统一抽象**（见 §四-1）。

## 三、数据存放分层（现状，保持）

| 数据                               | 存放                                          | 写入方                    |
| ---------------------------------- | --------------------------------------------- | ------------------------- |
| 单题最新状态/累计                  | 块属性 attempts/wrong-count/last-answer/right | QuestionService           |
| 文档累计用时                       | 文档块 total-time                             | addDocTotalTime           |
| 上次的选择（docId/收起/计时/展示） | saveData("quiz")                              | QuizView.persistPrefs     |
| 插件设置（题号/默认模型）          | saveData("settings")                          | SettingsDialog + 转换弹窗 |
| N 刷会话（逐题作答/用时/对错）     | saveData("history")                           | HistoryStore              |

内核 SQLite 无插件建表 API（/api/query/sql 只读），分层已是最优解，不动。

## 四、可统一的设计点（按优先级）

### P0-1 工具函数重复：`esc/fmt/mmss` 各自为政

- `esc` 在 QuizView.ts:1397 与 SettingsDialog.ts:27 各一份；
  `fmt/mmss` 只在 QuizView。
- **统一**：抽 `src/wengu/ui.ts`（esc/fmt/mmss + 后述 radio 读取），
  两处 import。纯机械，零风险。

### P0-2 注释与文档漂移

- QuizView 类头注释仍写「文档下拉」「错题进 riff 卡组」（均已删）。
- 契约文档 §四头部描述仍是「刷新 + 文档下拉」。
- **统一**：注释随行为改；契约文档§四已在本次修正。后续规则：改行为
  的 PR 必须同改契约文档对应条目。

### P1-1 QuizView 拆分：开刷面板 = 一个 RoundConfig 表单

- renderStartPanel 的 radio 工厂 + beginDrill 里 5 段
  `querySelector("input[name=…]:checked")` 是同一件事的两半。
- **统一**：定义
  `RoundConfig = {progress, scope, reveal, timing, countdownMin}`；
  `StartPanel.render(config): string` + `StartPanel.read(el): RoundConfig`。
  beginDrill 只消费 RoundConfig。wrongOnly 禁用 continue 的联动也收进
  StartPanel 绑定层。
- 收益：新增一种选择（比如「乱序」）只改 StartPanel + 消费点。

### P1-2 计时 4 模式 → TimerController

- tick / updateTimerLabel / beginDrill(continue 恢复倒计时) /
  perQuestionSec 四处各自 if/switch timingMode。
- **统一**：`TimerController{ mode, baseSec, countdownLeft, qSec,
onTick(label) }`，QuizView 只保留 setInterval 壳。逐题计时的
  activeQIdx 联动通过 `setActiveQuestion(idx)` 进控制器。

### P1-3 两套「记住选择」语义重叠

- prefs("quiz") 记 timingMode/revealMode（上次用的）；settings 记
  convertModelId（也是「上次用的」，却放设置页且叫「默认」）。
- 规则不清：设置页的「默认 AI 模型」与转换弹窗互相预选，但计时/展示
  没有进设置页。
- **统一**规则后各归其位：**设置页=默认值**（新轮的初始选择，含默认
  计时/展示/模型/题号）；**prefs=上次会话状态**（当前文档、目录收起、
  未完成轮由 history 承担）。转换弹窗的「临时换模型」不落 settings，
  只落 prefs（上次用）。

### P2-1 已答状态三写 → 单一入口

- 「答过/对错」同时存在于：卡片 DOM(dataset.graded/chip 类/result 区)、
  session.results、块属性。restoreAnswered/revealCard/revealAll/
  markChips/markNum 在三处间手工对齐，是最易出 bug 的区域。
- **统一**：DOM 仅展示，新增 `renderCardState(q, result|null,
phase: answering|answeredPending|revealed)` 单入口；恢复与即时/统一
  揭示都走它。

### P2-2 视图层数据补偿逻辑分散

- fullList/list（错题子集）与 pendingDoc（索引延迟补位）都是「数据
  未就绪/被过滤」的补偿，散在 load/beginDrill/renderSide。
- **统一**：抽 `DocSource.load(docId) → {docs, fullList, rounds}`，
  过滤与补位在源头完成，视图只拿最终要渲染的数组。

### P2-3 三套表单外观（已完成，2026-08-22）

- 开刷面板（wengu-start 自定义）、转换弹窗（b3-dialog）、设置页
  （config__panel 原生仿制）容器保持各自场景，**行级控件**统一为
  `FormHtml` 的 formGroup/formRow/formSelect/formSwitch/formOption/
  formInput，间距/禁用态/占位符一致；规范固化为 §〇。

### P2-4 i18n 键风格

- 旧键驼峰无前缀（quizRefresh/convertBtn/answerLabel），新键带组前缀
  （setTab*/scope*/timing*）。模板占位符 {n}/{c}/{a}/{t} 无命名规范。
- **统一**：新键一律「组前缀 + 含义」；模板键注释在 zh-CN.json 头部
  说明占位符。旧键暂不迁移（避免无收益 churn），新增不再偏离。

### P2-5 ConvertService 拆 AgentClient（已完成，2026-08-22）

- `AgentClient.ts`（agentChat + listAiModels + defaultAgentModelId +
  modelOptionsHtml 下拉选项拼装）已独立；ConvertService 只做转换编排，
  模型清单被 SettingsDialog/转换弹窗两处消费。

### P2-6 「继续上次」不恢复刷题范围

- session 未记录 scope：未完成轮若是以「只刷错题」开的，继续时会
  展开为全量题表（计时/展示/分钟恢复，范围不恢复），与面板
  「继续=原样恢复」的注释有出入。
- **修法**：WenguSession 增加 scope 字段（缺省 all 向后兼容），
  startRound 继续时按它过滤 fullList。

## 五、执行建议

1. 先做 P0（半天内、零行为变化）；
2. P1 三项在下个功能迭代前做（开刷面板与计时是后续「乱序/筛选/统计」
   类需求的地基）；
3. P2 随触碰随改，不单独立项。

明确**不做**的事：

- 不引入外部状态管理库（体量不需要）；
- 不迁移旧 i18n 键名；
- 不把块属性数据搬进插件存储（块属性随文档走是特性不是缺陷）。
