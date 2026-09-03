# AGENTS.md — 温故插件开发与调试备忘

给 AI 编码代理的项目说明。**调试环境按机器区分**，两台机器各自一节，
在别的机器上先确认本节路径/端口/token 再动手，并回填缺失信息。

## 项目速览

- SiYuan 插件「温故（wengu）」：笔记文档 → AI 转习题 → 页签刷题。
- 源码 `src/` **按功能分域**（2026-08-26 重构，组织方式借鉴 sy-lively）：
    - `src/siyuan/`——内核 API 工厂（`api.ts` 路径枚举 EApi + `KernelBlock`
      /`KernelDoc`/`KernelNotebook`/`KernelQuery`（SQL，rows 泛型收窄/
      rowsMap，**rowsAll/rowsMapAll 自动 LIMIT/OFFSET 分页——全量查询
      一律走它，别手写循环**）薄封装，迁自 sy-lively 构建工厂；
      2026-08-26 已把全仓 ~33 处散落内核调用收拢进来，SSE/putFile
      multipart 两类特殊通道例外（工作区文件读写/删在
      `files.ts`：getFile 裸内容/putFile multipart/removeFile 信封，词书
      等非块文件走它））+ 题目契约属性常量
      `attrs.ts`。新增内核调用先走工厂，别散落 fetchSyncPost。
    - `src/ai/`——**AI 基础设施域**（2026-08-27 从 convert/AgentClient
      抽离，六域共用，无 index.ts 同 siyuan/ 惯例）：`client.ts` 对外通道
      两条——**agentChatOnce**（一次性独立会话：saveSession→chat→
      removeSession，独立 sessionID 天然并发+可按次指定模型；可选
      `track{kind,title,group?}` 参数把调用登记进 AI 会话面板，
      group={id,title} 把一次动作触发的多次调用挂同组（id 由动作
      入口 `newAiGroupId` 生成，**AiTrack 接口定义在 data/AiSessions**，
      client 转发导出；20260830
      起 chatGPT 直答与共享 "" 会话两条路已弃用——agentChat 收为模块
      私有，queue.ts/enqueueAi 整体退役）与 **agentChatContinued**
      （继续追问：历史轮次以 user/assistant 条目回放播种新会话）、
      `models.ts` 模型
      清单与默认、`timeouts.ts` AI_TIMEOUT 档位（调用点禁自造超时
      数字；超时统一按 SSE 空闲计）、`agentPanel.ts` 智能体面板
      DOM 自动化与「面板优先、页内降级」按钮帮手；**AI 会话登记与
      管理面板**（20260831）：`data/AiSessions.ts` 登记簿
      （saveData("ai-sessions")，LRU 双上限全局 150/单类 40、600ms 去抖
      +串行链落盘、重载时 running 改判「已中断」；记录可选
      group/groupTitle 字段随组冗余落盘；index.ts onload
      initAiSessions 接线）+ rail「AI 会话」工作区面板
      （components/SessionPanelApp.svelte 四件套，挂载编排
      `SessionPanel.ts`；**两栏式**（20260901 改版）：左栏=会话清单
      常驻（类别过滤/状态徽标/两击删除/选中高亮），点行右栏出完整
      轮次明细+继续追问输入条；**树状分组**（20260902 引入，
      20260903 改版=**种类优先两级树**）：顶层一类一棵树（转换/检测/
      判题…），类内按主题=组标题/标题第一个「 · 」后的部分（转换是
      文档名——高等数学、线代；跨次运行同文档合并）出第二级，调用
      行挂底层；种类或主题只有 1 条时不设空层直接上提；树渲染走共享
      组件 `ui/TreeList.svelte`（与知识面板/侧栏树同源；树化纯函数
      `core/SessionTree.ts`——类别过滤=记录透镜、状态聚合
      running>error>done；行内徽标/条数走 main/trailing 片段，展开
      集合 ui.openGroups=SvelteSet）；文档分支行两击删该文档全部记录
      （removeIds 按树算出的成员 id 精确删），种类级不配删除；
      登记数据仍按动作组落（track.group，20260902 的组机制保留在
      数据层，渲染不再按组）——
      判题/转换/检测/标签/路由/出题/单词复盘等
      带 track 的调用自动登记，面板回看完整轮次与产出并可继续追问。
    - `src/quiz/`（做题主流程，`index.ts`=QuizView 编排）、`src/convert/`
      （AI 转换，`index.ts`=转换编排；**20260903 存储收口：转换零落盘，
      产物直写题库**（`service/SetWriter.ts`：DraftUnit → renderUnit 出
      契约 kramdown → parseQuestionKramdown 反解 + questionHash 构造
      BankRecord，与旧「落文档再回读入库」产物同构；材料正文进
      bank.materials、小题 group 写时直配材料 id；每批 flush 崩溃安全，
      终止「保留」零动作/「丢弃」按写入 qid 清单回收；渐进呈现改内存
      视图直出，无内核索引轮询；题集=BankSet 库内实体见 bank 域）；
      **生成输出行协议**（20260902）：AI 不手写 kramdown，改输出
      `@@Q/@@P/@@END` 标记行定界文本（`service/QuestionDraft.ts`
      解析成 DraftUnit、`renderUnit` **确定性渲染**成契约 kramdown
      入库——选项字母按序自动编、正确项写最前由 `OptionShuffle.ts`
      draft 层洗牌消剧透；选行协议非 JSON/YAML 因数学 LaTeX 零转义+
      无缩进+坏一题不坏一批；四生成入口共用：转换/增量/题库出题
      （GenQuestion）/单题重生成（RegenDialog）；`extractQuestions`
      修补层已退役；**纯标题块跳过** `isHeadingOnlyChunk`（章标题直挂
      子标题的零内容段不发 AI）；**增量重转换**（20260831 增量哈希
      二期）：`SrcChunk.ts` 结构切块（标题链键 H:章/节 + questionHash
      指纹，替代空行偏移切块）+ 两阶段三态分类（全局指纹匹配→键配对：
      相同/新增/变更/消失），生成时 src-key/src-hash 随 BankRecord
      字段落库（20260903 起从容器 IAL 迁入记录，键格式/算法冻结不变），
      重新导入入口（DocOps.runIncrementalReimport）按 `set.srcId` 门控、
      对带指纹题集走增量——IncrementDialog 逐块选、ConvertIncrement
      纯题库执行（删旧/标 stale/串行补生成追加到既有题集，中止自愈
      无需续跑记录）、设置 convertKeepOld=省费模式；方案与分期见
      docs/incremental-hash-plan.md）、`src/review/`（错题复习）、
      `src/word/`（单词域，`index.ts`=mountWordView 挂载编排，控制器
      在 `WordView.ts`，**UI 是 Svelte 组件**（`word/component/`，2026-08-26
      起）：渲染走 $state 深代理细粒度更新，控制器经 context 注入组件；
      Svelte 5 编译器原生支持组件内 `lang="ts"`，无需 svelte-preprocess；
      词库数据在 `word/data/`；**词头音标**（20260901，听音选义展示
      读音）：自带 ECDICT(MIT) 提取的音标表（data/phonetics-data.ts
      生成文件勿手改，scripts/gen-phonetics.mjs 重跑刷新；学习词∪
      有词频∪内置书兜底 ~~4.7 万条），service/WordPhonetics 惰性
      解析按 wordKey 查（与进度 key 同归一），听音卡/英选词面/
      词条详情三处展示，零网络；**多词书**（2026-08-28 redesign §五）：
      词书=`data/wengu/wordbooks/{id}.json`+manifest（service/WordLib，
      内置书首启动落盘与导入同权），**进度 key=归一化词头**（schema v3，
      同词跨书共享；v2 下标 key 的一次性迁移已随存量确认于 20260829
      移除）、队列
      统计一律当前书口径）、
      `src/stats/`（统计）、`src/bank/`（题库/专题/薄弱；专题标题含
      「/」即目录专题（如 高数/极限/洛必达，normalizeCollectionPath
      规范化、CollectionPanel buildColTree 树形展示）；知识文档
      （KnowledgePanel）：手动导入**递归展开**（KnowRoots 登记 +
      KnowledgeLink.expandKnowDocs 根+全部后代逐行；小节按 h1~~h6
      **层级树**展示——20260831 起 headingsByRoot 取 subtype 建
      buildSectionTree 真树，路由 path=祖先标题链，不再是「文档路径/
      本标题」两段假层级）、
      **AI 建知识树不落文档**（20260903，data/KnowTrees）：结构单薄
      章节的 AI 归纳大纲直写 bank.knowTrees（键=源章节文档 id；节点
      id 铸内核块 id 形态——parseKpRefs/BLOCK_REF 正则冻结不动，
      kpRefs 经 kramdown ((id "标题")) 往返零兼容成本；重新归纳**同
      路径复用旧 id**，存量引用/活视图/薄弱画像不悬空），expandKnowDocs/
      buildKnowledgeIndex/lexiconOfRoots 传 trees 即并流（面板/路由/
      词表/打标自动含树节点）；kpRootMap 先并 internalRootMap（树节点
      引用归到源文档名下、对账不误判悬空）；「查看原文」与面板小节
      点击对树节点**降级跳源章节文档**；staleness=srcHash 比对出
      「源已变更·重新归纳」徽标（不走 KnowHash）；存量《·知识树》
      文档照旧走文档路径（双形态在并流点兼容））、
      行入口「匹配」（MatchDialog：选已入库习题文档→逐题两级 AI 路由
      →strip+inject 注入引用，KnowRoots.mergeRecordKpRefs 同步题库）
      与「转习题」（QuizView.openConvertPrefilled 预填源=知识点根=
      该文档）；**文本关联/批量关联**（KnowLinkText，20260831）：
      knowledge 标签 ↔ 小节标题归一精确相等即确定性挂引用（零 AI、
      歧义宁漏勿错）——「导入文档」登记后自动跑（导入即关联）、面板
      头部「批量关联」（BatchLinkDialog）= 全根 × 全库，文本优先 +
      可选 AI 路由兜底，落库共用 applyRefsToRecord；**生成标签**
      （TagDialog，20260831）：侧栏文档右键入口，已有标签核对挂引用、
      缺失标签 AI 生成（有知识文档逐题路由按小节标题命名、无则整批
      自由生成），setKnowledgeAttr 写 IAL + applyTagToRecord 落库；
      **标签归一**（KnowledgeNorm，20260831）：knowledge
      文本的 kn 聚合键剥命名性后缀归词干（「洛必达」=「洛必达法则」），
      只动键不动数据，四处聚合点统一 knKey；**路由缓存**（RouteCache，
      20260831 增量哈希一期）：匹配/批量关联/生成标签三弹窗的两级 AI
      路由走 routeKnowledgeCached 按题指纹缓存（saveData("route-cache")
      LRU 2000，索引结构/模型变更整表作废，命中零 AI 调用，方案与
      分期见 docs/incremental-hash-plan.md）；专题/知识文档管理面板
      CollectionPanel/KnowledgePanel 挂页签左栏 rail（20260901 拆分回
      两个独立工作区、rail 五钮——20260831 □4 曾把专题清单并入知识
      面板下半区，用户改回分立；小节
      节点行「开刷」=活视图专题 col-kp-{块id}，data/LiveCols 读取时
      实时刷新题单；题库「对账/重生成/反查/生成入库」段在 data/
      BankRegen 函数式友元——20260901 从 QuestionBank 类拆出压 500
      行红线，调用形 `foo(bank,…)`，解析缓存经 parsedOf/
      invalidateParse 友元钩子；**题集实体 BankSets**（20260903 存储
      pivot）：题目内容唯一真相=题库（BankRecord.kramdown 契约格式），
      题集 `{id,title,hPath,srcId,qids[]}` 存 bank.sets（data/BankSets
      函数式友元：ensureSets 按 records.sourceDocId 分组推导存量题集
      ——零迁移机制，历史/docStats/影子专题键天然延续；setQuestions/
      setDocsView/setMaterials 是装载侧全部供给，quiz 域文档 SQL/hydrate
      管线 QuestionService/QuestionBatch/MaterialService 整体退役；
          **聚合视图「全部习题」**（20260903）：保留 id \`all\`
          （BankSets.AGGREGATE_ID，**不落 collections**、不进专题管理，
          仅流程层认它）——CollectionFlow.questions/restore/activeTitle
          与 colLoadContext 各自分流，题目=allSetQuestions、材料=
          allSetMaterials（题集插入序 × 集内 qids 序，**聚合绝不重排**），
          轮次按 col:all 归档；侧栏 SidePanelApp「全部习题」组行（≥2
          套才现）点行进聚合，树行仍逐套；多集合刷的题号栏组间横线
          （hover 伸展+title 显套题标题，点击跳套首题——NumRailApp/
          NumRail）与正文题集标题行（QuizShell 分片插 .wengu-set-head）
          由 buildSetGroups 连续段驱动（DrillUnits，分组源=记录 rootId，
          setQuestions/questionsOf 解析归位；同集再现=新段）；顺修专题
          模式开刷面板缺失（QuizShell hasDoc 旧值在专题模式落空态，
          20260826 引入的回归））；
      **数据自托管**（20260831 三线收口，20260903 收完）：作答运行时
      统计（attempts/wrong-count/right/last-answer/step-_/slot-_/文档级
      total-time）唯一真相在题库 stats/docStats（作答记账在 data/
      BankRecording）；镜像漂移检测 DriftWatch 与孤儿清理 OrphanCleaner
      随「题库即唯一内容真相」整体退役（ws-main 对账只留知识文档
      knowHash 分支；源讲义删除不再级联删题集，清理走「删除此题集」）；
      **知识小节哈希**（data/KnowHash，saveData("know-hash")）：
      包含式切段指纹，导入写基线、面板装载出 stale 徽标（基线自推进
      一次性提示），并进路由缓存 indexGenOf——小节正文变更整表作废）、
      `src/companion/`
      （伴学看板娘「小书童」：规则层表情+台词/AI 增强与聊天走智能体
      agentChatOnce 独立会话并发，双宿主=刷题页签挂载层+单词 dock
      内嵌，各域收口一行 `notify*` 接入事件，管理工作区面板已 Svelte
      四件套化（2026-08-27，comp/CompanionPanelApp）；聊天历史按学伴
      id 分份持久 saveData("companion-chat")，core/ChatStore 串行写；
      默认学伴物化为 id=default 的正式条目——可删可改与自定义同权，
      列表至少保留一个）、
      `src/ui/`
      （FormHtml 行样式/选择器/设置弹窗/`shared.ts` 工具/Svelte 迁移
      公共积木：`mountApp.ts` 挂载帮手 + `FormRow.svelte` 表单行 +
      `Notify.ts` 思源通知帮手（20260901）：后台任务的静默失败/完成
      走内核级 showMessage 浮层——`initNotify(i18n)` 由 index.ts onload
      注入、深层模块用 `{key,vars}` 取词，错误同文案 60s 冷却防重试
      风暴；已接 AiSessions/QuestionBank 落盘失败、导入即关联、
      建知识树、转换/增量终态、四弹窗被销毁后的 ok/err、启动迁移
      链 catch；**页面已可见的反馈不重复通知**（判题/词书导入/学伴
      AI 等），新增后台流照此口径接）。
    - **各域 `index.ts` 必须是该域的入口编排代码，禁止纯 re-export barrel**；
      共享类型在 `src/types.ts`，样式 `src/scss/` 分片。
- **Svelte 渐进迁移**（2026-08-27 起，全仓 UI 分六批迁 Svelte 5）：
  模式样板/暗雷清单/路线图见 `docs/svelte-migration.md`（各域开工前
  必读）；已迁 word 域、companion 看板娘+管理面板、bank 工作区面板
  （专题/知识文档）、review 错题本主区、stats 统计面板、convert 两弹窗、
  quiz 6-1~6-3（开刷面板/轮次报告/rail/题号栏）、6-4a 题卡渲染层
  （三类题卡+材料组壳逐单元 mount）、6-4b 作答态收敛（三写统一进
  卡内 CardUi 响应态）与 6-5 侧栏/头部壳（SidePanelApp/QuizHeadApp，
  2026-08-31，quiz 域收官）。组件零 `<style>`，
  类名与迁移前逐字一致走全局 scss；新域挂载一律用 `ui/mountApp.ts`。
- **硬性约束：仓库内单文件 ≤500 行**（src/quiz/index.ts 518 行豁免
  ——6-5 新增访问器属紧凑访问器表，外移破坏内聚，见迁移文档 6-5 节）；
  界面规范见 `docs/design-review.md §〇`
  （图标用 `FormHtml.svgIcon` 禁 emoji；表单统一 FormHtml 行样式）。
- **CSS 特异性与思源主题**（20260827 踩坑）：formRow 行容器
  `class="fn__flex b3-label config__item wengu-formrow"`——思源运行
  时主题注入的 `.b3-label` 单类选择器同特异性后定义会覆盖我们的
  `.wengu-formrow { display:flex; width:100% }`。修复：复合选择器
  `.b3-label.wengu-formrow { ... !important }` 把特异性抬到 0,2,0。
  工作区面板（`.wengu-ws-page`）没有 `.config__items` 父容器作兜底，
  所有 formRow 都需要这条复合规则。
- 改行为必须同步 `docs/question-block-contract.md`。

## 数据演进守则（20260901 存储前瞻审查定稿）

存量用户数据兼容是最高约束——插件目录与 data/storage 随思源同步在两台
机器间流转，任何格式变更都同时面对「升级」与「版本错位」两个方向。全部
持久化存储（saveData 十店 + 词书工作区文件 `data/wengu/` + 题目块 IAL）
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
      带 `>` 前缀——按行解析 kramdown 时必须清理这些残渣（BankParse
      的 IAL_LINE/IAL_INLINE），否则渲染成字面属性文本。
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
  实例残骸）；② code 403 全局只读/发布模式（用户可解，重试合法）；
  ③ code 400 数据 JSON 序列化失败（循环引用等）。
- 内置智能体 `/api/ai/agent/chat`（SSE）：**并发锁按 sessionID 键控
  （`runningSessions map[string]*runningSession`，非全局锁），不同
  sessionID 可并发、且每次可指定 `model`——即「并发 + 每场景指定模型」
  两个诉求一个接口全满足**（20260827 在 3.8.1 两轮真机验证：两个不同
  sessionID 并发请求均 `event:done` 零 busy；传假 model id 被拒
  「请先参考用户指南进行配置」证明 model 生效）。
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
  全量查询必须显式 `LIMIT n OFFSET k` 分页（见 KnowledgeLink.sqlAll）。
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
