# src/mobile/ —— 移动端刷题（Issue #59，`index.ts`=dock 挂载编排）

移动端「**仅刷题**」：dock 面板内完成 选卷/开刷 → 作答 → 判分揭示 →
轮次报告。管理类功能（转换 / rail 工作区 / 统计 / 词书）不进移动端。
设计稿 `design/wengu-mobile-drill.html`（九屏 390×844）。

- **挂载通道 = dock**：思源移动端 `openTab` 是空桩（AGENTS.md 移动端
  约定），dock 是插件面板唯一通道。`index.ts` 在 `isMobileUi()` 为真时
  注册 `wengu-mobile-drill` dock（**桌面不注册**——桌面已由页签承担，
  重复注册会在桌面 dock 多出一个面板 = 桌面回归）；顶栏入口在移动端仍
  走 `notifyInfo` 提示（dock 无程序化打开 API）。
- **与 QuizView 零耦合，但记账通道逐字复用**：移动端不复用桌面壳的
  整壳 innerHTML 管线（那是页签尺寸的布局），`MobileDrill` 自己持响应态、
  组件直渲染。**终态语义与桌面同口径**：
    - 即时判分（instant）= `setGraded` 一把置 graded+locked+revealed；
    - 收卷统一（after）= 提交只置 graded + 「已答」（`locked`/`revealed`
      都留到交卷 `endRound`）；
    - 「未完成轮」判据**只看 `session.endedAt`**（答满但未交卷仍算未完成）；
    - 记账全走既有通道：`HistoryStore.pushSessionAnswer`（upsert 幂等）、
      `AnswerMirror`（首答 attempts+1 / 重复提交只覆写 / 收卷模式交卷时
      补 batch 镜像）、判分 `gradeQuestion`/`judgeBrief`。
    - ⚠️ **after 模式 brief「终局判分晚于交卷」必须覆写题库**（Issue #61
      复审必修）：收卷模式的镜像**整体推迟**到 `endRound` 的
      `flushBatchMirror`，AI 判分完成时若该轮**已收卷**（`s.endedAt` 已置
      ⇒ flush 已跑过、占位 `false` 已入账），迟到的 verdict 必须走
      `mirrorRepeatAnswer`（覆写，attempts 已由 flush 计过、**不再 +1**）。
      不这么做题库永远停在占位「错」——薄弱画像/错题本按错处理，且会话
      与题库互相矛盾。桌面 `judgeBriefAnswer` 判完即 `recordAnswer`，
      无此窗口；改 `reRecord` 的 batch 早退分支时别把这条删回去
      （回归测试锁在 `MobileDrill.test.ts`「终局判分晚于交卷」）。
    - ⚠️ **instant 模式 brief 判完必须 `checkAllDone`**：桌面
      `judgeBriefAnswer` 的**成功**路径两态都调，末题是 brief 才会自动出
      报告；漏掉就只能靠用户点自评或手动交卷，与客观题「答满即出报告」
      不一致。判据取 `ui.graded`（成功路径唯一写入点）——`ui.selfOn` 在
      **成功与失败两路都置**（那是「改判」钮），拿它分流会把成功路也挡住。
      判分失败回落自评时**不调**（等 `selfAssess` 收口，与桌面 catch
      分支同款）。
- **多步题（steps）在移动端按「整题文本作答」处理**：桌面 `StepsFlow` 的
  逐步作答/申诉链属重型交互，小屏无落脚点。只改作答形态，**不改记账**
  （仍记在同一块 qid 上）。`MobileModel.isMobileText`（= brief 同族 ∪
  steps）只是「是否文本族」的**族判据**，**不是**作答形态的唯一判据——
  渲染与提交一律走 `answerKindOf`（见下条），单独用前者会与 `slots`
  分支冲突。
- **分文件口径**（单文件 ≤500 红线，两个文件都走过拆）：
  `MobileDrill.ts` = 装载/开刷/导航/收卷/报告编排；
  `MobileAnswering.ts` = 作答流程（函数式友元，接 drill 实例读写
  `d.ui`，同 BankRegen/AnswerMirror 口径）——点选/提交/AI 判分/自评/
  「不会」/跳过 + 记账与判分呈现。**揭示态与锁定态的写入只在
  MobileAnswering**，`MobileDrill` 只转发，别在两处各写一份。
- **响应态必须是 `$state` 深代理**：`MobileUi` 在 `MobileApp.svelte` 里
  `$state(initialMobileUi())` 创建后注入控制器（同 word 域 WordApp 先例）。
  **控制器若把状态摊成自己的普通字段，Svelte 5 不追踪、界面全程不刷新**
  ——这是本域最易踩的坑（word 域踩过同款）。
- **纯逻辑在 `core/MobileModel.ts`（带单测）**：题头题型标签、题号抽屉
  格子、报告统计、错题清单、题数候选。两条关键口径：
    - **抽屉格子按材料组整组连成一格**（设计稿屏 ⑨「15–19 阅读 · 组题」），
      组格状态取组内**最差**（错 > 已答 > 未答 > 对）——点进去就是那道错的；
    - **会话结果必须先按块 id 归并**（多步/逐空题记的是 `qid#k`）——不归并
      会把一道多步题算成 N 道，统计与格子全错位。
- **空轮静默关轮（Issue #158，对齐桌面 #155 块 A）**：移动端有**独立的收卷
  守卫**（`MobileDrill.requestEnd`），#155 只改了桌面 `finishRoundGuarded`，
  移动端原样停在 #147 的旧拦截口径（通知 `endRoundEmpty` + 不收卷），
  「进来不想做、直接关掉」被挡（用户原话不分端）。
    - 现 `requestEnd` 的 `answered <= 0` 分支调 `MobileDrill.closeEmptyRound()`
      （收卷生命周期在 `core/MobileRound.ts`，函数式友元，同
      `MobileAnswering` 口径），**与桌面 `RoundReport.closeEmptyRound` 同语义**
      按本域状态机落地：抹 `history.removeSession`（`start` 已 upsert 的 0 作答
      记录）→ 停表 → 退态（清 session/cards/confirmEnd）→ 回开刷面板 +
      重探测未完成轮。⚠️ 判据 `answered <= 0` 与桌面**是有意的两处重复**
      （本域拿不到桌面 `ctx`），改一处必须同步另一处。
    - ⚠️ **两处「空轮」口径不同名不同物**：`emptyRound(桌面)` 与移动端
      `requestEnd` 分支是两条链；而 `src/mobile/core/MobileDrill.ts` 里的
      `emptyRound` 旧写法属于本域。
    - **i18n `endRoundEmpty` 已删（中英各一处）**——移动端对齐后全仓零引用，
      按 design-spec §8.4 死键口径两语言同删；契约锁在
      `quiz/render/RoundReport.contract.test.ts`（源级断言 + 字典零残留）。
      别把键加回来，也不要新造同义键。
- **样式一律挂 `.wengu-mobile` 后代选择器**（`scss/mobile-{home,drill,
answer,drawer}.scss`，四片各 <500 行）：标记由挂载层 `markMobileUi` 打。
  **桌面不带标记 ⇒ 一条不生效**（实测桌面 CSS 前缀逐字节不变，移动端块
  只是插在 words-mobile 与 companion 之间）。**禁 media query**（桌面
  浏览器窄窗口会误伤）。色值全走 b3 主题令牌，明/暗主题自适应。
  口径：触控目标 ≥44px、交互不依赖 hover、正文 ≥15px、输入框 ≥16px。
- ⚠️ **材料面板只在展开时渲染正文**（收起只留摘要行）：正文经
  `MobileMaterials.materialHtml` 过 `MaterialDecorate.decorateMaterial`
  这个**唯一装饰出口**（词表/线索与桌面同链）——直接拼 markdown 字符串
  会绕过装饰，词形联动与线索 mark 全丢。
- 移动端 `isMobileUi()` 是桌面/移动分流的唯一判据（`ui/shared`），
  `markMobileUi` 打标记类；别用 `getFrontend`（types 1.2.4 里没有）。
- ⚠️ **作答形态由 `MobileModel.answerKindOf` 唯一判定**（`choice` /
  `judge` / `text` / `fill` / `slots` / `plain`）：作答位渲染
  （`QuestionBody`）与提交分流（`MobileAnswering.submit`）**都取它**，
  别在两边各写一份「有没有 optionMd / 是不是 brief」的派生判断——这正是
  首版踩的坑：**填空题（无 optionMd）落进「都不是」的空档，既无输入区
  也无选项、整题不可作答**；**配对题（题级 optionMd 是候选池）被当成
  选择题渲染**，点选的「候选」与 `gradeQuestion` 期望的槽位字母对不上，
  静默判错。优先序三条不能挪（见该函数注释）：`slots`（候选池非选项）
  → `steps`（桌面同款先判，带 optionMd 的 steps 题否则退化成选择题）
  → `judge`。
- **移动端各形态的作答与揭示口径**：
    - **填空**（`fill`）= 单行输入 + `gradeQuestion` 自动判分（设计稿屏 ④
      注「填空题为单行输入」），与选择题同走即时/收卷两态；
    - **逐空题**（`cloze`/`match`）= **不给作答位**：逐空作答是桌面
      `SlotFlow` 的重型交互（空号条 + 候选池 + 逐空判分），小屏无落脚点；
      整题文本作答又会把它记成「一道题的一个答案」，与 `qid#k` 的逐空
      记账口径冲突（统计与错题清单全错位）。故只渲染题干 + 提示需回桌面，
      **提交与「不会」都零记账零揭示**，底部「跳过 / 不会」整条不出现；
    - **无题型/无答案的兜底题**（`plain`）= 与桌面 `submitQuestion` 同款：
      揭示后露自评钮、**先不记账**（对错由 `selfAssess` 给）；收卷模式下
      只置「已答」，交卷时由 `endRound` 补揭示 + 自评钮（否则交卷后这题
      既无答案也无自评入口，用户无法收口）。
- **i18n 不许硬编码**：`QuestionBody` 是纯展示件，**取词由壳经 `t` prop
  传入**（同 `QuizCard` 口径），组件内不持控制器也不写字面中文——首版
  判断/揭示区的「正确 / 错误 / 答案 / 你的选择 / 解析」全是硬编码中文，
  英文环境下整片漏译。
- **作答两段式确认**（Issue #105，20260915 用户真机反馈「防误触」）：
  **点选只落选择态，提交一律由「确认答案」触发**——`DrillScreen.pick` 只调
  `drill.pickLetter`，不再对单选/判断自动 `submit()`；`needConfirm` 覆盖
  **所有可作答形态**（choice / judge / text / fill / plain），只有逐空
  `slots`（无作答位）排除。选择/判断未选中任何项时确认钮 `disabled`
  （`confirmDisabled`）；**文本/填空保持现行为**——空提交按原样出
  「未作答」提示，不 disable。**提交链（`MobileAnswering.submit` /
  `pickLetter`）零改动**（既有 `noAnswer` 空提交守卫与幂等口径照旧），
  改动只落在组件层。
    - 移动端/收卷两模式同口径；`mobileAnswerHint` 文案随之改为
      「作答后按「确认答案」判分」/ "Answer, then tap Confirm to grade"。
- **移动端页面图标以移动端 sprite 为准**：桌面有的 symbol（`iconGrid` /
  `iconFlag` / `iconDoc`）在移动端页面样式表**不存在**，用了就是空白。
  现用同义替换：答题卡 `iconList`、标不会/错题条 `iconBookmark`、
  题集分组头 `iconFile`。新增移动端图标前先确认 symbol 在移动端 sprite 里。
- ⚠️ **选项单项列表剥壳**（Issue #105，桌面/移动同链路同病）：部分题库的
  `optionMd` 是列表形态（`- A. xxx` → `<ul><li><div class="p">…</div></li></ul>`），
  `optionInline` 原先只剥单段落（`unwrapSingleBlock` 对顶层 `ul` 返 null），
  整条列表（含**列表圆点**）渲进选项行 ⇒ 字母圆圈旁游离「•」+ 双重字母标。
    - 新增导出纯函数 `ProtyleHost.unwrapSingleListItem`：**恰一个 `li` 且
      li 内恰一个段落**才剥，多项列表（真语义清单）与 li 内多块（含嵌套
      列表）一律原样返回；传入 null 原样透传。
    - ⚠️ **两条剥壳是并行的顶层形态判定，不许串成两级**：
      `unwrapSingleListItem` 对单段落输入原样透传（≠ 剥壳），故 `optionInline`
      写成「列表剥壳命中即用、否则回落单段落剥壳」。串成
      `unwrapSingleListItem(unwrapSingleBlock(block))` 会把列表这一支**短路掉**
      （`unwrapSingleBlock` 对 ul 返 null → 内层直接 null）。
    - ⚠️ **闭合标签定位不许假定贴串尾**：`renderMdHtml` 输出尾部带换行，
      `endsWith("</ul>")` 判据会漏判整条链；按 `lastIndexOf` 取闭合标签
      起点（其后再校验只余空白）。
    - ⚠️ **`li` 开/闭合位都取 `exec` 的 `index`**（regex `exec` 的 index 恒落在
      标签的 `<` 上）：开标签正文起点 = `index + m[0].length`、闭标签终点
      = `index` 本身。给闭合位加长度会把 `</li>` 留在正文里（剥壳整链失效）。
    - 单测在 `quiz/service/optionCompact.test.ts`（单项 ul/ol 剥、带属性标签剥、
      多项不剥、li 内多块不剥，共 4 例）。

（以上三节自 AGENTS.md 移动端小节移入，20260915 拆分；原提交 466817b。）

- **移动端必须做展示层选项洗牌**（Issue #131 P1，20260915 审查定案）：
  `MobileDrill.start()`（含 `continue` 恢复分支）与 `retryWrong()` 都对
  **list 副本**跑 `shuffleListForDisplay`（`quiz/render/CardDisplayShuffle`
  复用，不在本域另写一份）。原稿写「移动端不在本规范范围、不洗即显示死形态
  与预览同口径」——**已作废**：移动端里没有「预览」这个面，用户看到的全是
  「做题」，而新造题按协议「正确项写最前」⇒ 死形态下正确项恒为首位＝剧透。
  洗的是新副本（`ui.fullList` 原件不动），`ui.list` 与 `ui.cards` 仍同下标、
  记账与 `scopeIds` 全按 id 走。
  ⚠️ **单测拆片（Issue #131 收口，#135 行数门禁）**：本域用例原全在
  `MobileDrill.test.ts`——加洗牌用例后涨到 588 行、越过该文件 520 行的豁免
  额度。现拆三片：装配件（judgeGate/AiJudge 闸、假 bank/history、`q`/`make`/
  `buildDeps`/`armed`）收口 `MobileDrillHarness.ts`，洗牌用例另立
  `MobileDrillShuffle.test.ts`，主片只留编排用例 → 409 行。**豁免表里
  `MobileDrill.test.ts` 那条已删**（回落到默认 500 红线）；后来者往任一
  片加用例，超线照旧拆片，别改回豁免。
  ⚠️ **连带口径**：`drill.ui.list` 里的题对象不再与 `ui.fullList` 同一个身份
  ——凡按 `indexOf(q)` 做「题在卷内下标」的反查都会落空（同桌面
  `qIndexById` 那笔）。本域目前按**下标**（`ui.qIdx`）横向移动，不受影响；
  将来加按对象反查的入口，一律改用 id。
