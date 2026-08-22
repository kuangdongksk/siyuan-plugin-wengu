# 温故设计梳理与统一机会（2026-08-22）

> 背景：功能是逐步加上来的（题目卡片 → Protyle 渲染 → 目录/题号 →
> 计时四模式 → 进度/范围/展示三组选择 → 会话历史 → 设置页 → 模型选择
> → 只刷错题）。本文档先**理清现状**，再列出**可统一的设计点**，作为
> 下一轮重构的依据。逐条执行，不做一次性大改。
>
> **进度**：P0-1、P0-2、P1-1、P1-2、P1-3 已完成（2026-08-22，
> 新增 `ui.ts` / `StartPanel.ts` / `TimerController.ts`，QuizView 从
> 1399 行降到 ~1305 行，开刷面板与计时模式分支不再散落）；P2 待做。
> 模块化拆分已完成（全仓单文件 ≤500 行，QuizView 496 行），新增
> CardHtml/ProtyleHost/AnswerFlow/ConvertDialog/RoundReport/QuizLoader/
> ViewBindings/NumRail/AgentClient/FormHtml。

## 〇、界面规范（2026-08-22 起硬性约定）

1. **图标一律用思源内置 SVG symbol**（`FormHtml.svgIcon("iconClock")`
   等），**禁止 emoji/表情字符**（⏱⏰⟳✨⚙ 一类）。symbol id 需存在于
   主程序 stage（iconClock/iconRefresh/iconSettings/iconSparkles/
   iconInfo/iconList 已验证）。
2. **全项目表单统一 FormHtml 行样式**：`formGroup`（分组+标题）+
   `formRow`（标题说明在左、控件在右）+ `formSelect/formSwitch/
   formOption`。设置页、开刷面板、转换弹窗都走这一套，不再自写布局。
3. 图标型入口（如目录底部「设置」）只放图标本体，文字放 title 提示。

## 一、现状全景

| 模块                           | 行数 | 职责                                                                                            |
| ------------------------------ | ---- | ----------------------------------------------------------------------------------------------- |
| `src/index.ts`                 | 138  | 插件入口：topbar、页签注册、settings 装载、openSetting                                          |
| `src/wengu/QuizView.ts`        | 1399 | **上帝类**：目录/头部/开刷面板/卡片/题号导航/判分/计时（4 模式）/会话记账/转换对话框/偏好持久化 |
| `src/wengu/QuestionService.ts` | 468  | 块读写内核 API 封装：SQL 聚合、hydrate、判分、属性写                                            |
| `src/wengu/ConvertService.ts`  | 354  | 文档定位 + 模型清单 + agentChat(SSE) + prompt + 落盘《·习题》                                   |
| `src/wengu/HistoryStore.ts`    | 96   | N 刷会话历史（saveData("history")）                                                             |
| `src/wengu/SettingsDialog.ts`  | 133  | 仿原生设置页（左导航 + 分组）                                                                   |
| `src/wengu/types.ts`           | 182  | 领域类型 + 清洗/比较纯函数                                                                      |
| `src/wengu/attrs.ts`           | 45   | 属性名常量                                                                                      |

分层本身是清楚的：**内核 API（QuestionService/ConvertService）→
领域纯函数（types）→ 视图（QuizView/SettingsDialog）→ 存储
（块属性 / prefs / settings / history 四类）**。问题集中在 QuizView
一个类承担了太多「逐步长出来」的职责。

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

* `esc` 在 QuizView.ts:1397 与 SettingsDialog.ts:27 各一份；
  `fmt/mmss` 只在 QuizView。
* **统一**：抽 `src/wengu/ui.ts`（esc/fmt/mmss + 后述 radio 读取），
  两处 import。纯机械，零风险。

### P0-2 注释与文档漂移

* QuizView 类头注释仍写「文档下拉」「错题进 riff 卡组」（均已删）。
* 契约文档 §四头部描述仍是「刷新 + 文档下拉」。
* **统一**：注释随行为改；契约文档§四已在本次修正。后续规则：改行为
  的 PR 必须同改契约文档对应条目。

### P1-1 QuizView 拆分：开刷面板 = 一个 RoundConfig 表单

* renderStartPanel 的 radio 工厂 + beginDrill 里 5 段
  `querySelector("input[name=…]:checked")` 是同一件事的两半。
* **统一**：定义
  `RoundConfig = {progress, scope, reveal, timing, countdownMin}`；
  `StartPanel.render(config): string` + `StartPanel.read(el): RoundConfig`。
  beginDrill 只消费 RoundConfig。wrongOnly 禁用 continue 的联动也收进
  StartPanel 绑定层。
* 收益：新增一种选择（比如「乱序」）只改 StartPanel + 消费点。

### P1-2 计时 4 模式 → TimerController

* tick / updateTimerLabel / beginDrill(continue 恢复倒计时) /
  perQuestionSec 四处各自 if/switch timingMode。
* **统一**：`TimerController{ mode, baseSec, countdownLeft, qSec,
  onTick(label) }`，QuizView 只保留 setInterval 壳。逐题计时的
  activeQIdx 联动通过 `setActiveQuestion(idx)` 进控制器。

### P1-3 两套「记住选择」语义重叠

* prefs("quiz") 记 timingMode/revealMode（上次用的）；settings 记
  convertModelId（也是「上次用的」，却放设置页且叫「默认」）。
* 规则不清：设置页的「默认 AI 模型」与转换弹窗互相预选，但计时/展示
  没有进设置页。
* **统一**规则后各归其位：**设置页=默认值**（新轮的初始选择，含默认
  计时/展示/模型/题号）；**prefs=上次会话状态**（当前文档、目录收起、
  未完成轮由 history 承担）。转换弹窗的「临时换模型」不落 settings，
  只落 prefs（上次用）。

### P2-1 已答状态三写 → 单一入口

* 「答过/对错」同时存在于：卡片 DOM(dataset.graded/chip 类/result 区)、
  session.results、块属性。restoreAnswered/revealCard/revealAll/
  markChips/markNum 在三处间手工对齐，是最易出 bug 的区域。
* **统一**：DOM 仅展示，新增 `renderCardState(q, result|null,
  phase: answering|answeredPending|revealed)` 单入口；恢复与即时/统一
  揭示都走它。

### P2-2 视图层数据补偿逻辑分散

* fullList/list（错题子集）与 pendingDoc（索引延迟补位）都是「数据
  未就绪/被过滤」的补偿，散在 load/beginDrill/renderSide。
* **统一**：抽 `DocSource.load(docId) → {docs, fullList, rounds}`，
  过滤与补位在源头完成，视图只拿最终要渲染的数组。

### P2-3 三套表单外观

* 开刷面板（wengu-start 自定义）、转换弹窗（b3-dialog + 手写行）、
* 设置页（config__panel 原生仿制）。
* **统一**：不必强求同一种容器（场景不同），但**行级控件**统一为
  ui.ts 里的 `radioRow/selectRow` 生成器，保证间距/禁用态/占位符一致。

### P2-4 i18n 键风格

* 旧键驼峰无前缀（quizRefresh/convertBtn/answerLabel），新键带组前缀
  （setTab*/scope*/timing*）。模板占位符 {n}/{c}/{a}/{t} 无命名规范。
* **统一**：新键一律「组前缀 + 含义」；模板键注释在 zh-CN.json 头部
  说明占位符。旧键暂不迁移（避免无收益 churn），新增不再偏离。

### P2-5 ConvertService 拆 AgentClient

* 现在一个文件五件事：文档定位、模型清单、SSE 客户端、prompt、落盘。
* **统一**：`AgentClient.ts`（agentChat + listAiModels +
  defaultAgentModelId）独立；ConvertService 只做转换编排。模型清单
  被 SettingsDialog/转换弹窗两处消费，值得独立出口。

## 五、执行建议

1. 先做 P0（半天内、零行为变化）；
2. P1 三项在下个功能迭代前做（开刷面板与计时是后续「乱序/筛选/统计」
   类需求的地基）；
3. P2 随触碰随改，不单独立项。

明确**不做**的事：

* 不引入外部状态管理库（体量不需要）；
* 不迁移旧 i18n 键名；
* 不把块属性数据搬进插件存储（块属性随文档走是特性不是缺陷）。
