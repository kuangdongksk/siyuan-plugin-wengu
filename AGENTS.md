# AGENTS.md — 温故插件开发与调试备忘

给 AI 编码代理的项目说明。**调试环境按机器区分**，两台机器各自一节，
在别的机器上先确认本节路径/端口/token 再动手，并回填缺失信息。

## 工作流（2026-09-10 起）：云端开发，本地只调度 —— 最高优先级约定

**本项目所有业务代码改动一律在 CNB 上由 NPC 完成，本地不再直接改代码。**

| 角色                    | 在哪       | 职责                                                                 |
| ----------------------- | ---------- | -------------------------------------------------------------------- |
| 飒飒 + 本地青简         | 本地       | 审查代码与 PR、出方案 / 设计稿、开 Issue、召唤 NPC、跟踪流水线、合并 |
| 云端 NPC（青简 / 复核） | CNB 流水线 | 拉 `dev` 分支实现、写测试、跑自检、开 PR                             |

标准流转：

```
本地出方案 → 开 Issue（附文件路径 + 可验证的验收标准）
          → 评论召唤 NPC（必须勾「替我上班」）
          → NPC 基于 dev 拉分支实现、开 PR（base 必须是 dev）
          → 本地审查（拉分支到独立目录独立验证，不信自述）
          → 合并进 dev
```

- **一次只跑一个 NPC 任务**：多个 PR 同时开，容易抢改同一个文件（尤其本文件）。
- **例外（仍属「调度」范畴，本地可直接改并推送 `dev`）**：`.cnb/`、`.cnb.yml`、
  本文件的协作约定段 —— 它们是 NPC 运行所依赖的**调度基础设施**。
  **业务代码（`src/`、`tests/`、`docs/` 正式文档）没有例外，一律走云端。**
- **CI 已替你做机械检查**（20260910 落地）：`.cnb.yml` 的 `$` 节点下配了
  `quality-gate`，`push` 与 `pull_request` 都自动跑「格式 → eslint →
  svelte-check → 测试」四件套（由快到慢，尽早失败）。审查 PR 时**先看 CI 结论**；
  只有要复现失败、或怀疑它动了四件套覆盖不到的地方，才在独立目录重跑。
  ⚠️ 四件套**不含 webpack 打包** —— 动了入口 / 依赖 / `webpack*.js` 时本地补一次
  `pnpm build`。
- **审查 NPC 的 PR 时不要只信它的自述**：要重跑就拉分支到独立目录（如
  `git worktree add /tmp/wengu-review <branch>`），跑 `pnpm test`、
  `pnpm check:svelte`、`pnpm format:check`，eslint 一律用
  **`pnpm exec eslint .`（不带 `--fix`）** 对齐 CI 口径。
  ⚠️ 本地 `pnpm lint` 是 `eslint . --fix`，**会就地改文件** —— 别在正在开发的
  工作区跑。CI 里刻意不用它：`--fix` 会把违规直接改掉再退出 0，门禁形同虚设。
- 只读操作（看代码、查内核 API、跑只读 SQL）不受此限，随时可做。

## 分支与协作（CNB + NPC）——动代码前先读

双远端：`origin` = GitHub（历史存档），`cnb` = CNB（云原生构建，NPC 开发在这边跑）。
CNB 仓库：<https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu>

- **`dev` 是长期开发分支，`main` 只作稳定发布分支。拉分支、提 PR、合并，
  三处都必须是 `dev`。**
- **CNB 仓库的默认分支必须始终保持为 `dev`。** NPC 事件
  （`issue.comment@npc`）的流水线固定跑在「仓库默认分支」下——默认分支一旦
  是 main，NPC 就会拿 main 当基线写代码。
- **建仓时的正确姿势（20260910 实测）**：CNB 建仓库时**不要勾选任何初始化**
  （README / .gitignore 都不建），得到一个空仓库；首个推送的 `dev` 会自动
  成为默认分支，`get-head` 直接返回 `dev`，无需手改。反之，若建仓时初始化过，
  默认分支会固定为 `main`，而 **CNB OpenAPI 不提供修改默认分支的接口**
  （`PATCH /{repo}` 只能改简介/站点/许可证，git 模块只有 `get-head`），
  只能去网页改（仓库页 → 设置 → 默认分支）。
- 开工基线：`git fetch cnb && git checkout -b <type>/<slug> cnb/dev`，
  分支名用 `feat/` `fix/` `refactor/` `docs/` `chore/` 前缀。
- PR 的 base 一律 `dev`，描述里带 `Ref: #<Issue 编号>`。
- 禁止直接向 `dev` / `main` 推送，一切改动走 PR。**唯一例外**：本地改「调度
  基础设施」（`.cnb/`、`.cnb.yml`、本节协作约定）时可直接推 `dev`，见上一节。
- NPC 角色与硬约束写在 `.cnb/settings.yml`；Issue 模板在
  `.cnb/ISSUE_TEMPLATE/`（两者都从**默认分支**读取）。
- **模型与推理档位**在仓库根 `.cnb.yml` 的 `npc:go.options` 里配（`settings.yml`
  没有 model 字段）：`$` 兜底 `deepseek-v4.1-flash`，「复核」角色覆盖为
  `glm-5.3-flash`。改完要实跑一次，用
  `cnb build get-build-ai-audit --sn <sn> --pipelineId <sn>-001` 核对
  `models{}` 里的 key 是不是写对的那个 —— ID 写错会让流水线直接失败。
- **`.cnb.yml` 里严禁新增 `dev:` 顶层节点**（20260910 查文档确认）：分支匹配是
  「**分支级独占**」而非「事件级回落」—— 系统先做 glob 匹配，**只有未命中 glob 的
  分支才走 `$` 兜底**。两个 NPC 事件都挂在 `$` 下且都跑在 dev 上
  （`issue.comment@npc` 用默认分支、`pull_request.comment@npc` 用 PR 目标分支），
  一旦加了 `dev:`，dev 就不再走 `$` → **召唤 NPC 毫无反应且不报任何错**，极难排查。
  所以 `quality-gate` 也配在 `$` 下与 NPC 事件共存。顶层另两个合法语义：分支 glob
  （按触发分支匹配）、角色名（与 `.cnb/settings.yml` 的 `npc.roles[].name` 逐字一致
  时才加载，与 `$` 合并、同名事件覆盖）。
- **召唤青简必须写完整路径**：`@sasa1107/open-source/si-yuan/siyuan-plugin-wengu(青简)`。
  裸 `@青简` 不会触发任何流水线（20260910 实测），系统内置的才写 `@CodeBuddy`。
- 要让它真的写代码，评论时必须开 **「替我上班」**（API：`post-issue-comment --work-mode`）。
  不开只有读权限，`npc.work_mode` 会是 `false`。

## 项目速览

- SiYuan 插件「温故（wengu）」：笔记文档 → AI 转习题 → 页签刷题。
- 源码 `src/` **按功能分域**（2026-08-26 重构，组织方式借鉴 sy-lively）。
- **各域 `index.ts` 必须是该域的入口编排代码，禁止纯 re-export barrel**；
  共享类型在 `src/types.ts`，样式 `src/scss/` 分片。

### src/siyuan/ —— 内核 API 工厂

- `api.ts`：路径枚举 `EApi`；`KernelBlock` / `KernelDoc` / `KernelNotebook` /
  `KernelQuery`（SQL）。薄封装，迁自 sy-lively 构建工厂。
- `KernelQuery`：rows 泛型收窄 / rowsMap；**rowsAll/rowsMapAll 自动
  LIMIT/OFFSET 分页——全量查询一律走它，别手写循环**。
- 2026-08-26 已把全仓 ~33 处散落内核调用收拢进来。
- 两类特殊通道例外：SSE、putFile multipart。工作区文件读写/删在
  `files.ts`：getFile 裸内容 / putFile multipart / removeFile 信封——词书
  等非块文件走它。
- `attrs.ts`：题目契约属性常量。
- **新增内核调用先走工厂，别散落 fetchSyncPost。**

### src/ai/ —— AI 基础设施域

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
- **prompts/ 子域**（20260910 起全仓 prompt 集中收口，八文件按场景家族分域）：
    - common：逐字共用片段。protocol：行协议 + **题型注册表**（`protocolSpec(types?)`
      / `typeRulesFor` / `materialRulesFor`；types=undefined 走全量兜底与改造前
      逐字节一致）。convert：buildPrompt 题型化（含逐段自推进的 `StepContext`
      批次上下文与 `@@TO` 定位约定）+ 大纲归纳（`detectWindowPrompt` 已随独立
      检测退役删除）。gen：
      概念/变式/重生成/自检/自由标签，单题场景题型已知按题裁剪。route：章小节×
      单批批量四联 + knowRule 插槽，路由上限常量随 prompt 落此。judge：判分族+
      轮报分析 + byBaseQid。misc / companion。
    - **生题题型化**（20260910）：前置检测 TYPES 行顺带报题型（parseTypes 中英
      别名容错、分段并集），buildPrompt 只拼在场题型规则（数学卷不再带英语四类
      约定）；续跑/增量跳过检测时用题集既有记录题型并集（BankSets.setTypeUnion
      零 AI）；开关产出题型（填空转选择→single、大题拆多步→steps）不受检测影响
      恒在。

### src/quiz/ —— 做题主流程

- `index.ts` = QuizView 编排（546 行，压回基线；Issue #12 起记账镜像
  外移 `service/AnswerMirror.ts`、销毁清单外移 `flow/Teardown.ts`、
  右键弹窗动作外移 `service/DocActions.ts`）。**访问器表 + 编排职责
  外移的两难仍在**：再加功能先看有没有能外移的成块职责，别再净增。
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
  **不 revealAll**。收卷唯一入口是头部「交卷并查看答案」
  （`endRound` → `manualFinishRound`）。instant 模式照旧 `roundComplete`。
  steps/slots 完成仍靠 `checkAllDone` 凑「全部 graded」信号，别整个删掉。
  ⚠️ 连带口径：**「未完成轮」判据只看 `endedAt`**（`StartPanel` 两处
  `unfinished`）——原先还要求 `answered < 题数`，那条只在 instant 下成立，
  after 答满未交卷的轮会被判成「已完成」而无法「继续上次」改答案。
  `lockAllCardsNow` 是**状态级 + DOM 级双管**（`ui.locked` 是真闸）。
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
- **词表区与正文词形联动**（Issue #30 渲染侧）：`quiz/service/GlossDom.applyGloss`
  是材料填充的**唯一**词表后处理入口（两个挂载点 `GroupUnitApp` 与
  `ProtyleHost.mountStatic` 都过它）——`@@G` 行渲染为 `ul.wengu-gloss`
  （词条下划线/音标弱化/释义常规），正文里与词表词形精确匹配的**首次**出现
  包 `span.wengu-gloss-link > u + sup`。样式在 `scss/english.scss`。
    - **与 #29 线索 mark 两条后处理互不嵌套**（接口约定，别只改一侧）：
      GlossDom 的匹配跳过 `mark.wengu-clue-mark`；`ClueMarkDom` 的
      `SKIP_SELECTOR` 也已加 `.wengu-gloss` / `.wengu-gloss-link`。挂载顺序
      固定「词表 → 线索」（两处调用点同款）；两侧都幂等（先摘旧标记再重铺）。
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
  题干区 `.wengu-qprotyle`（浮条按钮按选择位置分流）；高亮与 chips
  只有一个入口 `ClueFlow.refreshClueMarkFor`（材料填充后/题干挂载后/
  会话恢复后三处都过它，幂等），选段定位与 chip 两击删除状态机的纯
  判定在 `flow/ClueMark.ts`（带单测）、DOM 手术在 `flow/ClueMarkDom.ts`。
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
      `applyClueMarks` 先对**未改动**节点表算全部计划（`planMarks`）再倒序
      施工——正向施工会把同一节点里的后一处命中推出已被 `splitText`
      截短的节点（与 `GlossDom.assignHitsToNodes` 同款口径）。匹配不上仍
      降级（只 chips 不高亮，宁缺勿错）。
    - **空白必须全丢而不是折叠**：DOM 里 `</p><p>`、`<strong>` 边界之间是
      **零空白**，用户拖选得到的是换行——只折叠不丢，跨块边界永远匹配不上。
    - 桌面客户端「点按钮无反应」防御三件套（Web 端复现不了）：浮条根**捕获
      阶段** `mousedown` → `stopPropagation`（隔离宿主全局监听）、按钮监听
      改 `pointerdown`（更早快照选区）、`lastSelText` 选区快照兜底（选区在
      某层被清也能标上；`hideBar` 一并清掉，别标到陈旧选段）。
    - ⚠️ **`SKIP_SELECTOR` 与词表区 `.wengu-gloss`/`.wengu-gloss-link` 的
      互不嵌套约定不许破坏**（#33/#34 定的接口）：`GlossDom` 跳
      `mark.wengu-clue-mark`，`ClueMarkDom` 跳词表区，两侧幂等，挂载顺序
      固定「词表 → 线索」。

### src/convert/ —— AI 转换（`index.ts`=转换编排）

- **逐段自推进**（20260910 起整卷转换**不再预切块**）：从「`structuralChunks`
  按标题链切块 → 逐块发 AI」改为**自推进游标循环**——`source/CursorWindow.ts`
  取「游标起约 6k 字符」的窗口（`stepWindow`；窗口只是给 AI 看多少，**不是
  批边界**），AI 出题并在回复末尾输出定位行 `@@TO: <原文逐字片段>`（或 END），
  `advanceCursor` 把片段还原成偏移推进游标（去空白去标点归一化匹配 + 行尾
  吸附；命中点必须落在本窗口内且严格前进，否则兜底按整段窗口推进并计入
  定位失败计数）。**批边界因此落在题目边界上**：片段末尾没写完的题由 AI
  整道留给下一批（prompt 约定见 `StepContext`），题干与解答同批，不再有旧
  切块把题拦腰切断、答案块与题干块分离的情形；`@@TO` 行由 `stripToDirective`
  解析前剥除。
- **分片并行**（20260910，与上一项配套）：**「任务并行单元」与「批边界」是
  两件事**——批边界仍由 AI 的 `@@TO` 定（片内不变），并行度由外层分片提供：
    - `source/ShardPlan.ts` 的 `planShards(md, target, from)` 取**切点**把源卷
      切片：候选**按可靠性分级**（应对千奇百怪的源格式）——`heading`（`#` 至
      `######`，及 HTML `<h1>` 至 `<h6>`）、`marker`（超级块 `{{{`、分割线 `---`、HTML 块级
      标签）、`qnum`（`第N题`/`习题N`/`(N)`/`N.`/`【…】`）。选点用**代价函数**
      `质量分 - 归一化距离`（`KIND_SCORE`：heading 1.5 / marker 1 / qnum 0.5，
      以理想片长为单位），即「质量优先、距离差一个量级时让步」。片间连续覆盖
      全文、互不重叠；`from` = 续跑起点（断点落在片中间也天然接续）。
    - **弱边界不参与分片**（空行、任意行首）：切点若不在题目边界上，片尾那道题
      会被硬切成两半——前片按「末尾没写完」约定跳过、后片只看到后半截，结果是
      **漏题**且无兜底（硬切点由代码定，与 AI 的 `@@TO` 无关，事后无法校正）。
      因此拿不到可靠切点就**退化为单片**（= 纯串行，零风险）。
    - `refineShards` **超长片二次细分**：贪心是局部最优，某理想位置附近只有很远
      的高级切点时会留下超长片（实测某卷 8 片里出现 2 倍长片，等于并行度白丢
      一半）。对超过 1.35 倍理想片长的片在片内再补一刀，补不动就跳过。真机 45
      篇 4 万~25 万字符文档实测：**45/45 拿到 8+ 片**，最大片偏差 31%、平均 12%
      （无细分时 108%/21%）。
    - `run/ConvertSegment.ts` 的 `runSegment(shard, deps)` 只跑片内循环：窗口
      上限取片尾（`stepWindow(..., seg.end)`），产物经 `deps.submit` 交付，本身
      **不落库、不报进度**；每片首批照旧带判定与 TYPES（各片题型取并集）。
    - `run/ConvertBatch.ts` 编排：worker 池按 `parallel`（1~4，弹窗/设置面板给值，
      1 = 改造前行为）并发跑片；**片序闸门**（`submit` 里 `await gate[i-1]`）保证
      落库恒为按源顺序的**连续前缀**——SetWriter 的题单顺序与材料链
      （`lastMaterialId`：小题引用文中紧邻其前的材料）都是顺序敏感的，乱序落库
      会跨片错位。连续前缀也让**续跑断点仍是单游标**、终止「保留」语义不变。
      目标片数 = 并发度 × 2（片略多于流水线数，消化片长不均）；任一片失败即
      中止其余片，已落库部分仍是可续跑的连续前缀。
- **词条行保真**（20260910 起，Issue #30）：英语原卷的词条行（`词 ^{记号}
音标 释义`，考研真相形态）在转换时被 AI 整行剥掉、正文的 `^{补}` 残渣
  漏成字面文本。链接两端：
    - `src/convert/service/gloss/`（纯逻辑 + 后处理）：`GlossEntry` 行协议
      （`@@G 词 | 音标 | 释义`）往返、`^{...}` 记号采集/剥除、正文词形
      **精确匹配**（词边界对齐、含 possessive、不做词干还原）与**原卷词条行
      确定性解析**（`parseRawEntryLine`：词 + `^{记号}` + 音标 + 释义三段收
      紧，防把正文句子当词条）；`GlossFold.foldGlossIntoDrafts` 是本批
      **消费源区间**里的兜底采集（AI 给了以它为准、AI 没给才补）、
      `^{...}` 残渣落库前一律剥净。接线在 `ConvertSegment`（区间定下后、
      洗牌前）与 `ConvertIncrement`（同口径）。
    - prompt 约定在 `ai/prompts/protocol.materialRulesFor` 的英语题型段——
      **四类英语题型不在场则整段省略**（非英语卷 prompt 产物零词条段）；
      词表区的落库标记 `@@G` **不进 `questionHash`**（材料正文不是题目记录
      kramdown，冻结清单不碰）。
    - ⚠️ 踩坑四条（前两条 PR #33 发现、后两条 #33 审查复现后补齐）：
        1. `MARK_RE` 用 `\s*` 作前导会**跨行**把上一行的词吃进来（记号归属
           误挂）——必须 `[ \t]*`；
        2. 词形归一 `normWord` 必须保留 `\p{L}\p{N}`（中文「补」「同」也是
           合法记号，只认 ASCII 会静默丢条目）；
        3. **`^{...}` 处理必须避开数学/代码区间**（`protectedSpans`）：数学卷
           的 `$x^{2}$`、`$$\int x^{n}$$` 里的花括号是 LaTeX 指数，剥掉就是
           公式静默丢指数（`x^{2}` → `x`）；行内/围栏代码里的 `^{}` 同理。
           剥除与采集共用 `eachMark` 这一条扫描链，别另起正则。
        4. **多篇材料一篇都不补词表**：批内源区间是跨篇的，词条行按篇归属
           无从判定；补进首篇会把 B 篇词条挂到 A 篇（串篇），故只在
           `mats.length === 1` 时确定性补。AI 逐篇各给的词表照旧逐篇认领。
           另加**置信判据** `isConfidentEntry`（带音标或词性标签才算真词条）：
           数学习题里 `a^{n} 表示 n 次幂` 与词条行形态无从区分，无此闸会挂出
           伪词表（宁缺勿错）。

- **判定合并进首批**（20260910）：独立前置检测（原先按 12k 分段并行问「能否
  出题 + 题数 + 题型」）整体退役——首批生成顺带输出 CAN_CONVERT/REASON/TYPES
  三行，题型先验喂后续批次的题型化 prompt；单窗口文档首批即判 no 直接拒绝，
  长文档首段可能只是封面/目录故不据此拒绝（零产物收口时才报该原因）。
  `draft/ConvertDetect.ts` 只剩 parseTypes / questionPreview 两个纯解析。
- **进度按已读比例**：批数事前未知，`ConvertProgress.readPct` 出「已读原文
  p% · 累计 c 题」（并行下 = 各片进度之和）。
- **批数两种口径必须分账**（20260910 并行回归）：`ConvertProgress.batch` =
  **已落库批数**（`submit` 每落一批 +1）；`BatchedResult.batches/total` 与
  `ConvertProgressRecord.batches/total` = **实际 AI 调用批数**（= Σ
  `SegmentResult.batches`，含零产物批、不含纯标题跳过窗口）。两者同时发生但
  语义不同，混用一个变量即面板/终止提示批数翻倍；回归测试
  `convert/service/test/ConvertBatchCount.test.ts` 锁死该口径。
- **20260903 存储收口：转换零落盘，产物直写题库**：`service/output/SetWriter.ts`——
  DraftUnit → renderUnit 出契约 kramdown → parseQuestionKramdown 反解 +
  questionHash 构造 BankRecord，与旧「落文档再回读入库」产物同构；材料正文进
  bank.materials、小题 group 写时直配材料 id；每批 flush 崩溃安全，终止「保留」
  零动作/「丢弃」按写入 qid 清单回收；渐进呈现改内存视图直出，无内核索引轮询；
  题集=BankSet 库内实体见 bank 域。
- **生成输出行协议**（20260902）：AI 不手写 kramdown，改输出 `@@Q/@@P/@@END`
  标记行定界文本。`service/draft/QuestionDraft.ts` 解析成 DraftUnit、`renderUnit`
  **确定性渲染**成契约 kramdown 入库——选项字母按序自动编、正确项写最前由
  `draft/OptionShuffle.ts` 洗牌消剧透。选行协议非 JSON/YAML 因数学 LaTeX
  零转义 + 无缩进 + 坏一题不坏一批。四生成入口共用：转换/增量/题库出题
  （GenQuestion）/单题重生成（RegenDialog）。`extractQuestions` 修补层已退役。
- **纯标题块跳过**：`isHeadingOnlyChunk`（章标题直挂子标题的零内容段不发 AI；
  逐段模式下按**窗口**判定——纯标题窗口直接推游标、不占批号）。
- **例题筛选带例外**（20260903 真机踩坑）：题解书「答案」节独立成块被整批误跳
  ——prompt 加例外：习题册答案/解答区是练习内容照转，题干由解答还原。
- **增量重转换**（20260831 增量哈希二期）：
    - `source/SrcChunk.ts` 结构切块：标题链键 `H:章/节` + questionHash 指纹，替代空行
      偏移切块；20260903 起答案类子节「习题N/答案」并入父题块——一题一答硬口径：
      题干与解答同块进 AI 只出一题，真实机 369 块并成 189 块，存量指纹经三态弹窗
      走变更/消失非静默漂移。
    - **两阶段三态分类**（全局指纹匹配→键配对：相同/新增/变更/消失）。生成时
      src-key/src-hash 随 BankRecord 字段落库（20260903 起从容器 IAL 迁入记录，
      键格式/算法冻结不变）。重新导入入口 DocOps.runIncrementalReimport 按
      `set.srcId` 门控、对带指纹题集走增量（20260903 起优先于续跑记录，陈旧 rec
      清掉）。
    - **检测必过目**：IncrementDialog 先出摘要（源共/已入库/待处理块数；纯标题块
      入口前置滤除）再逐块选。ConvertIncrement 纯题库执行（删旧/标 stale/串行补生成
      追加到既有题集，中止自愈无需续跑记录；零产物块无指纹每次重导重算新增，终态报
      empty 计数）。设置 convertKeepOld=省费模式（20260903 起=只出摘要不出逐块
      清单，不再静默直跑）。方案与分期见 docs/incremental-hash-plan.md。
    - **逐段题集的重导**（20260910）：逐段自推进写入的记录 src-key 形如
      `A:<区间起点偏移>`（批区间口径），批边界由 AI 决定、不可复现——DocOps
      见该前缀即**跳过增量三态分类**改为整卷重转（有续跑记录仍接着断点续写
      同一题集）；确定性结构切块的存量题集（`H:` 键）增量能力不变。

### src/word/ —— 单词域（`index.ts`=mountWordView 挂载编排，控制器在 `WordView.ts`）

- **UI 是 Svelte 组件**（word/component/，2026-08-26 起）：渲染走 $state 深代理
  细粒度更新，控制器经 context 注入组件；Svelte 5 编译器原生支持组件内 `lang="ts"`，
  无需 svelte-preprocess。词库数据在 word/data/。
- **词头音标**（20260901，听音选义展示读音）：自带 ECDICT(MIT) 提取的音标表
  （data/phonetics-data.ts 生成文件勿手改，scripts/gen-phonetics.mjs 重跑刷新；
  学习词∪有词频∪内置书兜底 ≈4.7 万条），service/WordPhonetics 惰性解析按 wordKey
  查（与进度 key 同归一），听音卡/英选词面/词条详情三处展示，零网络。
- **多词书**（2026-08-28 redesign §五）：词书=`data/wengu/wordbooks/{id}.json`+
  manifest（service/WordLib，内置书首启动落盘与导入同权）。**进度 key=归一化词头**
  （schema v3，同词跨书共享；v2 下标 key 的一次性迁移已随存量确认于 20260829 移除）。
  队列统计一律当前书口径。

### src/bank/ —— 题库 / 专题 / 薄弱

- 专题标题含「/」即目录专题（如 高数/极限/洛必达）：normalizeCollectionPath
  规范化、CollectionPanel buildColTree 树形展示。
- **知识文档（KnowledgePanel）**：
    - 手动导入**递归展开**：KnowRoots 登记 + KnowledgeLink.expandKnowDocs 根+全部
      后代逐行。小节按 h1~~h6 **层级树**展示——20260831 起 headingsByRoot 取 subtype
      建 buildSectionTree 真树，路由 path=祖先标题链，不再「文档路径/本标题」两段假
      层级。
    - **AI 索引（原「建知识树」，20260908 改名）不落文档**（20260903，data/KnowTrees）：
      手动导入章节的 AI 归纳大纲直写 bank.knowTrees（键=源章节文档 id；节点 id 铸内核
      块 id 形态——parseKpRefs/BLOCK_REF 正则冻结不动，kpRefs 经 kramdown
      ((id "标题")) 往返零兼容成本）。重新索引**同路径复用旧 id**，存量引用/活视图/
      薄弱画像不悬空。新旧两侧先过 stripChapterEcho 剔头部章节名回声（AI 常把章节名
      写成首个 h1 包全树——「1-行列式/行列式/…」双层嵌套；展示侧 treeHeads 同剔，
      存量带回声的树读时免迁移）。
    - 面板按钮恒名「索引」、全部手动导入文档行常显（20260908 起不再限「结构单薄」——
      旧门槛小节≥6 且顶层≥3 的章不显按钮，2-矩阵/3-向量这类多节章被拒之门外）；已有
      索引再点=两击确认（3s 复位）后重跑。
    - **文件夹式文档**（思源文档当目录用，自身空、子文档有内容）点=**批量补齐**子树
      缺索引的文档（expandKnowDocs 展开、串行逐篇、空文档跳过、部分失败不打断、确认
      文案带篇数；已索引的不动，重索单篇走行内）。
    - expandKnowDocs/buildKnowledgeIndex/lexiconOfRoots 传 trees 即并流（面板/路由/
      词表/打标自动含树节点）；kpRootMap 先并 internalRootMap（树节点引用归到源文档
      名下、对账不误判悬空）；「查看原文」与面板小节点击对树节点**降级跳源章节文档**；
      staleness=srcHash 比对出「源已变更」徽标（不走 KnowHash）；存量《·知识树》
      文档照旧走文档路径（双形态在并流点兼容）。
    - 行入口「匹配」（MatchDialog）：选已入库习题文档→按批两级 AI 路由（15 题/批）→
      strip+inject 注入引用，KnowRoots.mergeRecordKpRefs 同步题库；与「转习题」
      （QuizView.openConvertPrefilled 预填源=知识点根=该文档）。
    - **导入后自动补索引**（20260910，KnowPanelCtl.runImport；Issue #2）：手动导入登记
      成功后，对**本次新登记根**（与导入前登记清单 diff 得出）子树里 `pendingIndexIds`
      （已知 trees 里没有的）自动跑一次索引——已索引的一个都不重跑（含 srcHash 已变的
      存量树：stale 重索是用户显式动作，自动路径不动它）。顺序=零 AI 文本关联跑完 →
      小节哈希基线 → 面板 reload → `yieldToBrowser` 让出首帧后起 AI（**不阻塞 reload**，
      用户可能已离开页面，终态走通知 notifyOutlineAutoDone/notifyOutlineAutoNone）。
      自动路径**跳过 armOutline 两击确认**，但执行体与手动「索引」完全共用
      （`driveOutline` 编排 + `executeOutline` 串行循环 + `beginOutline`/`settleOutline`
      坑位，禁复制第二份）；因此自动索引进行中用户点行内「索引」被 ui.outlining 挡下
      （不起第二份任务），点在坑位行=中止；**反向同理**——用户先点了行内「索引」占住
      坑位时，自动路径让位收工（不双开，也不擦掉用户任务的坑位）。历史登记根同样
      不动：只 diff 本次勾选新增的根，导入前就登记、至今缺索引的老根不被顺手重跑
      （两半都有单测锁，20260910）。整链一条 catch 兜底（本文件历史踩过
      unhandled rejection 坑），收尾段再抛走 resetOutline 保坑位必清。
- **文本关联/批量关联**（KnowLinkText，20260831）：knowledge 标签 ↔ 小节标题归一
  精确相等即确定性挂引用（零 AI、歧义宁漏勿错）——「导入文档」登记后自动跑（导入即
  关联）；面板头部「批量关联」（BatchLinkDialog）= 全根 × 全库，文本优先 + 可选 AI
  路由兜底，落库共用 applyRefsToRecord。
- **同义词表 + AI 同义对齐层**（KnowSynonyms / KnowSynJudge，20260910 Issue #3）：
  文本精确层漏挂跨写法（「洛必达」↔「L'Hôpital 法则」）——归一链加一层**前置表**：
  `原文 → synKey 查同义表（零 AI）→ normalizeKnowledge 剥命名性后缀 → 精确相等`
  （**并入同一条链，不另起并行归一体系**；synKey 只剥装饰+小写，剥后缀仍归
  KnowledgeNorm）。表 `saveData("know-synonyms")`，词条带 source(ai|manual)/at，
  UI「同义词表」弹窗可查看与两击清空（一次错判不被永久固化）。
    - **查表一律走 `loadSynonyms()` / `store.snapshot()`，禁用 `peekSynonyms()` 做
      「表里有没有」的判断**（20260910 审查修复，真机踩坑级）：peek 只看内存，插件
      重载后盘上有表但尚未装载时它是**空表**——文本层据此查表就漏掉全部存量判定，
      同一对词被重新问一遍 AI，「判过就不重问」在重载后**不成立**。initKnowSynonyms
      顺带预热一次装载，但消费点仍必须 await（`lexiconOfRoots` / `linkRecordsByText`
      都已改走 loadSynonyms）。
    - **清单协议与 route 同源**（20260910 审查修复）：一批**共用一份编号小节清单**
      （`candidateList`，近邻标题优先 + `SYN_LIST_CHARS` 预算），AI 逐行回
      `标签编号|小节编号`。**旧的「每对词只塞 4 条候选」写法是硬伤**——跨语言对
      （「洛必达」↔「L'Hôpital 法则」）正确项不在候选里，AI 只能答 `-`，而判否会
      落表固化 → 该对词被判死，第二轮「零 AI」却永远不命中。别退回去。
    - **三态判定防固化错判**：`-`=明确不同义（清单完整才落表记否，防重问）；
      编号/标题=命中（落表 + 当轮挂引用）；**答非所问/说不清不落表**（下次重问）。
      清单被截断时（病态大词表）连 `-` 也不落表。
    - **AI 判定沉淀且只跑一次**：文本未命中的标签走 `pendingPairs`（按 synKey 去重、
      跳过表里已判定的**含判否空串**、跳过文本层已能挂上的），按批走
      `prompts/synonyms.synJudgePrompt`（编号行协议，`SYN_BATCH_SIZE=15`，AI 只能回
      清单里的编号/逐字标题，不许造词）→ 判定写回表 + 当轮挂引用。第二对同词零 AI。
    - 三弹窗共用 `ui/SynFlow.runSynonymPhase`（禁复制第二份）：**相内先跑零 AI 文本
      层**再走 AI 判定（匹配入口原先没有文本层，相内统一后三入口口径一致），差异
      只在拿哪些记录来跑；批量关联 phase1.5、生成标签核对补相、匹配前置相。
      调用带 track(kind=route) 进 AI 会话面板。
    - **失效口径（Issue #3 验收第 5 条结论）**：同义表**不进** RouteCache 的索引
      代数指纹（`indexGenOf` 只覆盖章节结构+小节内容哈希）。理由：表插在词表匹配
      之前、只决定「归一后是否采纳命中」，不改路由输入（题面）与路由输出（小节
      集合）——改表不会让存量路由答案失真。表自身的失效由 `clear()` 承担（清空=
      重新判定），不需要代数。
- **生成标签**（TagDialog，20260831）：侧栏文档右键入口，已有标签核对挂引用、缺失
  标签 AI 生成（有知识文档按批路由按小节标题命名、无则整批自由生成），setKnowledgeAttr
  写 IAL + applyTagToRecord 落库。
- **标签归一**（KnowledgeNorm，20260831）：knowledge 文本的 kn 聚合键剥命名性后缀归
  词干（「洛必达」=「洛必达法则」），只动键不动数据，四处聚合点统一 knKey。
  20260910 起这条链前面多一层同义表（见上条）：**先查表拿规范词、再进 knKey**——
  表是链的前置层不是并行体系，未接线/表为空时逐字节等同改造前行为。
- **路由缓存**（RouteCache，20260831 增量哈希一期，20260909 三弹窗改按批路由）：
  匹配/批量关联/生成标签三弹窗的两级 AI 路由走 routeKnowledgeBatchCached 按题指纹
  缓存（saveData("route-cache") LRU 2000，索引结构/模型/路由代数变更整表作废——代数
  ROUTE_GEN 在路由行为语义变更时 bump，如 20260908 路由②清单剥前缀+预算 4500 的 R2；
  命中零 AI 调用）。方案与分期见 docs/incremental-hash-plan.md。
- **专题/知识文档管理面板**：CollectionPanel/KnowledgePanel 挂页签左栏 rail（20260901
  拆分回两个独立工作区、rail 五工作区钮——20260831 □4 曾把专题清单并入知识面板下半区，
  用户改回分立；20260910 设置入口自刷题侧栏挪入 rail 底部第六钮，开弹窗不切工作区；
  小节节点行「开刷」=活视图专题 col-kp-{块id}，data/LiveCols 读取时实时刷新题单）。
- **题库「对账/重生成/反查/生成入库」段**（data/BankRegen 函数式友元）：20260901
  从 QuestionBank 类拆出压 500 行红线，调用形 `foo(bank,…)`，解析缓存经
  parsedOf/invalidateParse 友元钩子。
- **题库体检**（20260905 选项挤行单病扫描，20260909 升级全库体检：data/BankHealth +
  专题工作区「题库体检」入口）三层一次扫：
    - ①题目结构（解析失败/题干/答案缺失/答案字母越界/判断题答案形态/完形无空/多步缺步答，
      按原因归类；20260910 起弹窗内可勾选后经 RegenDialog.regenRecords 批量 AI 重生成
      ——复用单题重出 runRegen 带 quiet，点击即关窗、后台跑、终态通知，不再逐卡手动点
      「重新生成」；挤行形态下这些判分断点检查跳过——选项视图塌陷时「越界」是影子不是
      独立病）。
    - ②引用完整性（题集/专题悬空 qid 剪除、组链指向不存在材料解除、孤儿材料清除、缺题集
      条目补建——确定性自动修复，孤儿删除与组链解除级联有序：先删孤儿再剥链）。
    - ③索引一致性（record.hash 与内容不符重算——含旧版单段指纹格式、指纹索引重建、
      kpRefs 并入题面引用、stats 补零、题型/知识点元数据以题面为准）。**②③勾选即修零
      AI**；同指纹多条只报告不自动删（删谁涉及题集归属与作答统计保留）。
    - 挤行修复 = BankRepair.planOptionRepair 单题修复计划（确定性拆行+按「首行=正确项」
      重写答案+洗牌，经 replaceRecordKramdown 原题位回写，预览即所得；多选挤行正确集合
      不可推导只报告走单题重生成）；生成侧同类预防在 OptionShuffle.unpackPackedSingle
      （draft 层拆行，四生成入口共用）。
- **题集实体 BankSets**（20260903 存储 pivot）：题目内容唯一真相=题库
  （BankRecord.kramdown 契约格式）。题集 `{id,title,hPath,srcId,qids[]}` 存 bank.sets
  （data/BankSets 函数式友元：ensureSets 按 records.sourceDocId 分组推导存量题集——
  零迁移机制，历史/docStats/影子专题键天然延续；setQuestions/setDocsView/setMaterials
  是装载侧全部供给，quiz 域文档 SQL/hydrate 管线 QuestionService/QuestionBatch/
  MaterialService 整体退役）。
    - **聚合视图「全部习题」**（20260903）：保留 id `all`（BankSets.AGGREGATE_ID，
      **不落 collections**、不进专题管理，仅流程层认它）——CollectionFlow.questions/
      restore/activeTitle 与 colLoadContext 各自分流，题目=allSetQuestions、材料=
      allSetMaterials（题集插入序 × 集内 qids 序，**聚合绝不重排**），轮次按 col:all
      归档；侧栏 SidePanelApp「全部习题」组行（≥2 套才现）点行进聚合，树行仍逐套。
    - 多集合刷的题号栏组间横线（hover 伸展+title 显套题标题，点击跳套首题——NumRailApp/
      NumRail）与正文题集标题行（QuizShell 分片插 .wengu-set-head）由 buildSetGroups
      连续段驱动（DrillUnits，分组源=记录 rootId，setQuestions/questionsOf 解析归位；
      同集再现=新段）。顺修专题模式开刷面板缺失（QuizShell hasDoc 旧值在专题模式落空态，
      20260826 引入的回归）。
- **数据自托管**（20260831 三线收口，20260903 收完）：作答运行时统计
  （attempts/wrong-count/right/last-answer/step-_/slot-_/文档级 total-time）唯一真相在
  题库 stats/docStats（作答记账在 data/BankRecording）；镜像漂移检测 DriftWatch 与
  孤儿清理 OrphanCleaner 随「题库即唯一内容真相」整体退役（ws-main 对账只留知识文档
  knowHash 分支；源讲义删除不再级联删题集，清理走「删除此题集」）。
- **知识小节哈希**（data/KnowHash，saveData("know-hash")）：包含式切段指纹，
  导入写基线、面板装载出 stale 徽标（基线自推进一次性提示），并进路由缓存
  indexGenOf——小节正文变更整表作废。

### src/stats/ —— 统计

### src/companion/ —— 伴学看板娘「小书童」

- 规则层表情+台词 / AI 增强与聊天走智能体 agentChatOnce 独立会话并发；双宿主=刷题
  页签挂载层+单词 dock 内嵌；各域收口一行 `notify*` 接入事件。
- 管理工作区面板已 Svelte 四件套化（2026-08-27，comp/CompanionPanelApp）；聊天历史
  按学伴 id 分份持久 saveData("companion-chat")，core/ChatStore 串行写；默认学伴
  物化为 id=default 的正式条目——可删可改与自定义同权，列表至少保留一个。

### src/ui/ —— Svelte 迁移公共积木 / 样式工具

- FormHtml：行样式/选择器/设置弹窗；`shared.ts` 工具；`mountApp.ts` 挂载帮手 +
  `FormRow.svelte` 表单行。
- **Notify.ts 思源通知帮手**（20260901）：后台任务的静默失败/完成走内核级 showMessage
  浮层——`initNotify(i18n)` 由 index.ts onload 注入、深层模块用 `{key,vars}` 取词，
  错误同文案 60s 冷却防重试风暴；已接 AiSessions/QuestionBank 落盘失败、导入即关联、
  建知识树、转换/增量终态、启动迁移链 catch。
- **弹窗去阻塞**（20260905 用户定夺，七个 AI 弹窗统一口径）：重新生成/匹配/批量关联/
  生成标签/变式重练/薄弱加练/收集补题全部「点击即关窗」——AI 后台跑、调用带 track
  进 AI 会话面板（实时进度）、终态走通知。重型批流走 ai/flow.ts launchAiFlow 单飞闸
  （aiFlowBegin/End，内核写流并发互吞防线）；「停止」迁到 AI 会话面板（client.ts
  中止登记簿 stopBySid：track.onSid 把记录 id 挂回流级 AbortController，面板
  abortAiSession 触发；转换流自带页内停止面未接线、面板对其点停静默无效）。
- **页面已可见的反馈不重复通知**（判题/词书导入/学伴 AI 等），新增后台流照此口径接。

### 通用横切约束

- **Svelte 渐进迁移**（2026-08-27 起，全仓 UI 分六批迁 Svelte 5）：模式样板/暗雷清单/
  路线图见 `docs/svelte-migration.md`（各域开工前必读）。已迁：word 域、companion
  看板娘+管理面板、bank 工作区面板（专题/知识文档）、review 错题本主区、stats 统计面板、
  convert 两弹窗、quiz 6-1~6-3（开刷面板/轮次报告/rail/题号栏）、6-4a 题卡渲染层
  （三类题卡+材料组壳逐单元 mount）、6-4b 作答态收敛（三写统一进卡内 CardUi 响应态）、
  6-5 侧栏/头部壳（SidePanelApp/QuizHeadApp，2026-08-31，quiz 域收官）。组件零
  `<style>`，类名与迁移前逐字一致走全局 scss；新域挂载一律用 `ui/mountApp.ts`。
- **硬性约束：仓库内单文件 ≤500 行**（src/quiz/index.ts 基线豁免 574 行——20260826
  预览改版至 20260903 聚合/组链修复持续增长，访问器表+编排职责外移破坏内聚，改动它
  前后注意别再净增；见迁移文档 6-5 节与 20260903 审查）。界面规范见
  `docs/design-review.md §〇`（图标用 `FormHtml.svgIcon` 禁 emoji；表单统一 FormHtml
  行样式）。
- **CSS 特异性与思源主题**（20260827 踩坑）：formRow 行容器
  `class="fn__flex b3-label config__item wengu-formrow"`——思源运行时主题注入的
  `.b3-label` 单类选择器同特异性后定义会覆盖我们的 `.wengu-formrow { display:flex;
width:100% }`。修复：复合选择器 `.b3-label.wengu-formrow { ... !important }`
  把特异性抬到 0,2,0。工作区面板（`.wengu-ws-page`）没有 `.config__items` 父容器作
  兜底，所有 formRow 都需要这条复合规则。
- **移动端适配约定**（Issue #10，20260910）：
    - **openTab 在移动端是空桩**（思源 `app/src/plugin/API.ts` 的
      `/// #if MOBILE` 分支 `openTab = () => { /* TODO: Mobile */ }`），
      自定义页签打不开——顶栏入口必须分流（现走 `notifyInfo` 提示，
      见 `src/index.ts` addTopBar 回调首段）。
    - **dock 是插件面板唯一的移动通道**：`addDock` 在移动端被包装成
      `mobileModel`（`app/src/mobile/dock/MobileCustom.ts`，构造签名与桌面
      Custom 同款），init/destroy 生命周期同构 ⇒ 挂载链零改动即兼容；
      无程序化打开 dock 的公开 API，别造私有通道。
    - **环境探测一律 `ui/shared.isMobileUi()`**（`window.siyuan.mobile !==
undefined`；types 1.2.4 有该字段，`getFrontend` 反而没有类型）。
    - **触屏样式走根元素标记类分流**：挂载层 `markMobileUi` 给单词面板
      根元素（+ `document.body`）打 `.wengu-mobile`，触屏规则全部写成
      它的后代选择器（`src/scss/words-mobile.scss`；挂 body 的浮层适配在
      `english.scss` 尾段）。**禁用 media query**——桌面浏览器窄窗口会误伤，
      触屏适配只按环境分流；无标记时样式逐字节不变（桌面零回归）。
    - **iOS speechSynthesis 首播要在手势栈内**（20260910 定论）：`$effect`
      是微任务，脱离手势的首次播放会被系统静默丢弃。故**自动播报落点按环境
      分流**——移动端在控制器 `enterPrompt` 的同步栈里播（换卡动作的 click
      链路，天生在手势内），桌面仍走组件 `$effect`（与改造前逐字同行为），
      两侧互斥不双播。落点判定收口在 `word/core/TapSpeech.ts`
      （`autoSpeakSite`/`mayAutoSpeak`，带单测）。
- 改行为必须同步 `docs/question-block-contract.md`。

## 数据演进守则（20260901 存储前瞻审查定稿）

存量用户数据兼容是最高约束——插件目录与 data/storage 随思源同步在两台
机器间流转，任何格式变更都同时面对「升级」与「版本错位」两个方向。全部
持久化存储（saveData 十店 + 词书工作区文件 `data/wengu/` + 题目块 IAL；
20260910 起加 `know-synonyms` 同义表——**纯派生可重建**，读异常归空表、
丢=少数词对重问一次 AI，按纯缓存口径处置不设版本闩）
一律遵守：

- **字段只加不改名不删**：新字段一律 optional + 装载 backfill
  （QuestionBank/WordStore.backfill 同款）；`version` 字段只作标记，
  **不参与装载判据、加字段不 bump**——装载只认业务字段存在性，
  改名等于静默清库（读成空起步、下次落盘覆写）。
- **版本闩**（words/bank/history/weakness 四店 20260901 已装）：
  装载遇 `version` **大于**本版已知 → 内存按空起步 + **拒绝一切
  落盘**（save/markDirty/flush 全闸）+ notifyStoreForeign 浮层告知
  升级——堵死「未来 bump 版本」与「机器 B 新版写盘、机器 A 旧版
  读到即覆写」两类清库通道。新持久化存储上线即配同款闩。
- **冻结清单**（输出已嵌进落盘数据，改了就孤儿化存量或全量假漂移；
  确需演进一律新旧并存双写双查，禁原地替换）：
    - `BankParse.questionHash` 及其归一化（剥 id/updated、剥运行时
      属性、空白折叠）——指纹已渗透 bank.hashed/record.hash/
      record.srcHash/know-hash/route-cache indexGen（20260903 起存量
      文档题块 IAL src-hash 同值共存，读侧不再碰）；
    - `WordBook.wordKey` 归一化（words.json 九个 Record 与音标表、
      易混组、confKey 的共同 key）；
    - `attrs.ts` 属性名（`custom-plugin-wengu-*`）与题块 kramdown
      结构（容器超级块 + part 子块）——kramdown 是题库记录的内部
      契约格式（20260903 起不再落用户文档，但全部存量记录与解析器
      都长这样，改名=重写全库）；
    - `SrcChunk.structuralChunks` 的 srcKey 键格式（`H:链/P0/#k/~n`）
      与切块确定性；
    - `KnowledgeNorm.knKey`（聚合键裂开=薄弱画像/知识点索引分裂，
      有 remapKey 对账兜底但别依赖它）。
- **往记录 kramdown 写任何新的非内容属性，必须同步加进 BankParse 的
  RUNTIME_ATTR_HASH_RE 剥除名单**——否则作答即变指纹，增量重转换
  全量误报「变更」（当前已停写块属性，此条防复发）。
- **规模预警**：bank.json / history.json 单文件整写、无上限增长
  （words 的 reviews 流水同理，设计如此）；到万级题/数 MB 拆分时走
  「**新存储键 + 读时 fallback 老键**」（如 bank2→bank），老文件
  原样只读保留，禁原地改格式。

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

## 内核坑（3.8.0 真机实测，两台机器通用）

- **fetchSyncPost 必须串行**：并发调用互相吞响应挂起（12 题卡「加载中」
  的根因）。逐题/逐卡请求都要 await 串行。
- **内核 attributes 索引有数秒延迟**：新建文档立刻查 SQL 查不到，
  轮询（1s 间隔，15s 超时）。
- 未知路由返回 **200 + 空 body**，不能用状态码判断端点存在。
- 闪卡 API 是 `/api/transactions`（复数）+ `{reqId: 数字, transactions:
[{doOperations:[…]}]}`；旧 `/api/riff/addFlashcards` 等已不存在。
- `insertBlock/appendBlock` 在 3.8.0 不可用，写 kramdown 用
  `/api/filetree/createDocWithMd`；改块内容用 `/api/block/updateBlock`
  （markdown 里带 `{: id="…" 属性}` 可保留 IAL）。
- **「向已有文档追加内容」通道（20260826 在 3.8.1 八轮真机探针定论，
  修正 20260822 旧结论——旧探针的锚点误用了文档根块）**：
    - **`/api/block/appendBlock`（markdown dataType）+ `parentID=文档id`
      可用**——sy-lively 同款方式：一次**追加单块**到文档末尾，串行逐块
      即可增量成文；**IAL 独立成行则块属性直接落盘**（超级块容器 IAL
      同理，属性表 ~2s 可查），无需 setBlockAttrs 补。温故渐进落盘已改走
      此通道（KernelBlock.append / ConvertService.appendBlockToDoc）。
    - `/api/block/insertBlock`（previousID 锚定）同样可用，但**锚点必须是
      真实子块**——previousID 传文档根块（type='d'）会**假成功**：code 0
      且回显 doOperations，内容根本不落盘（两轮探针假阴性的根因）。
    - **一次只能一块**：单次调用传多块 markdown 会散落错位（首块进锚点、
      其余乱序落尾）；IAL 写在行内会变成正文，必须独立成行。
    - **kramdown 读回形态（20260829 题库踩坑）**：getBlockKramdown/
      落盘读回时，列表项首段子块的 IAL 是**行内尾随**（`- {: id="…"
updated="…"}A. …`）、条目自身 IAL 缩进独立成行、块引用子块 IAL
      带 `>` 前缀——按行解析 kramdown 时必须清理这些残渣（siyuan/kramdown.ts
      的 stripIal/IAL_LINE/IAL_INLINE），否则渲染成字面属性文本。
    - `/api/transactions` + DOM 数据（前端同款）也可用（多顶层块、超级块
      完整落盘），但 **`data-custom-*` 被内核剥离**且 `data-node-id` 可能
      被重生成——不如 markdown 通道，留作后备。
    - `updateBlock` 仍不可用：文档根传多块 → 并成**一个段落**；普通子块传
      多块 → **只保留第一段**（危险）。

- **putFile 不吃 JSON**：上传文件必须 multipart（path/isDir/file），
  fetch + `window.siyuan.config.api.token` 鉴权（见 `siyuan/files.ts`
  kernelWriteText）。
  **3.8.1 路由迁移**：端点变为 `POST /api/file/putFile`（旧 `/api/putFile`
  返回 200+空 body 假成功），且 path 必须工作区相对（带前导 `/` 会拼出
  `…\C::` 非法路径报 mkdir 错）（20260825 真机实测）。
- **saveData 拒绝路径抛裸对象 + 生命周期闸（3.8.2 前端源码定论，
  20260903）**：`Plugin.saveData/loadData/removeData` 失败时
  `Promise.reject({code,msg,data})`（非 Error）——`String(e)` 直出
  「[object Object]」，展示用错误一律走 `ui/shared errText`。拒绝只有
  三类客户端来源（`fetchPost` 回调形态内核出错也 resolve，内核侧失败
  不会 reject）：① code 410「Plugin lifecycle has ended」——**3.8.2
  新增生命周期闸**，实例被 dispose（petal 重载/页签销毁与 2s 防抖
  markDirty 的竞态）后永久拒绝，防抖重排撞上必须停手
  （`isLifecycleGone`），否则僵尸循环每冷却期弹一次错（20260903
  题库落盘失败真机踩坑，且当时正常实例落库无恙——toast 全来自旧
  实例残骸）。**20260904 收口：410 属旧实例残骸的预期失败，连通知
  也一并静默**（QuestionBank/AiSessions 的 flush 都先 `isLifecycleGone`
  再弹）；fire-and-forget 的 `void save()` 一律链尾 `.catch`——try/catch
  接不住异步 reject，漏出去是控制台未捕获拒绝刷屏（savePrefs/settings
  踩过）；② code 403 全局只读/发布模式（用户可解，重试合法）；
  ③ code 400 数据 JSON 序列化失败（循环引用等）。
- 内置智能体 `/api/ai/agent/chat`（SSE）：**并发锁按 sessionID 键控
  （`runningSessions map[string]*runningSession`，非全局锁），不同
  sessionID 可并发、且每次可指定 `model`——即「并发 + 每场景指定模型」
  两个诉求一个接口全满足**（20260827 在 3.8.1 两轮真机验证：两个不同
  sessionID 并发请求均 `event:done` 零 busy；传假 model id 被拒
  「请先参考用户指南进行配置」证明 model 生效）。
    - **消息里的 `![](assets/…)` 会被抠成图片附件（20260903 MiniMax 2013
      真机踩坑）**：内核 `AgentMessageImageAssets` 用 Lute 解析 user 消息，
      把 assets/ 开头的图片抠出来 base64 附给供应商，`image_url.detail`
      无显式值一律 `"auto"`（kernel/agent/attachments.go
      buildAttachmentMessage），且单请求最多 4 张/20MB、超出静默丢。
      供应商 schema 不认 auto 时（MiniMax 只收 low/default/high，报
      「网络异常，请稍后再试: invalid params, invalid image detail: auto
      (2013)」）整批必挂——带图批次全灭、纯文本批次全活。内核的
      isImageInputUnsupportedError 降级白名单不匹配这类措辞，不会自动
      重试纯文本。**插件对策：`ai/PromptHygiene` 在发送口（client 两条
      公开通道）把图片行统一换成 `〔插图:路径〕`占位符（Lute 解析不出
      图片节点），`QuestionDraft.cleanPartText` 兜底还原——落盘 kramdown
      与旧产物逐字同构**。往 agent chat 发文档 kramdown 的新通道都必须
      过这层消毒（20260903 已用内核探针双验证：真图片行=2013 复现、
      占位符=正常出字）。
    - **老结论「并发互斥」是假象**：20260823 验证时没传 sessionID，
      所有请求都撞在 `runningSessions[""]` 这一个 key 上 → 全局互斥。
    - 调用前置（缺一即 409/「网络异常」假象）：
        1. `sessionID` 必须是合法格式 `{14位时间戳}-{7位字母数字}`
           （isValidSessionID 校验，如 `20260827063055-fk64l1s`；乱传
           直接 `load agent session permission failed: invalid session id`）；
        2. session 必须先落盘：`POST /api/ai/agent/saveSession` body
           `{id, revision, title, entries:[{id, type:"user", content}]}`
           ——**entries 至少一条 `type:"user"` 条目**，否则 chat 报
           `begin agent runtime failed: agent runtime user entry not found`
           （前端逻辑：先 push user 条目→saveSession→再 chat）；
        3. chat body `{sessionID, userEntryID: <user 条目 id 或空串>,
message, language, references, model?}`；`userEntryID` 是
           **entries 里 user 条目的 id**（非文档 ID），空串=取最后一条
           user 条目；`model` = `conf.json ai.providers[].models[].id`。
    - **model id 是内核生成的时戳格式**（如 `20260824211456-z5lcgdq`，
      3.8.1 实测）：删改 AI 配置后存量 id 永久失效，内核对未知 id
      一律报「请先参考用户指南 [人工智能] 章节进行配置」——调用侧
      一律走 `ai/models.resolveModelId`（agentChat 入口已总闸：失效
      回落默认、默认无效省略 model），别把用户存量选择直送内核
      （20260829 学伴档案存已删模型踩坑）。
    - 流结束 SSE 出 `event:turn`（带 turnID）；前端随后调 saveSession
      `{...session, commitTurnID: turnID}` 提交；插件任务结束不保留
      上下文就调 `POST /api/ai/agent/removeSession {id}` 清理，否则
      每个随机 sessionID 会在 `data/storage/ai/agent/sessions/{id}/`
      落盘两个文件堆积。agent chat 可能触发工具权限
      `event:permission`/`event:confirm`（approvalPolicy=risk 时），
      插件纯文本问答通常不触发，需自测。

- 旧直答端点 `/api/ai/chatGPT`（`{msg}` → `{code,data:回复全文}`）
  支持并发（真机验证），模型跟随设置默认、不可按次指定——**插件侧
  已于 20260830 弃用**（并发统一走 agent/chat 独立 sessionID，顺带
  修掉并行转换忽略用户选模型的暗病），内核行为仅备查。conf.json 里
  providers 的 apiKey 是**内核加密
  密文**（hex，长 224/512），插件拿不到明文、无法绕开内核直连供应商。
- 插件 addDock 的 config **必须带 position 与 size**：缺 position 会在
  内核 dock 布局初始化里 `.startsWith` undefined 直接崩，且是 onload 级
  崩溃（整个插件不可用，20260823 真机踩坑）。
- **SQL API 无 LIMIT 静默截断 64 行**（20260823 真机验证）：
  `/api/query/sql` 不带 LIMIT 最多返回 64 行且 code=0 无异常（书架
  94 篇文档只回 64 篇的假象）；子查询不支持（返回空）。批量/
  全量查询必须显式 `LIMIT n OFFSET k` 分页（工厂 `KernelQuery.rowsAll`）。
- **SQL `ORDER BY sort` 不是文档序**（20260907 真机验证）：导入语料
  （MinerU 等）块 sort/created 全退化——实测 23/23 章节全部标题块
  sort 同值、created 整秒并列，SQLite 对并列序返回**任意序且时好时坏**
  （随查询计划漂移）：知识面板小节树「五、二、一」乱序、子标题先于
  父标题到达就近挂靠直接沉顶层（层级塌平）；`created` 与
  `/api/outline/getDocOutline` 都不可靠（后者只回两层、h5 丢）。
  **文档序唯一权威来源=根块 kramdown 里 IAL `id="…"` 的出现序**——
  `KernelBlock.docOrder`（siyuan/block.ts，按文档 updated 缓存）+
  `byDocOrder` 回排帮手；读块顺序的代码一律过这层，别再信 ORDER BY
  sort（消费点：headingsByRoot/docBlocks/sectionKramdown/docSectionHashes）。
- Lute：**只能用全局 `window.Lute`**——插件加载器给 `"siyuan"` 模块
  注入的固定对象里没有 Lute（3.8.1 加载器实测：window.eval 包合成
  require，模块表只有 fetch*/Protyle/ProtyleMethod/Dialog 等；
  **showMessage/hideMessage 在表内**（3.8.2 common.js 实测），
  `import { showMessage } from "siyuan"` 可用——ui/Notify.ts 即此路），
  `import { Lute } from "siyuan"` 得 undefined，`New()` 抛异常被
  safeLute 吞掉→整体退 `<pre>` 纯文本，公式显成裸 `$...$`
  （20260825 踩坑，ProtyleHost.luteToHtml）。自建实例还必须
  `SetInlineMath(true)`（编辑器默认关行级公式，否则 `$...$` 原样
  输出）；内嵌 Protyle 必须**逐卡串行挂载**（并发 getDoc 挂起）。
  `Md2BlockDOM` 段落输出形态（3.8.1 lute.min.js 在 node 沙箱探针实测，
  20260829）——正文藏在 contenteditable 壳里、尾部还拖 protyle-attr：

      <div … class="p"><div contenteditable="true">正文</div><div class="protyle-attr">…</div></div>

    要取内联内容剥壳得按这个形态（ProtyleHost.unwrapSingleBlock），
    朴素取 innerHTML 会把块级壳漏进去。

## 外部 API：无（MinerU/PDF 导入 20260901 移除）

- PDF 导入的中间产物文档无处安放（20260903 起转换零落盘，题库才是
  内容真相），MinerU 管线失去意义——PdfImport/MinerUClient/PdfImportRow
  三文件与 settings.mineruToken、fflate 依赖、EApi.ForwardProxy 一并
  删除（20260901 首删时的动因是「另存文档永久留文档树」，pivot 后
  更彻底）。若将来重接外部 JSON API，内核 `/api/network/forwardProxy`
  `{url, method, headers, payload?, timeout}`（上游响应在 `data.body`）
  仍可用，但 payload 只收 **string，二进制过不去**（20260823 真机验证）。

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
