# src/quiz/ —— 做题主流程

- **对稿还原（Issue #135，20260915）**：侧栏/题号栏/头部统计条/题卡/chips/
  自评五星按 `design/sidebar-gap-list.md` §0–§4 与 §7.a/b 逐值落地，规格锁在
  `quiz/render/WorkspaceDesign.test.ts`（scss 真编译 + 组件 `?raw` 断言
  **规则在场与值**，不钉分片落点——拆片是后续批次自由）。落点要点：
    - **`--wengu-faint` / `--wengu-border-strong`** 定义在 `scss/base.scss`
      顶部 `:root`（§0 派生档：b3 无「比 on-surface-light 再弱一档」的字色，
      强调边同理），全仓复用（题号栏/侧栏/五星/chips 都吃它）。
    - **题号栏三层结构**（`NumRailApp.svelte`）：常驻帽 `.wengu-nums-cap` /
      自滚网格 `.wengu-nums-grid`（**滚动职责从 `.wengu-nums` 下放本层**，
      帽与图例常驻不滚）/ 常驻图例（`revealed` 才补对错两项）。内滚窗
      **不显滚动条**（用户 20260915 拍板；`scrollbar-width:none` +
      `::-webkit-scrollbar`）。`--wengu-nums-max` 封顶逻辑不变——它在栏的
      border-box 上，新增 12px 内衬天然计入。
    - **样式拆片**（红线收口，§11.1）：题号栏 → `scss/nums.scss`、
      考点行/五星 → `scss/card-extra.scss`、侧栏 → `scss/side.scss`。
      三者都要在 `src/index.scss` 里 `@use`。
    - **自评五星数据落点＝会话记录 `WenguSession.selfStars?: Record<qid,1..5>`**
      （§7.b 方案 1，用户已拍板）：读写收口在 `flow/AnswerFlow.ts` 的
      `selfStarsOf` / `setSelfStars`（**再点同值＝删键，不是写 0**——两态在
      存储上必须可分），每次评分即 `host.persist()`。loader 侧零迁移
      （旧会话无该键 ⇒ 全未评），**不 bump version**。题库沉淀（方案 2，
      错题本迷你星回显）留后续迭代。
    - **考点 chips 的防剧透闸**＝`.wengu-card.wengu-revealed`（挂 graded 会
      在 after 未收卷时提前泄题，同 `.wengu-card-title` 口径）；整行不出而
      非留白。点击出口＝`StatsViewAccess` 的考点视图（`searchKcapFor`，
      经 `flow/SideMount.kcapSearchFor` 薄引用）；不传 `kcapSearch` ⇒ 降级
      纯展示 chip（预览/复习等只读壳）。
    - **侧栏 AI 入口**：`.wengu-side-ai` 经 `sideActFor` 的 `side-ai` 分支
      落 `switchWorkspace("ai")`（rail 已存在的 AI 工作区，不新造面板通道）。
- **阅读组可拖分隔条（Issue #138，20260915；§6.1 + §7.c）**：材料区高度
  从「固定 52vh」改为可拖（antd Splitter 语义）。落点要点：
    - **纯逻辑在 `quiz/flow/MaterialSplitter.ts`**（带单测）：约束
      `MAT_MIN_PX=160` / `matMaxPx = min(75vh, host 高)` / `clampMatCap` /
      `ratioOf`·`pxOfRatio` / `normalizeMatRatio`，另加持有物
      **`MatSplitPrefs`**（`restore`/`write`/`snapshot`，夹取与「值未变不落盘」
      守卫都在它里面）。
    - **为什么多一个持有物类**：`quiz/index.ts` 的 574 行豁免**额度＝上限**
      （#138 实测：直接往视图塞字段 + 读写守卫会顶破 590/577）。照
      `ConvertAccess` 先例切片，同时把 `persistPrefs` 的快照组装外移
      `service/QuizLoader.prefsSnapshotOf` ——视图侧只剩 `matSplit` 一个字段、
      `setMatCapRatio` 一个薄访问器、`persistPrefs` 三行。
      **后续再往 index.ts 加持久化字段，先照这个切法走，别硬塞。**
    - **基准口径三条（复核二轮实测的三处静默失效，别改回去）**：
      ① 上限 `matMaxPx` 的 `hostPx` ＝**材料区所在列**（`.wengu-main`）可用高，
      不是材料区自身高——自指基准下放大必被 clamp 压回当前值（只能缩不能放）；
      ② 比值分母/乘数 ＝**视口高**（0.16–0.75 与上限 75vh 同源），用列高做分母
      时拖到上限得 ≈0.9、越界判脏 ⇒ 写盘静默丢失；
      ③ 键盘起点 ＝**量算实值**（`capPx ?? matEl.clientHeight`），不是持久化
      比值折算（未拖过时折算得 0，首键把材料区拍到下限）；映射收口纯函数
      `nextMatCap`（带单测）。写侧 `clampMatRatio` 夹进区间、读侧
      `normalizeMatRatio` 越界回默认（写=意图合法化，读=存量可信度检查）。
    - **双击复位要「清内联 + 清库」**（`setMatCapRatio(undefined)` =
      `MatSplitPrefs.write(undefined)` 显式清库）：只清内联的话下次装载按旧
      比例折算回来，「复位」是假的。`write` 的 `undefined`（复位）与脏值
      （被拒、不动已有值）是两回事。
    - **`resize` 先重夹取再重量**（`reclampCap` → `syncMatScroll`）：窗口变矮时
      内联 px 会越出 `min(75vh, 列高)` 上限（装载只折算一次）。
    - **内联变量写在 `.wengu-gmat` 自己身上**（`matEl.style.setProperty`）：
      `52vh` 定义在父级 `.wengu-gmat-host`（reading.scss），`var()` 由子级消费
      ——自身声明才压得过继承值。装载恢复（`restoreCap`）必须在**首帧量算前**
      写完内联，否则先按 52vh 量一遍再改，`cap`/`fading` 会闪一次错判。
    - **拖动不触发 resize** ⇒ `pointerup` 的收尾里**必须手动补一次
      `syncMatScroll()`**（§7.c 明写；漏了渐隐会滞留在拖动前的高度）。同函数
      还摘 body 全局类（`.wengu-splitting` = 全局 row-resize + 禁选）。
    - **手柄闸＝`!collapsed && (cap || capPx !== null)`**：短材料没可调高度，
      出手柄就是骗人；独立题卷结构上没这一层 ⇒ 零 DOM 变化。`capPx !== null`
      这条**不能省**——拖大后内容不再溢出 ⇒ `cap` 翻 0，只认 `cap` 的话手柄
      当场卸载、用户再也缩不回来（棘轮死锁，复核实测）；`data-scroll-cap`
      同闸（否则内联 px 没处生效）。
    - **材料区滚动条已改成「不显示」**（验收 5；`scrollbar-width:none` +
      `::-webkit-scrollbar{width:0}`，两条都要——只写一条在套壳内核里会露出来）。
      原先「hover 才显形」的细条口径作废。
    - **i18n 键** `matSplitTitle`（手柄 title/aria-label）；规格锁在
      `quiz/render/MaterialSplitterDesign.test.ts`（scss 真编译断言三态值 +
      组件 `?raw` 断言接线 + Svelte 真编译零 unused 选择器）。
      样式留 `scss/reading.scss`（§13.3 登记的共享片，① TS 触达）。

- **本轮复审纠偏（20260915 二轮，五处真机级；复审 PR #140 时逐条实测发现）**：
    - **自评行是「加」不是「换」**：五星掌握度与既有「我答对了/我答错了」
      **并列**在同一 `.wengu-self` 行内。删掉对错钮会一次打断三条链——
      契约三点六的 brief **改判入口**、AI 判分失败**补账**（`judgeBriefAnswer`
      catch 的 `showSelf`）、缺题型/答案的**降级自评**（`submitQuestion`
      的非 objective 分支）。**五星只是新增维度，不承载记账**。
    - **题号栏图例的揭示闸必须可运行期升级**：`revealed` 只作 props 初值
      不够——after 收卷（`revealAll → revealCard`）发生在壳存活期间、不重建
      组件，图例永远停在「作答中」。现走 `markNumRailRevealed()` 响应态，
      并在 `revealCard` 里调用（instant/after 两路都过它）；壳重建那一路
      的初值补 `|| !!currentSession()?.endedAt`（收卷后切工作区/折叠侧栏会
      `renderList`，不补就退回「作答中」而卡片已揭示，两处口径打架）。
    - **「第 N 轮」序号不能用 `rounds.length`**：它是装载时的历史快照，
      `startRound` 只 upsert 落盘、不追加进数组 ⇒ 新轮少报一轮、
      「继续上次」多报一轮。按 id 定位（`SideMount.roundIndexFor`，纯函数带测）。
    - **考点 chip 首点会静默失效**：`StatsCtl.attach` 在组件 `onMount`（Svelte
      排微任务）里，而「面板没开→顺手开→立刻检索」的那次 `loadKcap` 必早于
      attach（`ui` 还是 undefined）⇒ 浮层开了却停在常规详情页。现以
      `pendingKcap` 兜住，attach 时补做。
    - **`kcaps` 必须去重**：`knowledge` 与 `chapter` 同串时，带值 key 的
      `{#each kcaps as k (k)}` 会抛 `each_key_duplicate` **整卡崩**
      （Svelte 内核对带值 key 撞键是硬抛，非警告）。
    - **组件文案一律 `t()`**：题号帽/省略行/图例六处字面中文已清（英文环境
      原样显示中文）；新增 i18n 键 `numsCap` / `numsMore` / `numsLegend*`。

- `index.ts` = QuizView 编排（561 行；Issue #12 起记账镜像
  外移 `service/AnswerMirror.ts`、销毁清单外移 `flow/Teardown.ts`、
  右键弹窗动作外移 `service/DocActions.ts`）。**访问器表 + 编排职责
  外移的两难仍在**：再加功能先看有没有能外移的成块职责，别再净增。
- **开刷面板（首屏）照设计稿屏①：双卡片 + 唯一主操作**（Issue #100，20260915）：
  `quiz/components/StartPanelApp.svelte` 是**纯展示层**——「进度与范围」/「作答设置」
  两张独立卡片（卡头在卡内带小图标、行内缩归零走卡内衬 + 行间分隔线），
  **「刷题范围」行恒渲染**（旧「未完成轮 **或** 有错题才出整卡」已废，最少只有
  「全部题目」一项）；「上次进度（继续上次）」仍按未完成轮条件渲染（判据只看
  `endedAt`，见上文）。「开始刷题」是**唯一** `variant="primary"`。动作行
  `gap:14px` 是 §〇6「横向按钮行一律 8px」的**显式例外**（以设计稿为准，注释已写明）。
  头部统计条（`render/CardHtml.renderSubheadHtml`）输出**结构化分段**：段序
  题集名 → 已刷/答对 → 竖线 → 轮次成绩，数字加重 + `tabular-nums`，**竖线只在
  两侧都有内容时才插**（不出现悬挂分隔符）；文案仍全部来自既有 i18n 键。
  结构口径锁在 `render/SubheadHtml.test.ts` 的源级断言里（范围行在条件块之外、
  primary 唯一、两卡两图标），改组件别绕过。
- **揭示态 / 锁定态 / 记账态是三件事**（20260910 Issue #12，最易踩的语义坑）：
    - `ui.graded` = 记账已入（`allCardsGraded`/答满判据）；
    - `ui.locked` = 作答位禁用（**状态级**，重渲染后仍是闸）；
    - `ui.revealed` = 答案/解析可见。题卡类 `.wengu-revealed` 是 **DOM
      钩子**——answer/solution part、`part^="slot-"`、`.wengu-static-sol`
      三处显隐全靠它。
    - **instant / steps / slots（即时判分族）**：判分即到底——
      `CardCtl.setGraded()` 一把置 `graded + locked + revealed`
      （`StepsFlow.finishCard` 与 slots 恢复态同样补 revealed）；
      `revealCard` 是**全形态**的揭示入口（即时/收卷统一/恢复兜底三路
      都过它），进门无条件 `ctl.reveal(submitted)`——不能只给客观题置。
    - **after 模式**：提交 → `setPending()`（只 graded），**locked 与
      revealed 都留到收卷**（`manualFinishRound` → `revealAll` →
      `lockAllCards`）。作答位守卫一律用 `answeredFrozen`
      （`revealed || locked`，AnswerFlow 内私有），**别再写 `ctl.graded`**
      ——那是改造前的旧口径，会把「after 收卷前改答案」一次性打死。
    - CSS 侧同理：**答案/解析显隐只认 `.wengu-revealed`**，`.wengu-graded`
      留着表示「已判分」（steps/slots/instant 卡两者同带）。新增任何
      「作答前不能看见」的内容，钩子挂 revealed 不挂 graded
      ——`.wengu-card-title`（考点标题防剧透，Issue #14）同挂 revealed。
      **揭示态写入点是四类，别只改闸不补写入**：`setGraded`（即时判分族
      一把置 graded+locked+revealed）、`revealCard`（**全形态**揭示入口，
      即时/收卷统一/恢复兜底三路都过它）、`StepsFlow.finishCard` 与
      steps/slots 恢复态——漏一处就是「答案解析整片消失」。
    - steps/slots 卡走自己的即时判分（`StepsFlow`/`SlotFlow` 直接
      `setGraded`），**不参与 after 可改答案**；两卡也不提供跳过/不会
      （作答单位是步/空，语义另议）。
    - **恢复判据＝「这一轮已收卷」而非「答满了」**（`restoreContextFor`
      看 `session.endedAt`）：「答满但未收卷」在 B3 之后是可持久化状态，
      按答满判揭示＝重开页签即泄题 + 编辑窗口关死。恢复卡的锁定只看
      `revealNow`（`ui.locked = revealNow || !batch`），别退回「恢复即锁」。
      ⚠️ 连带口径：**「未完成轮」判据只看 `endedAt`**（`StartPanel` 两处
      `unfinished`）——原先还要求 `answered < 题数`，那条只在 instant 下
      成立，after 答满未交卷的轮会被判成「已完成」而无法「继续上次」。
- **重复提交必须幂等**：after 模式可反复改答案，同题会提交多次。会话侧
  `HistoryStore.pushSessionAnswer` 是 **upsert**（按 qid 原地覆写、
  `answered` 不涨、`correct` 按差值 ±1、三态字段以最后一次为准——本次
  不带就删键，防旧 verdict 残留）；题库侧 `QuizView.recordAnswer` 用
  `results.some(qid)` 先判「是否重复」分流：首次 `recordAnswer`
  （attempts+1），重复 `BankRecording.recordVerifyResult`（覆写
  lastAnswer/right，**不动 attempts**；wrongCount 口径＝曾错不清零，
  由 `applyOverride` 统一）。加任何新记账通道都要过这条口径。
- **答满不等于收卷**（after 模式）：`checkAllDone` 在 after 下只调
  `host.onAllAnswered`（视图侧一次性浮层提示，`renderList` 重置去重标记），
  **不 revealAll**。收卷入口两个、**闸只有一份**（Issue #147）：
  头部「交卷并查看答案」（`endRound`）与倒计时归零时间条「结束本轮」
  （`finishNow` ← `TimerBinder.showTimeUpBar` 的 `onFinish`）都走
- **收卷总结视图（Issue #147 追加 1/2/3，20260916）**：收卷出总结 =
  **题卷收起、总结独占**。三条要一起读，动一条先看另两条。
    - **形态走主区状态类，不做「收题卷容器」**：`.wengu-main` 加
      `wengu-summary-view`（`RoundReport.enterSummaryView/exitSummaryView`），
      CSS 全在 `scss/report.scss` 且**全用子选择器**（`.wengu-main.类
[data-report]` / `.wengu-body` / `[data-timeup-slot]`）——类只挂主区、
      不外溢到题卡内部。⚠️ **别去 unmount 题卡**：题卡是 Svelte 挂载物，
      卸了再挂会丢 Protyle 锚与在途分片（`renderStaticChunked` 的代数守卫
      会作废整批）；藏起来不动 DOM 最稳，摘类即逐字节回原状。
    - **主区本态必须转 flex 列**（`.wengu-main.wengu-summary-view{display:flex;
flex-direction:column}`）：`.wengu-main` 原是块级内滚窗（`base.scss`
      `flex:1;overflow-y:auto`），不转的话 `[data-report]` 的 `flex:1` 无父可依
      ⇒ 撑不开也不敢滚，整页照滚（#96 失效）。
    - **追加 3 的滚动窗落在报告自己身上**（`.wengu-report-scroll`，只在本态
      开 `overflow-y:auto`）：这是「报告区自身内滚」的直接落点，也是追加 2
      「滚回报告顶部」能成立的前提（题卷态下报告是内容高度、不可滚）。
      各区块 `flex:none` 按内容定高（1 轮历史 = 一条 4px 小条 + 标签）；
      ⚠️ **卡片本身也是 `flex:none`**（撑满整屏的只有 `.wengu-report-scroll`）
      ——设计稿同为「容器滚、卡片内容高」。卡片设 `flex:1` 会被强压成容器高：
      内容矮则卡片底部留看不见的空白（追加 3 的观感来源之一），内容高则
      溢出卡片盒、滚动窗量不到它（长报告滚不到底）。
    - ⚠️⚠️ **报告滚动窗只能有一个，且标记由组件渲染**（20260916 复核实锤）：
      `data-report-scroll` 写在 `RoundReportApp.svelte` 里，TS 侧只经
      `REPORT_SCROLL_SEL` 查询。**别再在挂载前 `host.innerHTML` 放同标记的桩**
      ——那会在宿主里多出一个空节点：总结态两个 `.wengu-report-scroll` 各吃
      `flex:1` ⇒ 面板被劈成「一半空白 + 一半报告」，且 `querySelector` 命中的
      是排在前面的空桩（`scrollTop` 恒 0）⇒「滚回顶部」静默失效。
      机制：Svelte `mount` 未传 anchor 时把组件 append 到宿主**末尾**
      （`render.js: _mount` 的 `target.appendChild`），桩与真件必然**并列**。
      ⚠️ 行为测试用自建 DOM 桩，**查不出这种「真实 DOM 形态与桩模型不一致」**
      （旧桩就是照「桩+组件窗」两条搭的，把 bug 一起测绿了），故由源码级断言
        - `RoundReportDom.test` 里「复现旧形态 ⇒ 回顶确实失效」的反证兜住。
    - **「回题卷」两个入口必须同一条路**（`RoundReport.backToQuiz`：摘类 + 通知重画
      头部）：报告内那个钮与头部那颗钮在总结态下的语义各是一条**入口**，但**执行体
      只有一个**。任一路只摘类不发通知 ⇒ 头部文案留在「返回题卷」不改（总结已收起、
      钮还在喊「返回题卷」＝文案说谎，再点下去又是重开总结，与字面相反）。
    - ⚠️ **进/退总结态必须与报告宿主显隐成对**（同一函数里改，别分散）：
      `enterSummaryView` 加类 + 摘 `hidden`；`exitSummaryView` 摘类 + 设回
      `hidden`。**只摘类**⇒「返回题卷」后报告卡仍压在卷首（没真收起）；
      **只设 hidden**⇒本片给 `[data-report]` 上了 `display:flex`，作者样式压过
      UA 的 `[hidden]{display:none}`，报告照显——故 report.scss 里有
      `[data-report][hidden]{display:none}` 这条显式关掉（同 base/panels 既有条）。
    - ⚠️ **「报告已出」的判据是报告卡在不在**（`[data-report] .wengu-report`），
      **不是宿主的 `hidden`**：显隐是总结视图态的从属量（退态会设回 hidden），
      拿它当「已出」⇒「返回题卷」后头部读成「还没收卷」、文案退回「结束本次」。
    - **追加 2：已出态点击 = 总结视图开关，绝不重挂报告**。原实现
      `if (this.finished) showRoundReportNow(...)` 是 detach + 重挂同一份报告
      ——**视觉零变化** ⇒ 用户观感「点了没反应」。现走
      `RoundReport.focusFinishedRound`：总结开着 ⇒ 收起回题卷；已在题卷 ⇒
      重开总结 + 滚回顶部 + 叠一次 `wengu-report-pulse` 高亮（animationend
      自摘，连点幂等）。**报告块不重挂**是硬约束（重挂正是「零变化」的来源）。
    - ⚠️ **已出态重进总结：报告节点可能已被卸掉**（整壳重建：`renderQuizShellFor`
      开头 `detachRoundReport`，而 `finished` 仍留着）——此时不补挂就是「题卷被
      CSS 收起 + 空宿主」＝**整片空白**，比「零变化」更糟。故 `focusFinishedRound`
      进态前先判 `[data-report] .wengu-report` 在不在，不在则经 `mountReportNode`
      按报告模型补挂一次（**不走收卷链**：不重复落库/停表/AI 归因）。收卷链与补挂
      共用这一个挂载点，用时快照在**停表前**取。
    - **头部按钮随态换语义**：`mountHeadFor` 按
      `summaryOpen / reportReady / afterMode` 三档取
      `reportBackToQuiz` / `reportShowSummary` / `endRoundRevealBtn` /
      `endRoundBtn`，**不禁用**（项目原则「停止键别 disabled」）。
      `canEndRound` 必须含 `!!v.finishedSession()`——原先只看 `started`，
      收卷即置 false ⇒ 钮直接消失，「点了没反应」的另一半根因。
      切换时经 `bindSummaryToggle` 回调**重挂头部**（本仓无全局 store 约定，
      重挂是既有刷新手段）；⚠️ 重挂后计时器标签会空一拍，故 QuizShell 里
      `mountHeadFor` 之后紧跟的 `v.timerBinder.updateLabel()` **顺序不能动**；
      整壳重建时 `bindSummaryToggle(undefined)` 清掉旧闭包（闭包握旧 subhead）。
    - **after 模式照样进总结态**：`revealAll` 尾段就是 `host.roundComplete()`
      → `showRoundReportNow` ⇒ 同一条链，无分叉。用户看揭示答案要点一次
      「返回题卷」（头部钮或报告内钮，同一条出口）。
    - 规格锁在 `render/RoundReport.view.test.ts`（源级 + Svelte/sass 真编译）
      与 `render/RoundReportDom.test.ts`（极简 DOM 桩跑真行为：`scrollTop`
      判据、脉冲自摘、开关两态）。DOM 桩只实现被调到的 API——`innerHTML`/
      挂载/布局仍归 `RoundReport.view.test.ts`，别在桩里越界造断言。
      `RoundReport.finishRoundGuarded` —— 空轮（`answered <= 0`）**静默关轮**
      （#155 块 A，原 #147 的「通知 `endRoundEmpty` + 不收卷」已被用户走查
      推翻：打开题卷不想做就该能直接关掉），非空轮进 `manualFinishRound`。
      关轮执行体 `closeEmptyRound` 五件：`history.removeSession` 抹掉**开轮时
      已 upsert 的那条 0 作答记录**（只清内存 ⇒ 统计总览轮次数虚增）→
      `discardSession`（清 session、不进 finished）→ `stopRound` →
      退总结态/卸报告 → `rerenderView` 回开刷面板。⚠️ 末尾那次重画不能省：
      `stopRound` 只翻 `started`、题卷壳是整壳重建的，不重建用户看到的还是
      「一题没做 + 题卡锁死」的原状。i18n `endRoundEmpty` **已删（中英各一处）**
      ——#158 把移动端 `MobileDrill.requestEnd` 也对齐到同一语义后全仓零引用，
      按 design-spec §8.4 死键口径两语言同删（本域口径见 `mobile.md`）。
      ⚠️ **别在入口层再写一份 `answered <= 0`**：原实现就是这么漏的——
      `finishNow` 直接 `manualFinishRound`，开倒计时的用户时间一到点「结束
      本轮」，一题没答也收卷出报告（静默、无报错）。新增收卷入口一律调守卫，
      唯一性由 `render/RoundReport.contract.test` 源码级锁死。
      instant 模式照旧 `roundComplete`。
      steps/slots 完成仍靠 `checkAllDone` 凑「全部 graded」信号，别整个删掉。
      ⚠️ 连带口径：**「未完成轮」判据只看 `endedAt`**（`StartPanel` 两处
      `unfinished`）——原先还要求 `answered < 题数`，那条只在 instant 下成立，
      after 答满未交卷的轮会被判成「已完成」而无法「继续上次」改答案。
      `lockAllCardsNow` 是**状态级 + DOM 级双管**（`ui.locked` 是真闸）。
- ⚠️ **报告用时的合并在 `ai/prompts/judge.ts` 的 `byBaseQid`（跨域：quiz 图表 + ai prompt 同源）**
  （Issue #177，20260919）：报告图表（`RoundReportApp` 的每题/分组柱）与判卷 prompt
  的每题行、知识点归组**共用这一个聚合**，`sec` 三态口径只此一处：
  `>0`＝各步都记到用时之和 / `0`＝**未记录** / **绝不出 `NaN`**。
  踩坑原文：旧实现 `(cur?.sec ?? 0) + r.sec` 在单步题缺 `sec` 时即
  `0 + undefined = NaN`，而 **`??` 不吃 NaN** ⇒ 图表 tooltip 出「用时 NaN:NaN」、
  柱高算出 `height:NaN%`（非法值被浏览器静默丢弃，**整张图相对高度集体失真、
  看着像「柱子一样高」**），prompt 侧则字面印出「NaNs」。
  **改这个函数时先跑 `ai/prompts/judge.test.ts` 的「绝不出 NaN」组**
  （全形态单一断言兜底）；图表侧另有出口归一 `TimeBars.secOf`（非有限值按 0），
  两道都留——源头修，任何新调用方传脏值也不坏图。
- ⚠️ **汇总用时是另一条通道，20260920 一并收口（别只修逐题就以为完了）**：
  `totalSec` ← `RoundReport` 的 `ctx.timer.elapsed()` ← `TimerController.baseSec`
  ←「继续上次」传的 `unfinished.elapsedSec`，即 history.json 里可手改 / 可跨版本
  同步的字段（`JSON.parse('{"elapsedSec":1e999}')` → `Infinity`，**落盘层无闸**）
  ⇒ `totalSec = baseSec + sec` 恒非有限，`mmss` 只夹 `Math.max(0, …)`，旧实现
  印「总用时 Infinity:NaN:NaN」。**修法只落出口**（`judge.ts` 的 `secFinite` +
  `RoundReportApp` 模板的 `Number.isFinite`），**不碰** `HistoryStore`/`RoundSeal`
  的存量写法与 `start()` 形参语义——那会踩数据演进守则。`overtimeSec` 同形收口
  只作**一致性锁**（`tick()` 整数计数器、不落盘，当前不可达，别虚报成缺口）。
  ⚠️ **别把 `mmss` 本身改成夹 `Number.isFinite`**：它是全仓共享格式化器，脏值的
  责任在「谁把它送进 mmss」这层。锁在 `ai/reportAiNan.test.ts`（prompt 侧）
    - `render/RoundReport.view.test.ts`（组件源码级 + 真 `TimerController` 跨模块链）。
- **跳过是「没来过」**：`skipQuestion` 不记账不锁卡不揭示，只
  `onActiveQ` + `focusQuestion` 滚到下一题；末题零动作。「不会」才记账
  （`submitted=""`，objective 与 brief 都直接判错，brief **不调 AI**）。
  「不会」在 instant 下仍补答案行（别整条 `setResult` 盖掉答案）；
  brief 提交路径有 `judging` 单飞闸（after 不锁卡 + 判分异步 ⇒ 连点会
  并发两次 AI 判分，重复烧调用）。
- **steps 也有「跳过 / 不会」**（Issue #21；slots 维持现状不给）：跳过复用
  `skipQuestion`（对题型无感）；「不会」走 `AnswerFlow.dunnoSteps` → 与普通卡
  共用的题级收口 `dunnoCard`（题级空串记一错，instant 全步一次揭示 + 锁卡 +
  `dunnoMarked`，after 只置 graded 可反悔）。**只写题级账、不逐格写空串**
  （步骤没答过就不该有逐步记录）——恢复时题级账与逐步账分账
  （`render/CardSteps.stepsBand`）：题级空串 = 主动认输 → 已收卷全步揭示 /
  after 未收卷只认「已作答」且**步格保持干净未作答态**（让步格亮答案就是
  部分步有内容、部分步空白的半揭示），逐步账一律滤掉空串。
    - **步态整体外移 `render/CardSteps.ts`**（Issue #21 复审；CardState 曾
      涨到 575 行破 500 红线）：步快照/分账/落格/实时步全在这，CardState
      只留 `buildCardInit` 分派。`settleSteps` 是**唯一**给步格写 disabled
      的地方——组件 `.wengu-step` 的闸只看 `step.locked`。
    - **兜底揭示不许覆盖已落格**（复审真机级缺陷）：`revealStepsCard` 既是
      当场收口的尾段、又是收卷统一揭示/恢复/「不会」的兜底。`settleSteps`
      无快照时**只补未落格的步**（旧实现在此按「空串 + 全错」重写，真机
      表现为「多步题答完答案行全变错、申诉基线被清成 0000」）；`stepOks`
      也只按实际逐格态回写，不写「全错」占位。
    - **after「不会」可反悔要认对闸**（复审真机级缺陷）：`StepsFlow` 的步内
      守卫从 `ctl.graded` 改看 `ctl.ui.revealed || ctl.ui.locked`
      （`stepsFrozen`）——「不会」在 after 只置 graded，挂 graded 会让点完
      「不会」的题再也答不了（与验收 4 直接冲突）。同理收口闸、申诉钮也按
      此口径：**没答过的步不挂申诉钮**（复核「你选的这一步」无意义）。
      反悔改正常作答后题级空串账就地覆写（`recordAnswer` + `bankOverride`，
      走「覆写」口径不动 attempts），否则收卷报告按「曾认输」计错。
- **词表区与正文词形联动**（Issue #30 渲染侧；Issue #53 三期收拢）：
  **装饰出口** `quiz/service/MaterialDecorate.decorateMaterialEntry` 是材料/
  题干挂载的**唯一**出口——材料正文（含尾部 `@@G` 行）进去，模块内部按
  「① 基础渲染 + 词表区 → ② 权威节点表 → ③ 词形联动 → ④ 轮间重算映射 →
  ⑤ 线索 mark 坐标施工」编排；消费侧**只喂数据**（`md` / `gloss` / `clues`），
  不再自己拼调用步骤。词表区分工两块：**数据与 DOM 契约**在
  `quiz/service/GlossDom`（`splitGloss` 拆正文/词表、`dataGlossTableHtml`
  出 `ul.wengu-gloss`——词条下划线/音标弱化/释义常规），**施工**在装饰层
  （正文里与词表词形精确匹配的**首次**出现包 `span.wengu-gloss-link > u +
sup`）。样式在 `scss/english.scss` / `scss/english-gloss.scss`（整改 F1 #127
  由 564 行 english.scss 按语义拆出两片，类名与规则零变更）；改动类名必须同步装饰层的
  `NON_CANON_SELECTOR`/`NO_WRAP_SELECTOR`（`ul.wengu-gloss` 是契约）。
    - **挂载顺序是「实现保证」不是「调用约定」**（Issue #53 验收 4）：词表
      区与词形联动必在 ② 之后、⑤ 之前，由出口内部固定；`GroupUnitApp` 的
      「材料填充 + 线索刷新」两段调用已合成**一次** `decorate`（连线索锚点
      一起铺），`ProtyleHost.mountStatic` / `QuizCard` 走
      `decorateMaterialEntry`。`refreshClueMarks` 仍保留为**幂等**的 chips
      兜底（材料缺失/无题干通道不进出口）。
    - **与 #29 线索 mark 是「单向嵌套」**（Issue #51 改写 #33/#34 的「互不
      嵌套」条目）：嵌套由装饰层**一次施工**保证——词形 `<u>` 内的文本是
      权威（`<u>` 包的就是原文本身），上标是非权威（`NON_CANON_SELECTOR`
      剔出、落格时再由 `NO_WRAP_SELECTOR` 挡「不许被包」）；`ClueMarkDom`
      的 `SKIP_SELECTOR` 只是 fallback 文本匹配的源名单，**不是**施工名单。
      即 **mark 可进 `<u>`、词表永不包 mark**，嵌套只单向发生。
    - ⚠️ **跳过口径直接决定匹配文本源**（Issue #51 真根因）：`SKIP_SELECTOR`
      多排除一个类 = 该类文本从匹配源消失——`textNodesOf` 的 haystack 少了
      那几个字，含它的选段子串匹配必败、静默降级只留 chip。本次缺陷即
      `.wengu-gloss-link` 混进跳表（`<u>` 包的就是原文本身）。偏移缺失只
      发生在被排除处、之前的内容照常高亮=「缺一段」（不是「多一段」）。
      `SUP_SELECTOR` 是**落格守卫**：只挡「不许被包 mark」、不挡匹配，
      两类判定别混用。两侧 `textNodesOf` 的跳表都别顺手加类。
    - ⚠️ **REJECT/SKIP 对 `SHOW_TEXT` 的文本节点等价**：`createTreeWalker`
      的 filter **只对通过 whatToShow 的节点调用**（SHOW_TEXT ⇒ 只有文本
      节点），而 REJECT 的「连子树一起拒」语义只对**元素**成立——文本节点
      没有子树，故与 SKIP 行为完全等价（jsdom 26 与 linkedom 0.18 双引擎
      实测节点表逐字节相同）。生产代码保留 REJECT 只是**防御性口径**：防未来
      whatToShow 放宽或对元素判定时误用 REJECT 连子树一起拒；本条缺陷的成因
      是跳表内容，改它（REJECT→SKIP）是 no-op。
    - **幂等与重铺**：装饰出口整段重铺（先摘旧 mark / 旧联动标记再铺），
      带词材料重铺会连带抹掉线上 mark，靠同一次出口施工**一步到位**（词表
      ③ → 线索 ⑤），别再加第二通道。`redecorateClues` 是「只重铺高亮、不
      动正文」的入口（chips 增删后调用）。
    - `^{...}` 渲染兜底在 `ui/MdRender` 的 `wengu_kram_sup` inline 规则
      （tokenizer 级，代码围栏内不受影响）——漏网的 `^{补}` 出 `<sup>` 不出
      字面文本。
    - 无词表材料走原路（`root.innerHTML = renderMdHtml(md)`），存量渲染产物
      逐字节不变。
    - ⚠️ **落格映射必须一次性算好再「倒序」施工**（`assignHitsToNodes`，
      纯函数带单测）：偏移口径是**全部文本节点原文的拼接**，正向施工会
      把同一节点内的后一处命中推出已被 `splitText` 截短的节点——表现为
      「只有每段首个词形高亮，其余静默不落格」。故先按未改动的节点表算
      `{node, from, to}`，再按命中下标从后往前包。
    - ⚠️ `planGlossLinks` 每词只取**首次**出现是**按单个词**算的（首词之
      后的词各自取其首次），不是「全段只标一处」。

- **新增按钮要同步三处清理面**：预览装饰（`PreviewFlow` 摘
  `[data-submit-row]` 整行）、渐进呈现（`wengu-previewing` 的
  `pointer-events:none` 名单）、预览的 DOM 手术清单——漏一处就是
  永久不可用的死钮。
- **滑选标注（Issue #28）**：可标区域两态——组题=材料面板，非组题=
  题干区 `.wengu-qprotyle`（浮条按钮按选择位置分流）；**高亮施工**收口在
  装饰出口（`MaterialDecorate.decorate`/`redecorateClues`，Issue #53），
  `ClueFlow.refreshClueMarkFor` 是它的调用侧（题干挂载后/会话恢复后；
  组题材料面板由 `GroupUnitApp` 在 `decorate` 里一次走完）+ chips 行渲染，
  幂等；选段定位与 chip 两击删除状态机的纯判定在 `flow/ClueMark.ts`
  （带单测）、DOM 手术在 `flow/ClueMarkDom.ts`（`applyClueMarks` 退居
  无权威坐标系的遗留根兜底）。
  **线索归属题按卡反查**（`clueOwnerQid`）：长卷全卡常驻，非当前题卡的
  chip 删除与「AI 复核」都用 `closest(".wengu-card").dataset.qid` 经 host
  `questionById` 取题；组题行无卡 qid 时回落 `currentQuestion()`——写死
  「当前题」两路都会错（删错题 / 拿错题线索判、结论贴错卡）。「标为线索」
  同样按选段起点卡反查（滚动跟踪有延迟，按「当前题」会把线索挂上一题）。
  两个曾踩的坑：**chips 槽本身就是 `[data-clues]` 行元素**（`renderClueRow`
  直收它，别再找后代 `[data-clues]`，否则静默早退、chips 与复核钮全不
  渲染）；组题材料面板与底部槽**组内共享**，刷新要过 `isGroupCurrent`
  守卫，否则全量补齐会用最后一道有线索的组内题覆盖当前题。

    **浮条与跨节点高亮**（Issue #36，20260911）：
    - 浮条两钮只剩「标为线索」「标生词」——**做题时不允许查词义**（产品
      决策）：生词钮从「查生词」改为**直接收入生词本**（`seedWord` +
      `starred`，与背单词面板同一 store），结果走 `ui/Notify` 通知
      （`wordAdded` / `wordNotInBook`），**不再弹释义卡**（`.wengu-wordpop`
      与 `showWordPopup` 已整体删除）。
    - 长度闸 `SELECT_MAX = 1000`（只挡整页全选）——旧上限 120 字符会让
      144/500 字符的选段**整个不出浮条且无提示**。
    - **高亮必须支持跨文本节点**（跨段/跨 `**加粗**`/公式节点是常态）：
      `ClueMark.locateAcrossNodes` 把全部文本节点拼起来、**空白全丢**后
      匹配（`BlankIndex` 同源产坐标），命中区间逐节点取交集返回；
      `applyClueMarks` 先对**未改动**节点表算全部计划（`planMarks`），再由
      `ClueMark.markSlots` 拍平成**节点升序 + 节点内起点降序**的施工序
      ——同一节点里靠后的段必须先切，否则前段 `splitText` 把节点截短、
      后段区间越界被跳过（与 `MaterialDecorate.assignHitsToNodes` 同款口径）。
      ⚠️ **按线索逐条施工是错的**（PR #38 首版即此，已修）：同一节点里的
      **第二条线索**区间越界静默不落格，真机表现「一段话里只高亮第一条」。
      匹配不上仍降级（只 chips 不高亮，宁缺勿错）。
      排序之前**必须先过 `ClueMark.mergeMarkSlots` 合并同节点内的重叠/
      相接区间取并集**（Issue #56）：排序只解决「不重叠的段」的先后，
      **相交**的两条里先切的那条照样把节点截短、后一条越界被 `wrapRange`
      静默跳过（真机现象：同一题干三条线索、chips 三条都在而正文只出一个
      ——用户「在同一段文字上反复微调标注」必然踩中）。合并语义：**包含**
      （长包短）⇒ 只出长的那条（用户要的「长覆盖短」）、**部分重叠**⇒ 并成
      连续一段、**相接**（前 end = 后 start）⇒ 合成一段、**不相交**⇒ 逐字
      不变；**跨节点不合并**（各节点独立）。合并后区间两两不相交 ⇒ 施工
      永不再触发保护性跳过（`wrapRange` 的守卫保留作防御）。副作用是
      **chips 与 mark 不再 1:1**（被覆盖的 chip 照常展示/两击删除，删后
      按剩余线索重新合并），`MarkSlot.text` / `MarkSlot.clue` 取区间最长
      的那条（多色归属即此，见下）。
      ⚠️ **两条链都要接线**（Issue #56）：装饰出口的**坐标主路径**
      （`ClueDecorate.applyClues`）与 `ClueMarkDom.applyClueMarks`
      （fallback 兜底）在 `markSlots` 之后各自过一次合并——只修 fallback
      等于用户主路径带病。
    - **主题多色（Issue #57）**：色板定义与平行数组在
      `quiz/flow/ClueColor.ts`（纯逻辑带单测）：`clueColors[qid]: number[]`
      是 `clues` 的**第三个平行数组**（`-1`=默认黄、`0..3` 四序）。
      ⚠️ **令牌写全名**（Issue #57 首版踩坑，Issue #70 修复）：思源主题只
      定义 `--b3-card-{info,success,warning,error}-background`（背景）与
      `-color`（前景）八个全名，**裸名 `--b3-card-info` 不存在**——写成
      裸名解不出，整条 `background-color` 在计算值阶段失效（四处全透明：
      色板/浮条角标/chips 色点/正文 mark，含 scss 默认黄兜底）。
      `CLUE_COLORS[].cssVar` 存的是**令牌基名**（`--b3-card-info`），
      背景一律 `${cssVar}-background`、前景一律 `${cssVar}-color`。
      三条硬口径：
        - **归属取「最长那条」的色**：`MarkSlot.clue` 与 `text` **同源**在
          `mergeMarkSlots` 里取最长（分开判会「颜色来自这条、文本来自那
          条」）；`colorMapOf` 把线索引映射成色号，`applySlots` 据此写
          **内联** style。
        - **色号一律走主题变量**，且**变量取不到就不写 style**（落回 scss
          默认黄）——写一个解不出的 `var()` 会让 `background-color` 整条
          失效（高亮直接透明，比「色不对」更糟）。判定是
          `clueColorStyle`→`themeVarsUsable` 的**自定义属性可读性**探测
          （缓存在进程内）：拿 `getComputedStyle().backgroundColor` 当判据
          恒为可用（未解析时是 `rgba(0,0,0,0)`，真值），等于没判；
          探测变量同样必须是**全名** `--b3-card-warning-background`——
          探测裸名恒为空串 ⇒ 恒判不可用 ⇒ 内联样式永不写（fail-closed
          设计把「色不对」挡成了「全透明」）。
        - **下标对齐维护**（增/删/改）与 `clueRanges` 同款「有表才推进、无表
          不建表」——存量线索零迁移；删除时同下标同步删（`removeClueColor`）。
        - `anchorsOf` 的 `color` **只在显式选过色时带上**：无色的题锚点形态
          与改造前逐字相同（下游按 key 判在场，无噪音键）。
        - 选色入口两处，**同一份 `ui/ColorMenu.svelte`**（禁复制第二份）：
          ① `AnnoFlow` 浮条——主钮**一步标默认黄**（零回归），紧邻的小
          色块角标开竖排色板；色板是浮层 ⇒ 打开它会动选区，故**锚点/文本/
          Range 在按下触发钮那一刻一次快照**（`snapshotClue`），点色块时
          直接用快照；② `ClueFlow` chips——点 chip 上的**色点**给那条
          线索**改色**（`current` 传该条色号，色板里打勾）。
          ⚠️ **色点分支必须判在 chip 分支之前**（`bindClueJudge`）：色点在
          chip 内，落到 chip 分支就成了「删除待确认」——用户想改色却把线索
          删了。`hideBar()` 连带收浮条色板；chips 重铺（`refreshClueMarkFor`）
          与删除都先收 chips 色板（浮层锚点已随行重建）。
        - `ColorMenu` 的外部点击监听有**就绪闸**（延到下一个宏任务）：打开
          色板的那次 pointerdown 可能仍在派发，当场判「点了外部」会开了又关
          （肉眼「点了没反应」）。
    - **模块拆分**（Issue #57 压 500 行红线）：`MaterialDecorate`（270）只剩
      装饰编排 ①~⑤；线索施工移入 `ClueDecorate`（计划/落格/摘 mark），
      DOM 观测（三套选择器 + 文本节点表 + 建权威坐标系）移入 `CanonDom`
      ——两边都从 `CanonDom` 取观测，**不再互相 import**（防循环依赖）；
      对外门面由 `MaterialDecorate` 转出，调用侧零改动。
    - **空白必须全丢而不是折叠**：DOM 里 `</p><p>`、`<strong>` 边界之间是
      **零空白**，用户拖选得到的是换行——只折叠不丢，跨块边界永远匹配不上。
    - 桌面客户端「点按钮无反应」防御三件套（Web 端复现不了）：浮条根**捕获
      阶段** `mousedown` → `stopPropagation`（隔离宿主全局监听）、按钮监听
      改 `pointerdown`（更早快照选区）、`lastSelText` 选区快照兜底（选区在
      某层被清也能标上；`hideBar` 一并清掉，别标到陈旧选段）。
    - **浮条作用域闸**（Issue #45，20260913）：判定纯逻辑在
      `quiz/flow/AnnoScope.ts`（`annoEnabled` / `isEnglishScope` /
      `pickAnnobarButtons`，带单测），DOM 侧 `AnnoFlow.positionBar` 只读观测
      再照判定施工。
        - **模式闸**：`AnnoCallbacks.mode()` 拉取视图模式，**只有 `quiz`
          放行**——预览/复习/学习零浮条；`QuizView.switchMode` 里
          `hideBar()` 显式收条（判定是拉取式的，切模式那一刻没有
          selectionchange 事件来重判，不显式收条会留着已开的条）。
        - **标生词卷级判定**：生词本是英语功能——**只有英语卷**才出
          「标生词」。「英语阅读也是 single、数学单选也是 single」**题级判
          不开，只能看卷**；反查链 = 选段所在卡 `data-qid` → 该题
          `rootId`（=源题集 id）→ 该卷是否英语卷。
          聚合/专题混合刷按各卡各自源卷判。**任一环反查不到即 false**
          （宁缺勿错）。
            - ⚠️ **判据是两级口径、不是题型并集单独一条腿**（Issue #83）：
              `isEnglishScope(subject, types)` = **有学科以学科为准**
              （`BankSet.subject` 归一后是「英语/英文/english」）、**无学科
              才回退题型并集**（含 cloze/match/essay/trans 任一）。理由：
              题型是**作答形态**不是学科——纯阅读英语训练卷全是 single
              （代理判不出，标生词整体不出），语文卷的作文 essay 与文言文
              翻译 trans 又把它误判成英语卷（中文词收进英文生词本）。形态
              代理**两个方向都会错**。存量题集无 `subject` 字段 ⇒ 回退腿，
              逐字节不回归。
            - ⚠️ **这条判据只服务「标生词」**：阅读面/题卡间距阶梯是
              **材料组结构**判据、与学科零关系（见下文「阅读面作用域」）。
              #81/#82 把阅读面接到这条英语判别上是修错方向（#83 根因）——
              判别不出英语时材料组结构还在、美化却没了。
            - **学科归一只去装饰、不做模糊匹配**（学科是开放集：历史/政治/
              自控原理…，猜错比不猜更坏）：`BankSets.normalizeSubject` 取
              首个学科名（「英语（阅读理解）」→「英语」），占位（无/未知/
              N-A）与空串归 undefined=**无学科**。
            - ⚠️ **组题材料面板必须按组内卡反查**（`annoOwnerQid`）：
              `.wengu-gmat`（`[data-mprotyle]`）是 `.wengu-gqs` 的**兄弟**、
              不在任何 `.wengu-card` 里，而英语阅读/完形的正文正好落在那
              片区域——只认 `closest(".wengu-card")` 会让整片正文区判不出
              英语卷、「标生词」在那里整体消失（验收 4/5 破）。回落取组内
              **可见卡**（`.wengu-card:not([hidden])`，DOM 未落定再退组内
              首卡——同组单元必同源题集，卷级结论一致）。
        - 判定按题集缓存（`quiz/service/AnnoScopeCtl`，自 QuizView 拆出压
          500 行红线）：选段回调是高频**同步**路径，走
          `BankSets.peekSetSubject` / `peekSetTypeUnion` 窥视已装载数据
          （`bank.peek()`），未装载先按否收口 + 异步 `setTypeUnion` 补正
          ——**不许在 selectionchange 里 await 查库**；`invalidateAnnoScope`
          在换卷/切题集/切模式时清缓存。
            - ⚠️ **补正腿的学科必须在 await `setTypeUnion` 之后才窥视**
              （20260914 复审修复）：进补正分支的前提正是 `bank.peek()` 为空，
              在 await 前取学科**恒 undefined** ⇒ 带学科的纯阅读英语卷
              （全 single、无英语形态）被落成「无学科 ⇒ 回退题型并集 ⇒ 非
              英语」，缓存一直错到下次换卷/切模式（「标生词」全程不出来，
              与验收 5 相悖）。`setTypeUnion` 内部已 await `bank.all()`，
              回来时 peek 就绪 ⇒ 那时读到的才是真学科。回归测试
              `service/AnnoScopeCtl.test`（含反证：把取用点挪回 await 前即挂）。
        - **两钮都不出 = 浮条整体不出现**：非英语卷在非可标区域（解析区/
          选项区）选段即此情形——改造前会浮出一条只剩「标生词」的空条。
    - **阅读面作用域（`.wengu-reading`，Issue #81 / #83）**：材料区改
      阅读面（衬线正文/68ch 栏/段落序号/间距阶梯，`scss/reading.scss`）
      的判据是**材料组结构**，**与学科/题型零关系**（#81/#82 绑英语判别是
      修错方向，#83 已纠正）：材料组（材料块 + 依附小题 = 一题多问）是
      **全学科通用结构**——英语阅读/完形、语文文言文、政治材料分析、工科
      大题都产出材料组，都该美化。纯逻辑唯一入口
      `quiz/flow/ReadingScope.ts`（带单测，**不吃任何学科/题型输入**）：
        - **组单元无条件美化**：`GroupUnitApp` 自己**就是**材料组 ⇒ 一律挂
          `.wengu-reading`（判据写死 true，**不再消费 `m.reading`**；壳层
          也不再按英语传值）。`CardHtmlModel` 已删 `reading` 键。
        - **判据落在单元上，段（题集）只是边界**：`isReadingUnit(u)` =
          `u.kind === "group"`（唯一真判据，**不吃任何学科/题型输入**）。
          `readingShellScope(units)` 定整壳类名（**全部单元都是材料组才挂**；
          纯材料/一题多问卷 ⇒ 产物与改造前同形、零包装），
          `wrapPlanOf(units, segOf)` 出**逐单元的包装计划**（`-1`=落在外层、
          `>=0`=第 n 个 `.wengu-set-seg.wengu-reading` 包装；`QuizShell`
          照计划施工）：
            - ⚠️ **按单元而不是按段整包**：同段既有独立题又一题多问时（工科
              大题卷），整段包装会把独立题卡也染上阅读面（衬线正文/间距阶梯），
              违反验收 3「独立题卡不挂」。故 `wengu-reading` 的样式全是
              **后代选择器**，类挂在哪个祖先决定作用域——独立题单元落在外层、
              祖先链上没有该类（零装饰）。
            - ⚠️ **复用条件 = 连续阅读单元 且 同段**（`segOf` 相同）：题集
              标题行插在包装**外**，**跨段复用同一个包装**会让后一段的标题行
              落在复用包装**之后**、而该段首题被追加进复用包装（在标题行
              **前**）——真机表现「第二套的题跑到它自己那行题集标题上面去了」，
              两套的材料组还挤进同一个包装（`wrapPlanOf` 单测锁死这条）。
            - **标题行留在包装外**：`.wengu-set-head:first-child` 的首/续段
              间距口径不变（包装会让每段标题都成 first-child，白改外观）。
        - **零回归**：纯独立题卷 ⇒ 不挂整壳、零包装（渲染产物逐字节不变，
          包括数学/政治等非材料卷）；纯材料卷 ⇒ 挂整壳、零包装（与 #82
          的英文卷产物同形）。
        - ⚠️ 混合刷的材料组单元落在包装里 ⇒ 凡是按 `.wengu-card-list >
.wengu-card` 子选择器扫卡的地方都要后代式（`PreviewFlow.applySearch`
          已改），漏一处就是「预览搜题过滤漏掉整段」。
        - `unitStartIdx` 由 QuizShell 迁入本模块（标题行落位与包装计划共用
          同一份段下标 `segOf`，别各写一份）。
    - **长材料限高内滚（`.wengu-gmat-host`，Issue #87）**：阅读面在长材料
      下把题目挤出视口（英语真题一篇阅读占满整屏，做题来回滚整页），故材料
      区**限高 + 内部滚动**、下缘一条渐隐分界线。
        - **判定的唯一入口** `quiz/flow/MaterialScroll.ts`（纯函数带单测）：
          `materialScrollCap`（溢出才限高，短材料 0=不限高）与
          `fadeVisible`（**只有「还能往下滚」才显渐隐**，滚到底即消）。限高值
          走 CSS `--wengu-mat-cap`（视口比例 52vh / 移动端 64vh），JS **不
          重复算像素**——量算读的正是限高生效后的布局尺寸，改比例判定自动跟随。
        - **壳层多一层 `.wengu-gmat-host` 只是为了落渐隐**：覆盖层若挂滚动
          容器自身会跟着滚走、绝对定位相对它又会被 `overflow` 裁掉；父壳不受
          裁剪才能把覆盖层「钉」在下缘。**短材料不挂 `[data-scroll-cap]`**
          ⇒ 限高/覆盖层/滚动条一条都不生效（逐字节同现状，验收 2）。
        - ⚠️ **折叠展开必须重量一次滚动能力**（`toggleCollapsed`）：
          `[data-collapsed]` 走 `display: none`，收起态量算是全 0 ⇒ 落成
          「不限高/无渐隐」，展开后不重量就再也回不来（长材料的题又被挤下去）。
          `resize` 同理（改行数却不触发滚动事件）。
        - ⚠️ **内滚会改「谁滚」**：题卡/题号导航原先只滚外层 `.wengu-main`，
          材料区内滚后组内题卡落在内部滚动容器里，外层滚到底是**够不着**的。
          故 `NumRail.chaseScrollIntoView` 起手用 `scrollHostOf(target)` 认
          「最近的可滚祖先」（挡在它前面的 `.wengu-gmat` 自己就是）——几何
          公式两轴通用，只是换了基准元素；`.wengu-main` 当状态 key 照旧。
          新增任何「滚到某元素」的通道都要过这层。
    - ⚠️ **`SKIP_SELECTOR` 与词表区的嵌套约定是「单向」的**（Issue #51 改写
      #33/#34 接口；Issue #53 起**只剩一份**协调名单）：`ClueMarkDom` 的
      `SKIP_SELECTOR`（fallback 匹配源）**只跳词表区 `.wengu-gloss`、不跳
      `.wengu-gloss-link`**（其 `<u>` 内文本参与匹配、允许被包 mark），上标
      另由 `SUP_SELECTOR` 在落格时挡「不许被包」。装饰层那侧的名单位于
      `MaterialDecorate`（`NON_CANON_SELECTOR` 权威源 / `NO_WRAP_SELECTOR`
      落格守卫），**与 `SKIP_SELECTOR` 是两套口径、各管各的事**（见二期段）。
      词表拆解逻辑 `GlossDom` 侧不再有第二份跳表（同步删 `mark` 的旧约定，
      改由权威坐标系天然覆盖）。

    **线索锚点二期：权威坐标系 + 统一装饰层**（Issue #52，20260913）：
    - 新域 `quiz/service/ClueCanon.ts`（纯函数，带单测）= **权威坐标系**：
      权威原文 := 基础渲染后、任何装饰施工前的**可见文本拼接**（非 md 源
      偏移）；非权威区（词表区/上标/按钮/选项/解析/公式占位）剔除。
      关键性质：**装饰只改变节点边界、不改权威文本** ⇒ 权威串跨装饰恒定，
      坐标可用权威切片校验。
    - `quiz/service/MaterialDecorate.ts` = 材料/题干挂载的**唯一装饰出口**
      （Issue #57 起只留编排：施工在 `ClueDecorate`、DOM 观测在 `CanonDom`，
      见上文「模块拆分」）：
      ① 基础渲染（正文 + 词表区合成**一次** `innerHTML`）→ ② 权威节点表 →
      ③ 词形联动（Issue #53 三期自 GlossDom 就地迁入施工代码）→ ④ **轮间
      重算映射**（`remapCanon`，以权威坐标为中介重建节点表 ⇒ mark 可跨
      `<u>`/跨段，二期即支持嵌套）→ ⑤ 线索 mark **按坐标施工**。挂载点
      `GroupUnitApp`（**一次** `decorate` 连线索一起铺）/ `QuizCard` 题干 /
      `ProtyleHost.mountStatic` 全走该出口；对外门面是
      `decorateMaterialEntry`（喂数据）与 `redecorateClues`（只重铺高亮）；
      `GlossDom` 只留词表区的**解析与渲染契约**（`splitGloss` /
      `dataGlossTableHtml`，零装饰层依赖）。
    - **降级链四层**（宁缺勿错，`ClueMark.locateAcrossNodes` 的文本匹配是
      fallback 地基、**不得删除**）：坐标 + 切片校验（`权威切片===text`）
      → 文本匹配当次求坐标（#51 修复版）→ 只出 chip。校验拦下即「自愈降级」：
      增量重转把材料改了也不会亮错位置。⑤ 落格前**必过 `mergeMarkSlots`**
      合并同节点内重叠/相接区间（Issue #56）——逐条独立算计划 ⇒ 相交的两条
      里后切的那条越界被静默跳过；两条链（本出口与 `ClueMarkDom`）都不许
      丢 mark。
    - 存储：`session.clueRanges[qid]?: {s,e}[]`（**下标与 clues 严格对齐**、
      optional、不 bump version、渲染**不回写**、**惰性升格**=仅用户再次
      操作该题线索才持久化坐标）。chips 文本 = **权威切片**（上标噪音天然
      不含）；`.wengu-gloss-sup` 加 `user-select:none`。
    - ⚠️ **三套名单别混**（本条复审补记；三者全是「多写/漏写一个类 = 静默
      失效」的重灾区）：
        - `NON_CANON_SELECTOR` = **权威文本源**口径，多写一个类 = 那几个字
          从权威串消失、存储坐标校验失配。**必须含** `.wengu-gloss-sup`
          （上标是原文没有的合成字符、且插在正文节点之间；漏剔即权威串
          失真）而 **必须不含** `mark.wengu-clue-mark`（mark 是既有正文的
          透明包装，剔了就「被标过的字从权威串消失」⇒ 存量坐标校验全量
          失配 + 坐标映射错位）；`.wengu-gloss-link` 同样**不入**（`<u>` 包
          的就是原文本身，#51）。
        - `NO_WRAP_SELECTOR` = **落格守卫**，只管「谁不许被包 mark」。
        - `ClueMarkDom.SKIP_SELECTOR` = **fallback 匹配源**（#51 修复版
          口径）：上标要参与匹配、只在落格时挡。
    - **CanonMap 不许跨操作复用**（`canonMapOf` 每次现场重算）：mark 施工会
      `splitText` + 插节点，任何「装饰时算好存起来」的表其 `nodeIndex` 在
      下一次操作时都已失效（表现为第二条线索坐标求错/求不出）。
    - **嵌套抬升**（D4）：坐标**完整覆盖**某个联动词形 `<u>` 时 mark 包
      **`<u>` 元素**（`LIFT_SELECTOR`），上标是 `<u>` 的兄弟且属非权威区 ⇒
      「mark 包住联动词、上标不包 mark」结构上同时成立。`clearClueMarks`
      因此**必须按子节点原样搬出**、不能 `textContent` 重建（重建会把 `<u>`
      拍平成纯文本、词形标记永久丢失）。
    - **惰性升格**（D3）写在 `ClueFlow.upgradeClueRanges`：仅「用户显式操作该题
      线索」（新增/删除）时把 `refreshClueMarkFor` 返回的逐位坐标持久化
      （`resolved` 与 `anchorsOf` **逐位对齐**，跳过的位占空）；渲染路径只读
      不写。该题从未升格则不建表。

- **展示层选项洗牌**（Issue #131，20260915）：消剧透从「生成期洗牌」搬到
  「展示期现洗」——库与题源文档是**死形态**（选项按原文顺序、答案字母指向
  原文位置、解析不含任何选项字母，见 convert 域）。
    - 落点 `render/CardDisplayShuffle.ts`（纯函数），两个调用点：
        1. `QuizShell.renderQuizShellFor` 里、`buildDrillUnits` **之前**：
           `pv || v.progressive.active ? v.list : shuffleListForDisplay(v.list, { scope: 会话 id })`。
           **预览模式与渐进呈现不洗**（预览要看死形态对照原文；渐进是生成
           产物直出、重渲染会跳序）；
        2. `mobile/core/MobileDrill.start()`（含「继续上次」）与
           `retryWrong()`——**移动端要洗**（20260915 审查定案，原稿「移动端
           不在范围」作废）：移动端显示死形态时，新造题按协议「正确项写最前」
           恒为首位＝剧透。洗的同样是副本，`ui.fullList` 原件不动。
    - ⚠️ **排列必须按 `(会话 id, 题 id)` 定种子**（20260915 评审修正）：
      会话/题库只记**字母**（`submitted`/`lastAnswer`），排列表达式只在卡里。
      若每次重渲染都 `Math.random()` 重掷（拉侧栏、改设置、收卷重渲、重开
      页签、移动端重进），恢复出来的字母就指到**别的选项**上——表现为「说
      答对却标红」「高亮错项」。故 `shuffleListForDisplay(list, { scope })`
      内部按 FNV-1a+mulberry32 自定种子：同轮恒定（恢复自洽）、换轮换会话 id
      即换序（消剧透仍成立）、会话 id 落盘（HistoryStore）⇒ 重开页签/移动端
      重进也能复原同一排列（不靠内存缓存）。**`scope` 必须传会话 id**——
      缺省 "" 是「尚未开轮」，只按题 id 定序 = 跨轮同序，消剧透失效。
    - ⚠️ **恒等排列要重掷**：n=2 时恒等概率 1/2、n=3 时 1/6，原样呈现就是
      「像没洗」；实现重掷 4 次 + 兜底首两位对调（确定性，不靠概率撞）。
    - ⚠️ **答案侧必须升序**（20260915 评审，多选题必错级）：用户点选经
      `types.toggleLetters` 恒得升序串，`gradeQuestion` 对纯字母答案是整串
      相等比较 ⇒ 洗后答案若保持原顺序（实录 `answer="DC"`）则「点对也判错」。
      `remapAnswer` 映射后 `.sort()`；非纯字母（内容答案）原样返回，
      它按选项**文本**比对、与位置无关。
    - 洗的对象：顶层选项组（single/multiple，`q.answer` 字母随同一映射重写）、
      steps **每步**选项组（各步独立洗，`step.answer` 同步重写）；位置敏感
      措辞组跳过（`POSITION_SENSITIVE` 从 `convert/.../OptionShuffle` 复用，
      单一口径）。**cloze/match 不洗**：逐空答案在 `slot-k-answer`，match 的
      候选池与槽位顺序共用同一条 `q.answer` 字母串，洗池子=洗答案、跨空一致
      性无从保证。
    - 洗的是**副本**（`{...q, optionMd}`）：`v.list` / `ui.fullList` 原件不动，
      卷内顺序/题号/材料链/会话记账全按原 id 走。⚠️ 副本带来的连带口径见
      convert 域末尾「卡 → 卷内下标一律按 id 反查」。
    - 判分口径零改动：`gradeQuestion` 按字母比、`optionIsRight` 按 idx 找答案
      ——展示序变了、字母与选项的对应关系随之变，两者仍自洽（单测锁
      「洗后答案字母指向同一选项文本」，另锁「同轮两次洗逐字相同」）。

- **切换题集二次确认弹窗**（Issue #137，20260915；差距清单 §7.d / 设计稿 §5）：
  用户在长卷中途点侧栏换卷时先弹确认，**主钮＝「留在本卷」**（安全默认，
  右起第一 primary），次钮「继续切换」outline；Esc/遮罩/关闭钮都落主钮语义。
    - **判据纯函数** `quiz/flow/SwitchConfirm.needsSwitchConfirm`（带单测）：
      `mode === "quiz"` 且 targetId ≠ currentId 且 `session && !endedAt &&
answered > 0`。**同 id 早退排在最前**（点当前行任何模式都不弹）；
      空轮（answered=0）不弹；review/preview/study 不弹。
    - **闸在视图层、不在组件层**：组件**不认识闸**，仍照 dev 原样调
      `onOpenDoc`/`onOpenCollection`；闸包在 `mountSideFor` 传给它的这两个
      出口上（`onOpenDoc: (id) => guardOrRun(v, switchEntryOf("doc", id, () => v.selectDoc(id)))`）。
      判定三件套（模式/上下文 id/题数）与目标名**逐次现取**
      （`guardCtxFor(this)` / `switchTargetNameFor(this)`）：挂载时预求值会
      把上一轮定格，闸就永远读不到点击那一刻。
    - ⚠️⚠️ **两处断链坑（20260915 复核实锤，首版即栽在这里，单测全绿
      但功能全程不通）**：
        1. **链路两端都要在场**。闸只是「有人调用才跑」的代码——壳侧
           （`QuizShell.sideQuizAccess`）必须把 `switchGuard` 接到
           `QuizView.switchGuardOf`；挂载点的出口必须是
           「`guardOrRun` + **真执行体**」。首版把两个出口写成
           `(): void => undefined` 空函数、只加了个新 prop `guard`，而壳又
           没实现 `switchGuard` ⇒ 兜底分支执行空函数 = **侧栏点任何行都
           没反应**。`guardOrRun` 的兜底**方向必须是「照常切换」**，不能是
           「什么都不做」——这条已钉进 `SwitchConfirm.test.ts` 的源码断言。
        2. **行 id ≠ 上下文 id**。侧栏行 id 是裸的（文档行 `docId`、专题行
           `col-xxxx`、聚合行 `all`），而「当前上下文」的规范口径来自
           `QuizView.docIdOf()`（专题模式带 `col:` 前缀，同
           `bank.colSessionId`）。首版拿行 id 直接比 ⇒ 点**当前已选中的
           专题/聚合行**被判成「另一上下文」，弹窗照弹（同 id 早退失效）。
           归位收口在 `SideMount.switchEntryOf(kind, rowId, go)`：
           `ctxId`（判同异）与 `rowId`（反查目标名）**分字段**。
    - **反查名**：专题行取 `colFlow.rowsView()` 的 title、聚合行取
      `allExTitle`、文档行取 `docs` title、兜底 id（id 是底不是首选）。
    - `contextNameOf` / `switchGuard` 都是 `SideViewAccess` 的**可选**能力，
      只读壳/测试壳不实现即按「直切」兜底（与改造前逐字同行为）。
    - **顺带还债**：`quiz/index.ts` 的 `recordAnswer` 实现体整体外移进
      `service/AnswerMirror.recordAnswerFor`（宿主能力 `RecordAnswerHost`：
      `takeSec`/`elapsedSec`/`notifyAnswer`/`historyStore`/`bankStore`），
      于是 index.ts 由 574 → 567 行，**豁免额度已同步收紧到 567**（只许减不许增）；
      Issue #147 空轮闸收口把入口层两处判定合进守卫，再降至 **565**；同单扩围三项把总结视图出口
      外移（`focusFinishedRound`），最终 **561**（额度同步收）。
      ⚠️ 记账链一条没删：会话 upsert → bank 镜像（首答/覆写分流）→ 学伴事件。

- **「继续上次」候选 = 从尾向前第一个未完成轮**（Issue #169，20260918 真机报障）：
  开刷面板「进度与范围」卡不出「继续上次（已答 n 题）」。数据侧诊断：涉事卷
  **所有有作答的轮都已收卷**（没丢进度），但**最后一轮是「开了轮没答题就
  离开」的空轮**（`answered:0`：弃轮无 `endedAt` / 倒计时归零或切卷收卷的
  空轮有 `endedAt`）——空轮占住末位后，即使前面存在「有作答且未收卷」的轮，
  恢复入口也被**永久埋掉**。
    - **判据不变**（`answered > 0` + `endedAt` 未写，Issue #12 B3 口径），
      **查找改「从尾向前找第一个命中」**。候选查找与判据收口到
      `quiz/service/ResumePicker`（`answeredQuestionCount` / `isUnfinishedRound`
      / `lastUnfinishedRound`）——原先 `buildStartPanelModel` 与 `startRound`
      各写一份「只看 `rounds[rounds.length-1]`」，口径漂移就是「面板显示了
      「继续上次」，点下去却从零开刷」这类**不报错的**静默错配。
      ⚠️ 两处必须共用同一个查找函数，契约测试
      `quiz/render/ResumePicker.contract.test.ts` 数落点。
    - **纯空轮库仍不出「继续上次」**（判据不变、不造幽灵入口），两种空轮形态
      （有/无 `endedAt`）都要跳过；尾随的**已收卷非空轮**同样不许把前面的未完成
      轮顶掉（收卷即断点已封）。多步题 `qid#k` 仍按块 id 归并计数。
    - **空轮路径盘点（#169 调查项，结论；第一版归因写反了，已订正）**：
      全仓能写 `endedAt` 的落点只有两处（`grep "endedAt = Date"`）——
      **桌面 `QuizView.finishSession`** 与**移动端 `MobileDrill.endRound`**：
        - **`endRound` / 倒计时 `finishNow`（倒计时归零「结束本轮」）二路都走
          `finishRoundGuarded` → 空轮 `closeEmptyRound`**：那条链是**真
          `removeSession`、压根不写 `endedAt`**（用例
          `quiz/render/EmptyRoundPath.test.ts` 锁死），**不是**空轮的来源。
          ⚠️ 别再把带 `endedAt` 的空轮归给倒计时：倒计时最短档 1 分钟
          （`clampMinutes` 下限），而真机那条 `mu6anse2-2zarfg` 是「开轮 3 秒」
          ——物理上到不了归零。
        - **真漏擦路径＝桌面 `finishSession`（切卷 / 重开页签 / 刷新 / 销毁）**：
          旧实现**不看空轮、一律 `endedAt + upsert` 封卷**。⚠️ **`upsert` 同 id
          是「整条替换」不是删除** ⇒ 开轮落盘的那条 0 作答记录**留在库里**，
          只是多了 `endedAt`——真机 `mu6anse2-2zarfg` 就是这条链漏出去的
          （第一版写成「那一轮不会留在库里」，错在把 upsert 当成了删除）。
          修法：封卷判定与落盘收口 `quiz/service/RoundSeal.sealRound`——
          **空轮真删、不写 `endedAt`、不进 `finished`**，有作答照旧封卷
          （用例 `quiz/service/RoundSeal.test.ts`）。`index.ts` 的
          `finishSession` 只剩一行调用（编排文件额度只许减不许增）。
        - 移动端两条对应漏擦：做题屏返回键 `backHome`（只退屏）+ 面板卸载
          （`MobileDrill.destroy` → `settleOnUnmount`；⚠️ 该链**真机上尚未接线**，
          `MobileApp.svelte` 无 `onDestroy`）。两处都按 `ResumePicker.isAbandonedRound`
          （**判据唯一实现**：`!endedAt && answered <= 0 && results 按块 id 归并 === 0`，
          方向取保守——有内容一条不擦）修，见 `mobile.md`。
          移动端离屏**不封卷**（与桌面不同源，有意为之：要留作「继续上次」）。
        - **存量历史仍按纯读侧兼容**：`sealRound` 只处置「正在结束」的那一轮，
          历史里的旧空轮不迁移、不擦，面板/探测跳过即可。
