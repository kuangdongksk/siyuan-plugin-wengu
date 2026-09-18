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
- **「继续上次」恢复链（Issue #167，20260917 收口三缺口）**：恢复卡 + 探测
  本来就有，但三条缺口让它形同虚设（用户感知「每次都是新的开始」）。现口径：
    - **探测扫全库、取最近一条未完成轮**（`MobileRound.restoreResumeFor`）：
      原实现恒取**激活题集**（`sets[0]`）的 `docSessions` 最后一条——未完成轮
      不在首个题集时（多套题常态）恢复卡完全不出现；目标题集有**更新的已收卷
      轮**时又被它挤掉（边界 A）。判据收口为
      `MobileRound.isUnfinishedSession` 唯一实现（`!endedAt` + 按块 id 去重
      的 `answered > 0`），**只收清单里还在的题集**（题集已删不出卡）。
      取哪一条：全库未完成轮里 `startedAt` 最大那条（「继续上次」＝最近一次
      断点）；恢复卡是全局一张（设计稿屏 ① 置顶单卡），跨卷时卡上显示目标
      题集标题、分母按**目标题集**算。
      ⚠️ **探测只读，绝不 `selectSet`**（本单返工教训）：原写法在探测里顺手
      切卷面，后果是用户点题集 A 被静默弹到有未完成轮的卷 B——开刷面板的
      题集行「点不动」、「返回题集」也被弹走，选卷入口直接废掉。切卷只发生在
      用户点恢复卡那一步（`resumeRound`）。跨卷要判「可继续」/算分母时，按
      id 现读该卷题清单（`setQuestionsOf`，bank 缓存命中）即可，**别动
      `activeSetId`**。`selectSet` 内也调探测 ⇒ 别在 selectSet 里再写一份。
    - **恢复路径以恢复卡携带的会话为准，禁二次探测**（`resumeRound()`，
      异步）：跨题集先 `selectSet` 装载，再 `startRound(this, "continue")`。
      `startRound` 开头就把 `ui.resume` 抓进局部变量，装载段的重探测改不动它；
      点击恢复不得走重探测（边界 A 会把 resume 抹掉 → 退出「继续」退化成新开）。
    - ⚠️ **恢复路径不许再 `history.upsert(session)`**：upsert 是「按 id 整段
      换对象」，重放一份刚读出来的旧快照会把**同 id 那条的新态盖回去**（陈旧
      覆盖；同进程共用一个 store 实例时尤甚），而且恢复本身零字段变化、白写
      一遍整文件。会话已是权威现场 ⇒ 只有 fresh 开轮才 upsert。
    - **`scopeIds` 快照只给「本次题数」裁剪轮写**（`beginFreshRound`）：
      `setup.count > 0` 且真的裁掉题才写；全量与桌面 `scope === "all"` 同口径
      **不写**（不写 = 存量行为，恢复侧空 ids 走全量兜底，零迁移、不 bump
      version）。不写则「选 20 题答 8 题退出」恢复成全量卷、排列也变。
    - **落点 = 首道未作答题**（`firstUnansweredIdx`，A3）：恢复后 `qIdx` 定位
      到恢复后 cards 里第一道 `!graded` 的题；答满未交卷（after 模式）无未作答
      可落，维持第 1 题。
    - **恢复卡展示料收在 `ui.resumeView`**（`MobileResumeView`：题集标题 /
      已答 / 本轮题数），由探测写入、组件只读——组件原先自己按
      `activeSetTitle` + `fullList.length` 拼分母，跨题集时那是错的（分母
      必须按**目标题集**的题清单算）。
    - **跨卷恢复一律走 `resumeRound()`**：`startRound` 只认「属于当前激活
      题集」的 `ui.resume`（跨卷会话的题清单还没装载，直接恢复会拿错卷的
      `fullList`）。`resumeRound` 先判目标题集是否还在清单里（题集在探测后
      被删就清卡返回，不开空卷），再 `selectSet` 装载，最后才开轮。
    - **落点分工**：起轮 / 恢复 / 关轮全在 `core/MobileRound.ts`
      （`MobileDrill.ts` 余量仅 9 行，只留薄转发；`MobileDrill` 里没有开轮
      逻辑了，改开轮去 `MobileRound.startRound`）。用例
      `mobile/core/MobileDrillResume.test.ts`；夹具 `MobileResumeMock.ts` +
      `MobileDrillHarness` 的 `seedSet`（假题库走**真** `setQuestions`，题面经
      `parsedOf/cacheParsed` 预置，不拼 kramdown）。

- **空轮静默关轮（Issue #158，对齐桌面 #155 块 A）**：移动端有**独立的收卷守卫**
  （`MobileDrill.requestEnd`），#155 只改了桌面 `finishRoundGuarded`，移动端原样停在
  #147 的旧拦截口径（通知 `endRoundEmpty` + 不收卷），「进来不想做、直接关掉」被挡
  （用户原话不分端）。
    - 现 `requestEnd` 的 `answered <= 0` 分支调 `MobileRound.closeEmptyRound(this)`
      ——收卷生命周期在 `core/MobileRound.ts`，函数式友元（同 `MobileAnswering`
      口径；**不是** `MobileDrill` 的方法）。**与桌面 `RoundReport.closeEmptyRound`
      同语义**按本域状态机落地：清 session/resume + 抹 `history.removeSession`
      （`start` 已 upsert 的 0 作答记录）→ 停表 → 退态（清
      cards/list/elapsedSec/confirmEnd/drawer/matOpen）→ 回开刷面板
      （`screen="home"`）+ 重探测未完成轮。⚠️ 判据 `answered <= 0` 与桌面
      **是有意的两处重复**（本域拿不到桌面 `ctx`），改一处必须同步另一处。
    - ⚠️ **移动端没有 `emptyRound` 这个符号**：判据就内联在 `requestEnd` 一处
      （与桌面 `emptyRound(ctx.session)` 是两条链、不同名不同物）；入口也**只有
      `requestEnd` 一个**（`DrillScreen` 交卷钮 / `NumDrawer`「交卷」都调它）。
      别在别处再写第二份 `answered <= 0`——写在 `closeEmptyRound` 里同样违规，
      契约测试会数源码里该表达式的出现次数。
    - **i18n `endRoundEmpty` 已删（中英各一处）**——移动端对齐后全仓零引用，
      按 design-spec §8.4 死键口径两语言同删；契约锁在
      `quiz/render/RoundReport.contract.test.ts`（源级断言 + 字典零残留）。
      别把键加回来，也不要新造同义键。
- **交卷不得静默丢弃「已选未确认」**（Issue #164，#105 × #158 的组合陷阱）：
  用户按「点选项=已答」的心智刷完直接交卷 → `answered` 仍是 0（#105 只落选择态）
  → 被判空轮 → `closeEmptyRound` 连开轮 upsert 一起抹掉，**无报告、无提示、
  history 零痕迹**。修法两条：
    - **判据收口**：`MobileAnswering.isPickedUnconfirmed` 是「已选未确认」的
      **唯一实现**（按 `answerKindOf` 形态分派：choice→`letters`、judge→`judge`、
      text/fill→`mine`，且 `!graded/!revealed/!locked/!selfOn`；slots/plain
      不算——移动端没有「去确认」这个出口）。**别在第二处再写一份选择态判定**，
      契约测试会数落点（`RoundReport.contract.test.ts` 的「判据单一实现」例）。
    - **交卷给明确去向**：`requestEnd` 分流次序**不许挪**——① 有已选未确认
      （>0）先弹第二态弹层（`ui.endPickedN`，即使/收卷两模式同口径），
      ② 再判 `answered <= 0` 静默关轮（真·空轮 #158 **零回归**），③ 正常收卷。
      弹层两钮：「去确认」定位到第一道该类题（选择态原样保留）、「按当前已选
      交卷」把这批已选走**既有提交链**（`MobileAnswering.submitPickedUnconfirmed`
      → `submit`：判分/会话 upsert/题库镜像全在那条链上，**不新开第二条记账
      路径**）后收卷出报告。
    - **守卫整体外移 `core/MobileEndGuard.ts`**（函数式友元，同 `MobileAnswering`
      口径）：`MobileDrill.ts` 无豁免、500 行红线，说明一写就长；`MobileDrill`
      只剩转发（`requestEnd` / `goConfirmEndPicked` / `endNowPicked` 三个入口）。
      ⚠️ 移动端收卷入口**仍只有 `requestEnd` 一个**，转发不等于多开入口。
    - ⚠️ **`endNowPicked` 里别先清 `endPickedN` 再补记**：清了之后补记路上的
      任何一次 `requestEnd` 都会把整轮判成空轮再抹一遍（本单首版就栽在这，
      补记→清态→收卷的顺序不能换）。收卷走 `endRound()` 直调——用户已在弹层上
      表态，再回 `requestEnd` 会多弹一次确认；即时模式补记末题会由
      `checkAllDone` 自动收卷，故那句加 `endedAt` 判据防重复收卷。
    - 禁区照旧：桌面链（`finishRoundGuarded`）不动；`closeEmptyRound` **执行体**
      语义不变（只升级调用侧判据，别往里塞 `endPickedN = null` 之类的写入，
      契约测试会扫执行体）；`endRound` 的揭示/镜像编排不动。
    - 用例在 `mobile/core/MobileDrillEndGuard.test.ts`（装配件仍走
      `MobileDrillHarness.ts`）：只点选→交卷不关轮+弹层、补记与逐题确认**逐字
      同账**（会话 results/answered/correct + 题库镜像全等）、去确认回题、
      真·空轮仍静默关轮、多选部分勾选同口径，另加「形态口径」参数化例。
      ⚠️ 用例取正确字母一律按**洗牌后的视图**（`drill.ui.list[i].answer`），
      别写死 `"A"`（#131 洗牌后正确项位置随机）。
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
    - ⚠️ **选项正文剥层口径（Issue #163，20260916）**：移动端 `QuestionBody`
      的选项正文必须 `optionInline(optionDisplayMd(md))`，与桌面 `optionRowHtml`
      **同序**——少剥一层时 `- A. A. ①③` 的列表标记与两层字母标签全进正文，
      叠加按钮自画字母键后洗牌错位（真机 `C D D xxxx`）。`stripOptionLabel`
      连续剥层**封顶 3**（`OPTION_LABEL_MAX_DEPTH`）：政治五套题双标签形态
      2411 行为主流，双标签一遍剥净，再高就与「正文本身是字母串」界限模糊。

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

- **弃轮擦除 + 未完成轮判据收口**（Issue #169，20260918）：
    - **做题屏左上返回 = 弃轮**（移动端的「切卷」入口就是它，`backHome`）：
      原实现**只退屏**——`ui.session` 留着、盘上那条停在开轮 upsert 的形态。
      有作答时无害（探测仍能找回，「继续上次」）；**一题没答就是永久孤儿**：
      探测不收 0 作答的轮（判据 `answeredQuestionCount > 0`）、没有任何入口
      再擦它，`history` 里就留下「开轮没答题」的孤儿占位（真机
      `set-mu3s2jbi-i63c` 的 `mu5fzmhp-9lb9ni` 即此形态）。
    - 修法：`MobileRound.dropAbandonedRoundIn(d)` 挂在 `backHome` 首行，
      **只擦「不可恢复」的轮**（`!s.endedAt && answeredQuestionCount(s) === 0`
      才 `removeSession`）。**有作答（含「不会」）的轮一条都不许擦**——那是
      「继续上次」的依托，擦掉就是静默丢进度（比多一条空轮严重得多）。
      判据与查找原语都在 `quiz/service/ResumePicker`（下条），本文件只留执行体。
      ⚠️ `backHome` 也服务报告屏（`screen="report"`、轮次已收卷）⇒ 执行体按
      判据空操作，**不要**在 `backHome` 里无条件 `removeSession`。
    - **卸载结算（`MobileDrill.destroy` → `MobileRound.settleOnUnmount`）**：
      与返回键**同病同修**（离屏不擦＝0 作答那条永久孤儿），一律取
      `ResumePicker.isAbandonedRound`。⚠️ 与桌面 `finishSession` 的**差异是
      有意为之**：桌面切卷＝**封卷**（写 `endedAt`），移动端离屏＝**留作未完成
      轮**（不写 `endedAt`，有作答的轮只结算用时）——别为「口径一致」把移动端
      改成封卷，那会把「继续上次」的依托写成已收卷轮。
      ⚠️ **接线（Issue #173，20260919）两条路各自必达、互不触发**——
      Svelte 的 `unmount()` 只销毁组件、**不会**调用 dock 的 destroy 回调：
        1. **就地卸载**：壳组件 `MobileApp.svelte` 的 `onDestroy` →
           `drill.destroy()`（**真机实际销毁路径**：`Docks.mountMobileDrillView`
           的 `drillUnmount?.()` 走 Svelte 卸载，dock init 重入与面板重建都在
           这条线上）。放在组件里才覆盖得到「init 重入先卸旧实例」这步。
        2. **远端卸载**：`Docks` 的 dock `destroy` → `drillCtl.destroy()`
           （模块级控制器引用，`drillUnmount` 旁一路）——dock 侧兜底路。
           ⚠️ **取实例的键名是这套接线的既踩坑**（#173 首版）：组件导出的是
           `export const ctl`，而 `Docks` 当时读 `mounted.app.drill` ——错位后
           `drillCtl` **恒为 `undefined`**，兜底路**整条静默死掉**，且
           `mobile/index.ts` 的 `as unknown as MountedSvelteApp<{drill}>`
           把这处不一致声明成了合法类型、字符串级契约断言也照旧通过。
           现由三层各锁一道：`mobile/index.ts` 的 `MobileAppExports`（收口层）、
           `Docks` 的 `mounted.app.ctl`、以及 `RoundReport.contract.test.ts`
           里**真编译**（`svelte/compiler` 取 `$$exports` 键集）比对的源级断言。
           改任一处的键名，三处必须同步。
           故 `MobileDrill.destroy` 必须**幂等**（停表幂等、`ui.session` 已清即返回）；
           `Docks` 的 `mountMobileDrillView` 一律**先结算后卸载**（先 `drillCtl.destroy()`
           再 `drillUnmount?.()`，否则卸载函数会误结算刚挂上的新实例空会话）。
           **走秒 interval 一并清零**：`settleOnUnmount` 第一句就是 `stopTicker()`。
           单测在 `MobileUnmountSettle.test.ts`（自 `MobileDrillResume.test.ts`
           拆出的卸载专片，含注入走秒替身断言 `clearInterval` 被调）；源级契约
           （两条接线路 + 擦除只在 `MobileRound`）锁在
           `quiz/render/RoundReport.contract.test.ts`。
           ⚠️ **走秒 interval 的宿主可注入**（`MobileDrill` 构造第三参 `TickHost`）：
           node 环境无 `window`，不注入时起不了表、「卸载必达 stopTicker」就无法
           从外部观测（真机不传此参，行为逐字不变）。
    - **恢复探测「无此病」的结论已用用例锁住**：探测是「全库扫 + 只收未完成
      轮」，空轮（弃轮 / 收卷空轮两形态）连候选都进不来，不会把前面「有作答且
      未收卷」的轮挤出候选 —— 与桌面开刷面板「只看数组末位」的坑不同源。
      用例在 `MobileDrillResume.test.ts` 的两组（尾随空轮 + 弃轮擦除）。

- **「未完成轮」判据与候选查找**（Issue #169）：判据（有作答且未收卷）与
  「从尾向前找第一个命中的轮」收口到 `quiz/service/ResumePicker`
  （`answeredQuestionCount` / `isUnfinishedRound` / `lastUnfinishedRound`）。
  本域 `MobileRound.isUnfinishedSession` 只剩**薄转发**（导出名自 #167 起
  被切片用例取用，不改名）。**别再在探测里自写一份 `!endedAt && resultsByQid`**
  ——契约测试（`quiz/render/ResumePicker.contract.test.ts`）会红。
