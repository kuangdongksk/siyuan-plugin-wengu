# src/ai/ —— AI 基础设施域

> 2026-08-27 从 convert/AgentClient 抽离，六域共用，无 index.ts（同
> siyuan/ 惯例）。

- `client.ts` 对外通道两条：
    - **agentChatOnce**（一次性独立会话）：saveSession→chat→removeSession。
      独立 sessionID 天然并发 + 可按次指定模型。可选 `track{kind,title,group?}`
      把调用登记进 AI 会话面板；`group={id,title}` 把一次动作触发的多次调用
      挂同组（id 由动作入口 `newAiGroupId` 生成；**AiTrack 接口定义在
      data/AiSessions**，client 转发导出）。20260830 起 chatGPT 直答与共享
      `""` 会话两条路已弃用——agentChat 收为模块私有，queue.ts/enqueueAi
      整体退役。
    - **agentChatContinued**（面板重试失败记录）：历史轮次以 user/assistant
      条目回放播种新会话、重发末条 user 消息。
    - **两条通道发请求前都过全局在途闸**（Issue #76，见本节末「全局 AI
      在途并发闸」）。
- `models.ts`：模型清单与默认。`timeouts.ts`：AI_TIMEOUT 档位（调用点禁
  自造超时数字；超时统一按 SSE 空闲计）。`agentPanel.ts`：智能体面板
  DOM 自动化 + 「面板优先、页内降级」按钮帮手。
- **AI 会话登记与管理工作区面板**（20260831）：
    - 登记簿 `data/AiSessions.ts`：saveData("ai-sessions")，LRU 双上限全局
      150/单类 40、600ms 去抖 + 串行链落盘，重载时 running 改判「已中断」；
      记录可选 group/groupTitle 随组冗余落盘；index.ts onload
      initAiSessions 接线。
    - rail「AI 会话」工作区面板：components/SessionPanelApp.svelte 四件套，
      挂载编排 `SessionPanel.ts`。
    - **两栏式**（20260901 改版）：左栏=会话清单常驻（类别过滤/状态徽标/
      两击删除/选中高亮）；点行右栏出完整轮次明细 + 失败记录重试钮。
    - **自由追问已退役**（20260905）：闲聊会把业务记录混污染且每次全量回放
      烧 token；重试取代之——error 记录重跑末次调用走新会话，`retrying` 转回
      running 后复用 succeed/fail 收口原地翻案，appendTurns/ask/composer
      随之删除。
    - **树状分组**（20260902 引入，20260903 改版=**种类优先两级树**）：顶层
      一类一棵树（转换/检测/判题…）；类内按主题=组标题/标题第一个「 · 」后的
      部分（转换是文档名——高等数学、线代；跨次运行同文档合并）出第二级，调用
      行挂底层；种类或主题只有 1 条时不设空层直接上提。
    - 树渲染走共享组件 `ui/TreeList.svelte`（与知识面板/侧栏树同源）；树化纯
      函数 `core/SessionTree.ts`——类别过滤=记录透镜、状态聚合 running>error>done；
      行内徽标/条数走 main/trailing 片段，展开集合 ui.openGroups=SvelteSet。
    - 文档分支行两击删该文档全部记录（removeIds 按树算出的成员 id 精确删），
      种类级不配删除。登记数据仍按动作组落（track.group；20260902 组机制保留在
      数据层，渲染不再按组）。
    - 判题/转换/检测/标签/路由/出题/单词复盘等带 track 的调用自动登记，面板
      回看完整轮次与产出，失败可重试。
- **全局 AI 在途并发闸**（Issue #76，20260914；`ai/queue.ts` 纯逻辑带单测）：
  全仓 AI 调用（judgeBrief 判分 / 面板重试 / 伴学聊天 / 转换 / 标签 / 路由 /
  出题…）**统一**在发出前取槽，在途笔数不得超过容量——转换 4 并发跑动中
  再点失败记录「重试」，重试排队等槽而不是直发第 5 笔。容量默认
  `AI_SLOTS_DEFAULT=4`，**由 index.ts onload 用设置里的转换并行度注入**
  （1~4；设置页改并行度经 onSettingsChange → `WenguPlugin.applyAiSlots`
  重注入）。⚠️ **未设置回落默认 4、不是 1**（`aiSlotCapacityOf` 纯函数带
  单测）：`convertParallel` 在用户没动过设置页时是 `undefined`，直接
  `?? 1` 会把**全仓** AI 在途数默认压成 1——判分/伴学等单笔调用在转换跑
  动期间全排队，与设计口径相反；用户**显式**选 1 才真按 1 收窄。
    - **接线点在 `client.ts` 两条通道**（slotGate → acquireAiSlot）：判分/
      标签/路由/伴学等调用点**零改动**自动被闸覆盖；两条通道的槽都在
      `finally` 释放（成功/失败/中止同路）。
    - ⚠️ **验收 2「排队中的重试可被停止」的入口随 #77 改了口径**：Issue #76
      写下时停止钮在**记录详情**（`abortAiSession(rec.id)`）；#77 起记录级
      停止钮整体删除、停止入口**唯一**在流级横幅（`FlowRegistry`），而重试
      属**单调用流**（无横幅、无有效停止面，见 FlowOwnership 的 none 分支）
      ——故本闸只保证「排队中的**流内调用**可被该流的总闸中止」：转换族等
      经 `aiStopHandle` 接线，其 signal 一中止，排队等待立刻出队（口径 1），
      不再为记录级停止另挂句柄（那会是永不触发的死接线）。
    - **超时从取到槽后才起算**：AI_TIMEOUT 的 SSE 空闲口径不含排队时间
      （排队等一小时不该被判超时）——取槽在 `agentChat` 之前，其内部才
      armTimer。
    - **两条硬口径都是防自锁**（20260914 用户定夺，回归测试锁死）：
        - **abort 感知**：排队等待期间 signal 中止 ⇒ 立刻出队 + 抛 AbortError
          （队列里不留残影、不会等下一个槽）；已中止的 signal 根本不进队。
        - **槽释放 FIFO 唤醒链不吞异常**：释放后按 FIFO 唤醒队首；唤醒链
          自身（队首后续逻辑、整条 `drain`）任何异常都面吞继续唤醒下一位
          ——吞一次异常 = 后续排队者永久挂起（同落盘链的面吞错惯例）。
    - **FIFO 靠 Promise 微任务序**（`then` 回调按注册序执行 ⇒ 唤醒序 =
      入队序）：**不许**给等待链加去抖/宏任务延迟换「稳」，那会让 FIFO 失序。
    - ⚠️ **释放的槽必须「转交」队首，不许当成空闲松开**（复审补记，防饿死）：
      唤醒只是把 resolve 排进微任务，被唤醒者要等**下一个**微任务才回来占
      槽；若此刻把槽算成空闲，同一同步栈里新来的调用（`acquireAiSlot` 的
      同步段直接 `takeSlot`）就能抢走 ⇒ 队首被推回队尾，持续有新来的就
      **永远轮不到它**（真机形态：转换一批收口、紧接着起下一批，把排队中
      的重试饿死）。故 `drain` 保持 `used` 不变（槽原地过户）并把释放句柄
      一并交给队首，`acquireAiSlot` 收下句柄**不回头重抢**；唤醒真的抛错时
      槽退回池里、循环接着唤醒下一位（不 break 也不塞回队首）。回归测试：
      释放的同一同步栈里插一笔新调用，断言队首先拿到。
    - **缩容不打断在途、只拦新来的**：容量降到在途数以下时，多出来的在途
      笔数挂「存量债」（`debt`）逐笔偿还，抵完才真正腾出准入位——不挂债
      会自锁（在途恰好等于新容量时释放把 `used` 降到 capacity，`drain` 的
      `used < capacity` 不成立，队首永远等不到唤醒）。
    - **排队可见性**：登记簿记录加 optional `queued?`（**只加不改名不 bump
      version**，与 clues 同款惰性口径），`status` 仍是 running（「已安排
      重试」语义不变，面板 retrying/succeed/fail 链一字未动）——详情页那行
      显示「等待空闲通道…」（`aiWaitingSlot`），头部状态标签补同一词。
      ⚠️ 判据必须是**满载**（`used >= capacity`）而不是「已有等待者」——
      本次调用此刻还没入队，拿 `waiting > 0` 判会漏标第一笔排队者（表现
      成「第五笔才显示」）。取到槽立即 `dequeued` 清掉（标记表只服务展示、
      不参与任何判据）。
    - **与另两道闸正交、互不替代**：`aiFlowBegin` 单飞闸管「六个批流
      同时只放一条」，转换 worker 池管转换内部的片流水线数，本闸是**所有**
      调用的总在途上限（前两者发的每一笔都过它）。转换 worker 数 ≤ 容量，
      天然不会自己堵自己。

- **prompts/ 子域**（20260910 起全仓 prompt 集中收口，八文件按场景家族分域）：
    - common：逐字共用片段。protocol：行协议 + **题型注册表**（`protocolSpec(types?)`
      / `typeRulesFor` / `materialRulesFor`；types=undefined 走全量兜底与改造前
      逐字节一致）。convert：buildPrompt 题型化（含逐段自推进的 `StepContext`
      批次上下文与 `@@TO` 定位约定）+ 大纲归纳（`detectWindowPrompt` 已随独立
      检测退役删除）。gen：
      概念/变式/重生成/自检/自由标签，单题场景题型已知按题裁剪。route：章小节×
      单批批量四联 + knowRule 插槽，路由上限常量随 prompt 落此。judge：判分族+
      轮报分析 + byBaseQid。misc / companion。
    - **prompt 审计收口**（Issue #143，20260916；#132 全量只读审计的 P2/P3 落地）：
        - **限长常量收口** `common.TAG_MAX_CHARS = 24`——「知识点标签/术语」
          长度口径原先 12（`freeTagPrompt` prompt 文案）/ 24（`parseFreeTags`
          截断）/ 30（`SYN_MAX_CHARS`）各写一遍。现 prompt 侧要求与解析侧
          截断**同源**（`SYN_MAX_CHARS = TAG_MAX_CHARS` 保留作文档别名）。
          ⚠️ 加新的「不超过 N 字」要求时**别写死数字**，引该常量并注释互指。
        - companion 的 **LINE 限长是两个值不是漂移**：`REACT_LINE_WANT=30`
          （prompt 要求值）/ `REACT_LINE_MAX=40`（气泡容忍上限，留余量避免
          合规输出被砍尾）。两者**不许合并**——收到 30 会让 AI 略超即出「…」，
          提到 40 等于放任台词变长。
        - **P2 三条**：①`buildPrompt` 首批判定正文改为「四行」
          （CAN_CONVERT/REASON/TYPES/SUBJECT，原写「三行」而 `verdictOf` 实发
          四行）；②`buildRegenPrompt` 的【用户备注】原先在要求段与模板尾**各
          拼一遍**，现只留要求段那份；③`variantPrompt` 补插图占位还原要求
          （发送侧 `sanitizeAiImages` 已把图换成〔插图:…〕，缺这句带图题走
          变式链**图片静默丢失**）。
        - ⚠️ **route 批量回复的扁平数组判废**（`parseBatchNums` 返回
          `number[][] | undefined`）：AI 偶尔把所有编号并成一个数组
          （`{"chapters":[1,2,3]}`），逐题归属全丢——旧实现按内层 `[…]` 顺序
          取值会当「题 1 命中 1、题 2 命中 2…」**永久固化进 RouteCache**。
          现判废并透传 `onFormatError` ⇒ `RouteCache` 置组失败 ⇒ **不落缓存**。
          三个易错点：①取数组必须**括号配平**（非贪心会在嵌套首个 `]` 截断）；
          ②必须取**最后一个**配平数组（AI 常先复述 prompt 里的格式骨架）；
          ③**空数组 `[]` 是合法零命中、照常缓存**，只有「含内容的扁平数组」
          才判废。
        - **P3 其余**：`wrongCausesPrompt` 明说竖线**按位置切分**、题干内竖线
          是内容（拼行侧刻意不转义：转义要动既有约定且让 AI 面对陌生的 `\|`）；
          退役的两个 prompt 构建器死代码删除并由 `ai/prompts/convert.test.ts`
          **源级扫描**（vite `?raw` glob，`src/` 无 @types/node）锁「零命中」。
          ⚠️ **守卫文件自身也不能出现被查标识符的字面量**：验收口径是
          `grep -rn "<名字>" src/` **零命中**，守卫里把名字写成字面量会让这条
          grep 永远非零、口径无从成立——测试文件里用运行时拼装
          （`["a","b"].join("")`）拿名字，断言效力不变。
    - **生题题型化**（20260910）：前置检测 TYPES 行顺带报题型（parseTypes 中英
      别名容错、分段并集），buildPrompt 只拼在场题型规则（数学卷不再带英语四类
      约定）；续跑/增量跳过检测时用题集既有记录题型并集（BankSets.setTypeUnion
      零 AI）；开关产出题型（填空转选择→single、大题拆多步→steps）不受检测影响
      恒在。

### AI 会话面板的中止接线（Issue #72，20260914）

- **登记簿句柄两形态**：`stopBySid` 的值放宽成**可中止句柄**
  （`AbortController | () => void`）——`aiAbort()` 出 AbortController
  （通用流），`aiStopHandle(signal, stop)` 出停止回调（**自带总闸**的
  业务流专用）。`abortAiSession` 对两者都只是「调一下」，触发即从表移除；
  别再往登记簿塞第三种形态。
- ⚠️ **转换族原先每笔都不带 `onSid`**（`makeKnowAwareAi` 只传
  `{kind,title,group}`）——面板对转换 running 记录点「停止」查无此 id、
  **静默无效**（六个既有批流好使、唯独转换不行）。现已接线：整卷
  （`ConvertBatch`）、增量（`ConvertIncrement`）、AI 索引
  （`generateKnowledgeOutline` → `KnowPanelCtl`）。新增任何转换族
  `agentChatOnce` 调用点都**必须**带 onSid，漏一处就有一笔是死的。
- ⚠️ **面板点停 = 等价于页内停止**，不是只断当前这笔 fetch：
  `ConvertBatch` 的 `abortFlow()` 是**唯一**总闸——置「用户终止」标记 +
  `internal.abort()`；页内停止（relayAbort）与面板停止（aiStopHandle 的
  stop）都走它。**只调 `internal.abort()` 是错的**：`userAborted` 不置位
  ⇒ 收口判成「AI 失败」而非「用户终止」（实现期真踩到，回归测试锁在
  `convert/service/test/ConvertPanelStop.test.ts`）。句柄的 signal 传
  `internal.signal` 而非 `opts.signal`（后者是 TYPES 检测等链路的中止源，
  接成 stop 会把批次收口误判成用户终止）。
- `ConvertIncrement` 自建 `stopCtrl`（它不由 ConvertRun 起、拿不到
  `startExclusiveConvertRun` 的 controller），`run.signal` 转接进来；
  逐块与块间都认 `stopCtrl.signal.aborted`。
- `runSegment` 窗口循环**必须每批收尾再查一次 `signal.aborted`**：此前只在
  下一笔 AI 前查，最后一批之后落下的停止会白烧一个窗口的 AI（真机「点了
  停止还继续出题」）。
- **页面已可见的反馈不重复通知**（判题/词书导入/学伴 AI 等），新增后台流照此口径接。

### 流级横幅：多调用流的停止入口（Issue #77，20260914）

- **横幅是 ai 域通用注册表，不是转换专属**：`ai/core/FlowRegistry`（纯逻辑、
  带单测）只认 `begin(id,title,progress?,stop?)/progress/choose/end` 五个动作，
  任何多调用流登记即可——**不许为某个业务域开特例分支**。
    - **同时只有一条**（单条横幅约束）：转换有 active 单例、六批流有
      aiFlowBegin 单飞，天然不叠加；真叠了则**后来者不覆盖**（先到先得，
      防把在跑的流的停止钮顶掉）。
    - **end 必达**（finally 语义）：收口段一律把 end 放 finally——漏一次
      横幅就永久挂着、停止钮指向已结束的流。转换族靠**快照收敛**天然满足
      （无快照即无横幅），索引流靠 `runOutlineFlow` 的 finally。
    - **停止句柄复用既有中止通道**（`aiAbort().stop()` / `aiStopHandle(s,stop)`
      的 `stop` 字段），不新造第二套。`AiAbort.stop` 是 Issue #77 加的**可选**
      字段：横幅只负责「调一下」。
- **记录详情一律不再渲染停止钮**（`SessionPanelApp`）：多调用流的停止入口
  **唯一**在横幅；原位置换**归属说明行**（`ai/core/FlowOwnership`，纯函数
  带单测，`kind × 状态` 矩阵锁死）——转换族出通用口径、六批流带流名，
  **单调用流（判分/伴学/ask/analyze）不出任何停止 UI**（本就没有有效停止面）。
  `SessionPanelCtl.stop` 因此整体删除。
- **待抉择态**：转换流停止后**不立刻消失**，转 `choice` 相位、横幅上直接给
  「保留已生成 / 全部丢弃」（接 ConvertRun 已有的 `keepConvertRun`/
  `discardConvertRun` 导出函数），抉择落定**由状态机收口**（`ConvertFlow`
  的订阅 sync 里 end）——组件不抢着 end，否则横幅先消失、页内进度条还留着，
  两处口径分叉。
- **转换族接线零侵入**（与在途 #74 的 ConvertBatch 接线保持一行调用薄面）：
  `convert/service/run/ConvertFlow.ts` **订阅既有的 `subscribeConvertRun`**
  单向同步，`ConvertBatch`/`ConvertBatchQueue` **一行都不用改**；进度摘要
  复用页内同一条文案函数（`progressStatusText`/`batchHeadText`）⇒ 不会出现
  两套进度数字；批量队列附六态计数（done/skipped/stopped/failed/cancelled 的
  计数，running 单列）。挂接点在 `convertRunEventsFor`（四条转换入口共用）。
  接进 ConvertBatch 的是**一行 `aiStopHandle`**（#72/#74 已接线），横幅不碰它。
- **AI 索引自起一条流**（`bank/core/KnowOutlineFlow.ts`）：索引不由 ConvertRun
  起，故 begin/end 由 `runOutlineFlow` 包围——顺带把「逐篇串行循环」从
  KnowPanelCtl 搬进该模块（该文件原先 511 行、现已回到 494 行，红线不破）。
- **两击确认统一口径**：横幅停止钮与**页内转换条的停止钮**都走 `Armed`
  （首击变「再击确认停止」，3s 复位，不上模态框）。
- **颜色一律 `var(--b3-*)` 全名**，禁用写死色值与令牌裸名（#70 事故口径）：
  样式在 `scss/aiflow.scss`（`.wengu-aiflow-*`，**单开一片**——rail.scss
  已 420 行，塞进去会逼近 500 红线），`index.scss` 里 `@use`。

### 流级横幅的视觉还原（Issue #85，20260914；设计稿

`design/convert-stop-redesign.html` 已验收 → 照稿施工勿发明视觉）

- **视图模型在 `ai/core/FlowBannerUi.ts`（纯逻辑带单测）**，组件零判断：
  构成条分段（`flowSegs` 篇数→flex 权重）、六态 chips（`flowChips`，零值
  `isZero` 压暗）、清单窗口（`listWindowOf`，当前行落窗口第 4 位=设计稿
  「第 9–14 篇」）。**分段/计数/窗口全在这里判**，组件只按 vm 渲染。
- ⚠️ **构成条的段序与 chips 的序不是同一个**（照稿）：`SEG_ORDER` 走设计稿的
  **DOM 视觉序** `done → skip → fail → run/stop → cancel → queued`（红段在
  主题段**之前**）；`CHIP_ORDER` 走 `done/skip/run/stop/fail/cancel/queued`。
  拿 chips 的序排条会让红段位置与稿不符——稿的停止屏 aria 跟**条**走。
- ⚠️ **富统计的「累计」在队列屏是队列累计**（各篇 `item.count` 之和；设计稿
  148 = 9 篇完成 + 46 + 32 + …）：`snap.progress.count` 只是**当前篇**的量，
  直接拿它会把「累计」写成一篇的数。单篇流（无 queue）的 `progress.count`
  本就是该文档累计，照旧。
- ⚠️ **停止屏取数不能只读 `snap.progress`**（aborted 槽只留 `pending` +
  `items`，**不带 progress**）：照设计稿的停止屏是四段（停在第 i/N 篇 ·
  本篇已读 % · 累计 c 题 · 已生成 b 批），只读写进停止屏就只剩首段。故
  readPct 取「被停的那篇」（`state="stopped"`）、count/batches 取 `pending`。
- ⚠️ **统计后缀的间距由 `tail` 自带**（`AiFlowStatField.tail`）：稿里
  「/24 篇」的斜杠紧贴数字、「 题」「 批」前有空格——两种间距不一致，
  渲染侧统一补空格必然做错其中一种。
- ⚠️ **注册表是通用形态，不许泄漏 convert 类型**：`AiFlowQueue.items` 是
  `{index,name,state,reason?,note?,metric?}`、计数是六个数字、统计是
  `{hint,value,tail?}`。业务域（`ConvertFlow`）负责把 ConvertRun 快照
  **折算**成这套结构；`FlowRegistry` 里出现任何 `ConvertBatchItem` 都是越界。
- ⚠️ **六态必须含 `queued`**（#79 遗留偏差：实到五态缺它——排队恰是跑动期
  最该看到的一态）。计数取值 `countsOf` 在 `ConvertFlow`；**停止态把
  `stopped` 单列**（running 段扣掉被停的那篇，两者不同色），`flowSegs`/
  `flowChips` 都按这个口径。
- ⚠️ **两屏各 6 个 chip，不是 7**（首版踩坑）：**进行中与停止共用一格**
  （同位置、同主题色，语义互斥）——跑动屏列「完成/跳过/进行中/失败/取消/
  排队」（取消零值照常列、`is-zero` 压暗），停止屏列「完成/跳过/停止/失败/
  取消/排队」而**不再列零值「进行中」**。判据只看 `stopped > 0`，别用
  「有没有 queue 维度」猜。
- ⚠️ **`progressAiFlow` 只覆盖本次传了的键**（undefined 一律保留原值）：
  某次推进漏传一个键就整块擦掉构成条/统计（六批流的纯文本 progress 调用
  与结构化 payload 混跑，这条是刚需）。
- ⚠️ **停止钮范围词由登记侧给**（`beginAiFlow({stopKey})`），**不许按
  「有没有队列维度」猜**：六批流同样没有队列维度，猜会把它们的钮错写成
  「停止转换」。转换族两条：批量 `aiFlowStopBatch`「停止整批转换」/ 单篇
  `aiFlowStopSingle`「停止转换」——**动作名即范围**（设计稿 Q4）。
- **两行标题**：`title`（主，随阶段换「转换运行中」/「转换已停止 · 等待
  抉择」）+ `subtitle`（副，「批量队列 ·《卷名》」/「单篇 ·《卷名》」）。
  六批流不带 `stopKey`/`subtitle` 旧口径照常（副标题可缺省）。
  ⚠️ **副标题整串归一个 i18n 模板**（`aiFlowSub`，`{head} ·《{title}》`）：
  分隔符与书名号是**语言相关写法**，在代码里 `${head} · ${title}` 拼会把
  中英两套写法各钉死一次（英文用弯引号不用书名号）。
- **单流态 = 无 `queue`**：只出 `.wengu-aiflow-bar` + stats + 停止钮，
  **不出** seg/counts/展开入口（`redesign-single-running` 屏）。
  **索引流也要走这套**（`KnowOutlineFlow.progressOutlineFlow` 推 `bar` +
  `stats`「已索引 i 之 n 篇」）：只推纯文本 progress 的话横幅只剩一行流名，
  与设计稿单流屏不符。单篇索引（`total <= 1`）无可报推进量，只剩流名 +
  停止钮（**不硬凑 i/n**）。
- ⚠️ **停止态左边线仍是主题色**（设计稿 `flow-banner--stop` 只换底换线色是
  误读）：3px 主题线跑动/停止**两态同色**，停止只叠低透暖底 + badge。
  换线色会让「停了」看起来是另一条流。
- ⚠️ **脉冲只属于顶部那一个点**（设计稿 `.dot` 基形无动画、`.spin` 才转）：
  分篇清单/计数行有十余个色点，基础形带 `animation` 就是满屏闪
  （首版即此，已收进 `.wengu-aiflow-id` 前缀；停止点用 0,2,0 特异性压掉脉冲）。
  计数 chip 内色点 6px、分篇行内 8px（设计稿两处尺寸），故尺寸规则分写。
- **停止态不回退 #77 行为**：横幅上「保留已生成 / 全部丢弃」两钮**保留**
  （抉择入口一处是页内条，横幅是第二入口）；另加 badge `stopped` 与
  「前往页内转换条抉择」文字链（`ConvertAccess.revealConvertBar` 滚条 +
  `.is-flash` 短描边，找不到条时零动作）。
- **范围外**：六个批流的**进度摘要上报**（#79 遗留 B）本单不做——批流内部
  没有进度通道，补它要动批流循环；它们维持「流名 + 停止钮」，样式同一套。
- ⚠️ **page 内转换条的停止钮同步换范围词**（`renderConvertBar` 读
  `convertRunSnapshot()?.batch` 判批量/单篇），与横幅同一组词、同一
  cancel 语义样式——两处口径分叉正是设计稿点名的「粒度错位」。

### AI 会话面板的视觉还原（Issue #88，20260914；设计稿

`design/convert-stop-redesign.html` 的 `ai-panel-batch-running` /
`ai-panel-single-running` / `ai-panel-stopped` 三屏 + `legacy-ai-panel`
对照屏 → 照稿施工勿发明视觉）

- **树（左栏）**：头部「AI 会话」+ 组数徽标（`badge--plain`）；二级组行 =
  **「类别 · 文档名」组合行**（`SessionTree.groupRowName`，种类级只出类别名）；
  叶子行 = **状态点 + 任务名 + 状态徽标**（`SessionTree.leafViewOf`，纯函数
  带单测）——旧行只有类别章 + 标题 + 时间，状态藏在图标色里，40 条记录看不出
  哪批失败哪批成功。
    - **视图形态由纯逻辑给**（`leafViewByKey`：`dotCls`/`badgeCls`/`badgeText`/
      `spin`/`name`），`SessionPanelApp` 的 main 片段只按字段渲染。
      状态点与徽标是**两套命名但同一组色名**（run/done/fail/stop），新增色名
      要两处同步（scss 与 `STATUS_VIEW`）。
    - ⚠️ **状态词 ≠ 色类名**（本次复审修复的真机级缺陷）：记录状态是
      `running/done/error`（状态词），样式族认的是 `run/done/fail/stop`
      （色名）——拿状态词直接拼 `is-{status}` 只会拼出两条死规则（组行色点
      全无色）。故叶子行走 `leafViewOf` 产出的 `dotCls/badgeCls`，**组行干脆
      不渲染色点**（设计稿 tg1/tg2 只有「caret + 名字」，色点与徽标只属叶子行）。
    - **展示态比 `record.status` 多一档**（`leafStateOf`）：`error` 里还分
      「真失败」与「被中止」（`AI_STOPPED` 哨兵，见下）——色名族因此是
      run/done/fail/**stop** 四个。
    - ⚠️ **排队等槽不在树行发后缀**：设计稿叶子行只有「点 + 任务名 + 徽标」
      三件；等槽文案属**右栏**的进行态行（`SessionDetail.pending`），细粒度
      信息只有一个落点。
    - ⚠️ **共享组件 `ui/TreeList.svelte` 本体不动**：新形态全靠 ai 面板根上的
      作用域类（`.wengu-ai-list .b3-list-item .wengu-aipanel-*`）与 main/trailing
      片段表达——知识面板/侧栏树两棵树零回归（改 TreeList 会同时改三棵树）。
- **详情（右栏）三段**（`ai/components/SessionDetail.svelte`，视图模型在
  `ai/core/SessionDetail.ts`，纯逻辑带单测）：
    - `head`：h3 任务名 + `kind=xxx` 徽标 + 状态徽标（**与树叶子行同一份判定**
      ——两处不会各写一套状态词）；
    - `body`：`log-label`「轮次日志」+ `ul.log`（**时间戳 + 摘要**两列 grid，
      数字走 `<em>` 强调位）；
    - `foot`：归属备注（`own-note`）或错误态重试钮。
    - ⚠️ **摘要行由纯逻辑切成 `parts` 段**（`{text, em}`，归属备注另有
      `bold`/`accent` 两个标记位），组件零字符串解析——拆串拼 HTML 有注入面，
      分段数组没有。取词模板里的 `{n}` 即强调位：中英两套模板的强调位置各由
      自己的模板表达，代码不猜哪几个字符是数字（A7 的 `own-note` 同款：
      首句加粗 + 正文 + 入口词主色四段由 `FlowOwnership.ownershipSegsOf` 给，
      引号/句读属各语言模板，代码不拼句）。
    - ⚠️ **轮次日志一行 = 一轮**（#92 gap-list S6）：成对的 `user`+`ai` 轮
      **合并成一行**「轮次 N · 输入 X 字 → 输出 Y 题」（turns 有序 ⇒ 轮次号
      可编、字数字符串长度恒可数）；未配对的尾轮退化成单侧行，孤立的 `ai`
      轮出「只出」行。设计稿的「校验 N 题，其中 M 题重试」「写入题集」是
      **mock 专属**，不出。⚠️ **行数与轮号是渲染侧真吃的字段**——#88 的
      「逐轮时间戳」用例原本按「一轮一行」断言，本单合并后必须同步改口径
      （回归测试已锁）。
    - ⚠️ **题数只出数得出来的**（`questionCountOf`：`@@Q` 标记行或行首编号）：
      设计稿那串「输出 8 题」是 mock，硬猜会把错的数写进日志。数不出只报字数。
    - ⚠️ **全文不能丢**：设计稿的日志行是摘要形态，而面板的核心用途是**回看
      产出**——每行带回 `full`（合并行=`prompt\n\n回复`）、点行展开。换记录靠
      `{#key sel.id}` 重挂 ⇒ 展开态自然复位。
    - **行展开态：默认展开 + 输入/输出分块**（Issue #98，稿外形态补全——设计稿
      三屏没有已完成态详情屏）：一般成功记录只有一轮，再点一下才看到产出是多余
      动作，故**默认全部展开**（多轮也全展开，详情列已有内滚兜底）；点行头仍可
      收起/展开，交互本身不变。组件侧记的是「被显式收起的行」集合
      （`closedRows`）——重挂即清空 ⇒ 新记录回到全展开，无需看行数重算。
      ⚠️ **开合与可展开两条判据都在 core 侧**（`isRowOpen` / `canExpandRow`，
      带单测）：组件自持的 `$state` 挂不进 vitest，判据留在组件里「默认展开」
      就没有回归锁；两条判据只此一处，组件**不得**另拿 `full` 再判一遍
      （分叉即一个手势两种行为）。
        - **展开后的正文按侧别分块**（`SessionLogRow.segments`：user 侧带
          `aiLogIn`「输入」、ai 侧带 `aiLogOut`「输出」，**两键中英同步加**）；
          缺侧的尾轮（或孤立 ai 轮）只出一块。**标签取词在 core 侧**——组件不取词
          （同 `parts` 的分段口径）。
        - ⚠️ **摘要行本身不动**：仍是一行一轮的 S6 形态，分块只在**行展开态**里做。
        - ⚠️ **可展开判据 = `canExpandRow`（`segments.length > 0`）**，与 `full !== ""`
          同义（收口的状态行如错误行两者皆空 ⇒ 不出可展开手势）；`full` 保留为
          无标签兜底，判据不再有第二份。
        - ⚠️ **块序连排、DOM 序保持 user 在前**（读屏与整段复制的阅读序必须是
          真实先后）：行是单一 `grid` 容器，两个块各 `grid-column: 1/-1` 序连排；
          块间距纯 `margin` 微调（`aipanel.scss` 的 `.wengu-aipanel-logseg` +
          相邻块选择器）——**不许用 `order` 翻转 DOM 序**。
          ⚠️ **块间收紧必须写 `+ .wengu-aipanel-logseg`（相邻块），不是
          `:last-child`**：单块行（缺侧的尾轮/孤立 ai 轮）里首块同时是末块，
          `:last-child` 会把那唯一一块的留白一并收掉、标签直接顶上摘要行。
        - ⚠️ **输出块不设 `max-height`**（面板核心用途是回看产出），长内容由
          **宿主主区那一扇唯一的滚动窗**兜住（`.wengu-ws-main` 的
          `overflow-y:auto`）——详情列**没有**内滚窗（#96 的收内滚已撤，
          见本节末 #129 那条）。
    - ⚠️ **空脚不渲染**（Issue #98）： `ownNote` 为空且 `retryable` 为假时
      `.wengu-aipanel-dfoot` **整块不出**（连同 padding/border-top/底色）——空
      容器的色带在已完成态看起来就是「下方空一块」。在途/停止态的 own-note 与
      真失败的重试钮照旧。
    - ⚠️ **时间锚只取「真实可推」的两点**：登记簿只存记录级 createdAt/
      endedAt（内核不回传单轮时刻）——**user 侧=createdAt、ai 侧=endedAt**，
      **不按时间窗均分编造中间时刻**（编出来的数字看着精确却是假的，同
      「题数只出数得出来的」口径）。全用 createdAt 的后果是整条时间线恒同
      一刻（设计稿是 14:22:07 → 14:22:48 的推进），读起来像「时间戳坏了」。
      未收口（running）无 endedAt → 回落起点，即「只有起点是真的」的诚实形态。
      ⚠️ **S6 合并后一行只有一列时间戳**：合并行取 **ai 侧的锚**（收口时刻
      更接近「本轮产出何时到」），无 ai 侧的尾轮落 user 侧锚——
      `rowsOf(t, turns, anchorOf)` 的 `anchorOf` 是唯一取锚点，别退回
      「全行用 createdAt」。
    - **被停止的记录**（`AI_STOPPED`）：末行出「收到整批停止指令 · …」
      （**非红**，设计稿 stopped 屏的末行）、出「前往页内转换条抉择」入口
      （`decidable`）、**不出重试钮**（它是整批流的一部分，单笔重跑会脱离
      那条流）；归属备注换成「已随整批停下、抉择只有一处入口」的**停止态
      文案**（与在途态的「要停止请去横幅」是两句话，`FlowOwnership` 的
      `stoppedConvert`/`stoppedBatch`）。⚠️ **#92 把这段文案从整串改成分段
      后，两态语义必须原样保住**：首段（加粗位）取 `aiOwnStopped*` 两键，
      且停止态**不出「停止」动作词**（用户已经停过了，动作是页内抉择）。
      ⚠️ **停止态必须持自己的一整套词，绝不与在途态共用 body/tail**
      （#93 复审必修，实现期真踩到）：`aiOwnBody`/`aiOwnTail` 是**为一对
      引导引号设计的**——开引号在 body 尾、闭引号在 tail 首，中间夹 accent
      的入口钮词。停止态省掉 accent 段后，body 的开引号与 tail 的闭引号
      **直接相撞成空引号对**「」/“”，而 body 的「要停止请用…」还在给一条
      **已经停了**的记录下停止指令（自相矛盾）。故停止态走
      `aiOwnStoppedBody`/`aiOwnStoppedTail`（转换支，指路页内转换条这个
      唯一抉择入口）与 `aiOwnStoppedBatchBody`（六个批流支**没有抉择**，
      不指路转换条——那是另一条流的入口；该支正文本身已是完整一句、
      **不收尾**，故两段）。**在途态四段形态不动。**
      ⚠️ **停止态不许「读一个不存在的收尾键、靠空值判不渲染」**（#93
      复审第二处，与上面同源）：插件取词是 `i18n[k] || k`（`quiz/index.ts`
      的 `this.t` 等六处同款），**缺键或空串值都回落键名**（truthy）——
      `const tail = t("某键"); if (tail) push(...)` 会把**字面键名**当正文
      渲染给用户（批流支原先正是如此：`aiOwnStoppedBatchTail` 两字典都
      没有，面板上直接显示这串英文）。故批流支走 `if (batch)` 显式分支、
      **根本不读收尾键**；要「某支不收尾」就写分支，别写空值回落。
      三条锁：段键序列 + **成句级断言**（`FlowOwnership.test`：拿真实
      i18n 把段拼成整串，断言停止态不含停止指令子串、无空引号对、引号
      配平——段键全对而句子仍坏正是本坑的形态，只锁段键锁不住）+
      **幽灵键断言**（同上用例：请求过的每个键必须在字典里且非空串、
      且整串里不得出现键名——`||` 回落这条通道只有这条锁得住）。
      `FlowOwnership.test` / `SessionDetail.test` 各有用例锁死。
- **记录 title 的任务名化（数据层配套）**：
    - `AiSessionStore.retitle(id, title)`（**新增通道**，optional 只加不改名、
      存量记录不回填）：转换批记录的批号/题数在**批落库时**才知道，而
      `begin` 在调用前，只能给类别名——落库后补成「生成第 N 批 · M 题」。
      **只改 title 不碰其它字段**、**不设状态闸**（收口快一步的极端时序也该
      改名）、**同值零动作**（不触发 notify/落盘）。
    - 接线：`ConvertSegment` 把本批生成的**登记 id** 经 `makeCall` 的 `onSid`
      回传 → 进 `SegmentBatch.sid` → `ConvertBatch` 在 submit 落库后
      `aiSessions()?.retitle(...)`。**批号取片内序**（`batchNo`）而非跨片累加
      ——片是并行单元，跨片序不确定；片内序即用户读到的「第几批」。
    - ⚠️ **`makeKnowAwareAi` 的 `onSid` 是两条链并存**：`abort.onSid`（停止，
      #72）与 `onGenerateSid`（改名，#88）。写成 `??` 二选一会静默丢掉其中
      一半（面板点停无效，或行名永远停在类别名）——实现期即此处分叉，两个
      用例分别锁死。
    - **其它域的 title 语义不动**：本单只改转换批的命名与渲染，判题/路由/
      标签等照旧。存量记录（title=「转换」）渲染回退现状形态，不悬空。
- **中止 ≠ 失败（Issue #88 复审补记）**：用户停止整批流时，在途调用被
  断流收口，**不能记成红色「失败」**（横幅说「转换已停止」而记录说「失败」
  ——正是本单名点名的两处口径分叉）。故 `AiSessionStore.aborted(id)` 落
  `AI_STOPPED` 哨兵（status 仍是 error，**不动状态机与存档 schema**）；
  `succeed`/`retrying` 照旧清 error ⇒ 哨兵不残留。
    - ⚠️ **判据是「signal 已断 **且** 理由为 AI_STOPPED」，不是裸的
      `signal.aborted`**（`ai/client.isUserStopOf`）：转换/增量族的
      「面板停止」与「被兄弟失败连坐断掉的其余 in-flight 调用」走的是**同一
      个** signal（编排层 `internal.abort()`），只看 aborted 会把后者也标成
      停止——用户明明失败了却看到「停止」，比不标更坏。故约定：**业务侧凡
      用户显式停止，abort 时都带 `AI_STOPPED` 理由**（Issue #88 起重申——
      全仓的 `abort()` 调用点只有「用户显式停止」这一类带理由，其余一律裸调：
      本单是「**该带理由的都带上了**」而不是清单枚举）；理由缺失（旧调用方/
      不支持 reason 的运行时）一律按失败处置——**宁可报失败，不可把失败说成
      停止**。
        - **带理由的用户停止路径**（新增任何「停止」入口都必须并入本组）：
          转换族 `abortFlow`（= 页内停止与面板点停的唯一总闸）、
          `stopConvertRun`、增量 `relayStop`、`aiAbort()`/`abortAiSession`
          （面板停止的两种句柄形态），以及 **AI 索引流的三处**——
          `KnowPanelCtl.outline` 的「再点=中止」、`executeOutline` 的
          `aiStopHandle` 接线、`KnowOutlineFlow.runOutlineFlow` 的横幅停止
          钮（三处同一个自建 `ctrl`）。⚠️ **别只改前两处漏掉横幅**：
          索引流是 #72 登记的第三条多调用流，三处漏一处就有一条路径把用户
          停止显示成红色「失败」。
    - **抉择入口只属转换族**（`FlowOwnership.decideEntryOf`）：保留/丢弃是
      转换条的动作，六个批流停下即停下——给它们出「前往页内转换条抉择」
      会把用户引到**另一条流**的入口。`SessionDetailView.decidable` 因此由
      宿主按流归属注入（与 `ownNote` 同口径），本模块不猜。
- **样式在 `scss/aipanel.scss` + `scss/aipanel-tree.scss`（`.wengu-aipanel-*`，
  拆两片——前者卡壳/状态语言/页根/详情，后者「② 树」整段；**20260915 按单文件
  ≤500 行硬约束拆出**：补高度链（#96）与详情改造（#98）后 aipanel.scss 到 576 行，
  口径同 rail.scss 逼近红线时把 aiflow.scss 单开一片的先例；拆的是**文件边界
  不是职责**，类名与令牌同源）**，`index.scss` 里 `@use`（**本片须排在
  aipanel.scss 之后**——片内含 ≤1000px 折单列的 `@media`，要覆写基础片里的
  `grid-template-*`，`@media` 不加特异性、按源码序决胜）；`@keyframes wengu-ai-spin`
  仍留在 rail.scss 供各片共用。**色值一律 `var(--b3-*)` 全名**（#70 口径）；
  设计稿的 `--ok-solid`/`--fail-solid`/`--accent-dim` 等语义令牌落成 b3 令牌 +
  `color-mix` 组合（同 aiflow.scss 口径）。
- ~~**整页不滚动（Issue #96，20260915）**~~ → **已撤（Issue #129，20260915，见下节）**。
  #96 曾把本面板收进「一个屏高 + 两列各自内滚」，**与设计稿正相反**。下面这段
  是历史记录，**不要再照它改代码**；现行口径读本节末「AI 会话面板对稿精修
  （Issue #129）」那一条（单滚动窗）。原方案（**已退役**）：
  面板高度适配宿主视口、滚动收进卡内两列——**推翻 #93 的 gap-list S4 取舍**；
  四处咬合：宿主档位（`ai/core/PanelFit.ts` + `.wengu-ws-main--fit` 改写主区
  flex 列 + `overflow:hidden`，开关在挂载/卸载配对、只动本面板那一份、判据在
  `workspaceFits`）、高度链（面板页根 → 卡 → 两列，每级 `min-height:0`）、
  grid 行高显式分配（`auto minmax(0,1fr)`）、内滚窗落两列
  （`overflow-y:auto` + `scrollbar-gutter:stable` + `overscroll-behavior:contain`）。
  ⚠️ 这些类名/文件**现在都不存在了**（`--fit` 档、`PanelFit.ts`/`PanelFit.test`、
  `fitHost`、两列的 `overflow`/`scrollbar-gutter`、`grid-template-rows` 全删）；
  引到它们即为死接线。
- **单流态横幅 bar 复核**：`ConvertFlow.barOf` 有 `readPct` 即出条，
  `bannerViewOf` 按「无 queue 才出 bar」分流——已被 `FlowBannerUi.test` 锁死，
  本单只复核、未改。
- **范围外**：六个批流的进度摘要上报（#79 遗留 B）仍不做。

### AI 会话面板对稿精修（Issue #129，20260915；差距清单

`design/aipanel-gap-list.md` + 施工规格 `design/convert-stop-redesign-spec.html` 06 节）

- **执行定稿（与 #96 相反，务必先读这条）**：面板是**单滚动窗**——卡随内容长，
  滚动归宿主主区 `.wengu-ws-main` 的 `overflow-y:auto`。稿里两列都没有滚动窗
  （gap-list S4），所以**不造**二级滚动条：`.wengu-aipanel` 去 `flex:1/min-height:0`
  与 `grid-template-rows`，`.wengu-aipanel-tree` / `.wengu-aipanel-pane` 去
  `overflow/min-height:0/scrollbar-gutter`（树只留凹槽底+右边线+padding，详情列
  只留 surface 底 + `min-width:0`），`.wengu-aipanel-dbody` 回到稿的
  `min-height:120px`。`--fit` 档 + `ai/core/PanelFit.ts`（含单测）整体删除，
  `ai/SessionPanel.ts` 的 `fitHost` 同步退役——**判据看稿不看规范条文**
  （AGENTS.md 已同步标例外）。
- ⚠️ **树头「N 组」按去重类别数算**（`new Set(recs.map(r => r.kind)).size`）：
  稿的语义是种类数，而单条种类不设层（叶子直接上提）时 `tree.nodes.length` 会数少。
- ⚠️ **详情头状态徽标贴右由它自己吃 `margin-left:auto`**（`.wengu-aipanel-stbadge`），
  不能再写 `.badge:last-child`——徽标后面有个**常空的 meta 槽**（`<span
class="wengu-aipanel-meta"></span>`，S7 留槽口径：稿内无「时间 · 模型」串，
  非空才用），`:last-child` 会落空、徽标被挤回中间。两条都有源级锁
  （`ai/core/AiPanelGapRestore.test.ts`；样式侧走 `sass.compile` 编译产物断言
  ——`?raw` 对 scss 恒空串）。
- ⚠️ **叶行行尾注记是「间隙期形态」**（见 SessionPanelApp 头注释）：S5 要求删
  时间戳（时间在详情日志首列），但登记簿只有**记录级** `createdAt/endedAt`，
  「显示当前选中记录的时刻」会给出**假时刻**（点开一条旧记录，行上显示的不是
  它的时间）。故未选中时出「MM-DD HH:MM · 类别」（`aiRowMeta`，i18n 单模板），
  选中即整行让位给详情；删除钮仍 hover 才显。等 `data/AiSessions.ts` 存下逐轮
  时刻后，按 S5/S6 的终态收敛（时间戳只留详情日志列）。
