# src/bank/ —— 题库 / 专题 / 薄弱

- 专题标题含「/」即目录专题（如 高数/极限/洛必达）：normalizeCollectionPath
  规范化、CollectionPanel buildColTree 树形展示。
- **知识文档（KnowledgePanel）**：
    - **装载源 = `saveData("know-index")` 快照**（Issue #39，20260912，
      `data/KnowIndex`）：登记根的文档标题树**一次性捕获**（嵌套、节点 id=真实
      标题块 id）落库，`KnowledgeLink` 的 expandKnowDocs/buildKnowledgeIndex
      只读快照——**装载零内核 SQL**。改这块别再往装载路径加 SQL。
        - **懒捕获**：装载遇快照缺根 → 现场捕获并落库（存量登记根零用户动作），
          捕获是唯一标题查询场景；同一根单飞（并发装载只捕获一次）。
        - 快照即**全量原始树**：不引入确定性过滤、不加 filtered 清单；被 AI
          索引滤掉的噪音天然可从快照找回。
        - 配版本闩（遇未来 version → 内存空表 + 拒写）；退册时 `drop` 清账
          （不清会让 findDoc 把已退册根的旧树误认领）。
        - 过期=小节内容哈希（KnowHash）报变更的登记根 → 行上「快照过期」徽标
            - 行内「重扫」（`rescan` 重跑捕获，零 AI）；归口判定在 `core/KnowSnapshot`。
        - **跳源**：`KnowTrees.knowJumpTarget` —— AI 节点有 `srcId?`（源标题块
          指针）则块级直跳，无则降级跳源章节文档；两个跳转点（`index.ts`
          `onBlockRefClick`、`KnowPanelCtl.open`）都走它（现在收口在
          `KnowSnapshot.jumpToKnowNode`）。
    - 手动导入**递归展开**：KnowRoots 登记 + KnowledgeLink.expandKnowDocs 根+全部
      后代逐行。小节按 h1~~h6 **层级树**展示——小节树由捕获阶段 `nestHeads`
      建好（与 `bankNodesToTree` 就近挂靠口径逐字一致，两条链路同一组单测锁死），
      路由 path=祖先标题链，不再「文档路径/本标题」两段假层级。
    - **AI 索引 prompt 升级**（Issue #39）：`buildOutlinePrompt` 明列**不收录**
      题号题干/例题标题/空壳节（习题/解答/答案/综合题举例/基础习题精练…）+ **例题
      反哺**（读例题把知识点切得更细）；归纳后按归一标题在快照里挂 `srcId`（歧义/
      未命中留空），回 echo 与同路径 id 复用照旧。
    - **AI 索引（原「建知识树」，20260908 改名）不落文档**（20260903，data/KnowTrees）：
      手动导入章节的 AI 归纳大纲直写 bank.knowTrees（键=源章节文档 id；节点 id 铸内核
      块 id 形态——parseKpRefs/BLOCK_REF 正则冻结不动，kpRefs 经 kramdown
      ((id "标题")) 往返零兼容成本）。重新索引**同路径复用旧 id**，存量引用/活视图/
      薄弱画像不悬空。新旧两侧先过 stripChapterEcho 剔头部章节名回声（AI 常把章节名
      写成首个 h1 包全树——「1-行列式/行列式/…」双层嵌套；展示侧 treeOf 同剔，
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
- **相关题弹窗 × 刷题联动（Issue #44，20260913）**：`bank/ui/RelatedDialog`（知识文档
  面板行「查看相关题」+ 思源右键两入口）四动作接刷题模板既有机制，不自造轮子。
    - **收集口径唯一**：`data/RelatedQids.relatedRecordsOf` 纯函数（sourceDocId 命中
      ∪ kpRefs 落该文档下，**含「sourceDocId 命中但无 kpRefs」的题**）——弹窗列表与
      related 活视图专题题单**同源**；`questionsRelatedToDoc` 与 LiveCols 都走它，
      **旧的 slice(0,50) 截断已删**（题单与列表必须一致，弹窗可滚动）。
    - **related 活视图是第二种绑定**（LiveCols）：`nodeKey="related:{docId}"`、id
      `col-related-{docId}`、**不带 subKeys**（自带收集腿，`refreshLiveCollections`
      分流）；`ensureRelatedCollection` 物化，标题 `相关题·{来源文档标题}`（空标题
      不覆盖现值——文档删了也保住用户改过的名）。⚠️ **不得复用 col-kp-{id}**：那条腿
      按 kp 键收集（collectQids），漏掉无 kpRefs 的 sourceDocId 命中题，题单与列表对不上。
    - **预览/开刷** = 物化 → flush → 刷新侧栏 → `switchTo` → `switchWorkspace("drill")`
      （预览再叠 `enterPreviewMode`），与 `KnowPanelCtl.drillNode` 逐字同链路；对话调用
      点经 `QuizView.relatedAccessOf()`（实现 flow/RelatedAccess），**页签不在场时 access
      缺省**（思源右键在插件视图外触发）→ 列表照常、联动动作给 `relatedNoView` 提示。
    - **回顾** = 错题本 `ReviewCtl.filterQids(qids)`（`listReviewModel` 加 qidFilter 维，
      空集=不筛；进入时清 docFilter 防静默变窄；头部「相关题筛选」徽标一键取消）
      —— 详情/时间线全走既有通道，**不新做重刷**。
        - ⚠️ **复习入口必须先切回 `drill` 工作区**（20260913 复审修复）：壳渲染是
          **workspace 优先**——非 drill 时 `renderQuizShellFor` 直接出工作区面板并
          **早退**，`mode="review"` 根本不渲染；而相关题弹窗的行入口就在知识文档
          工作区，「回顾」只切 mode 就是**死钮**。故 `enterReviewFor` 里
          `switchWorkspace("drill")` 必须排在 `switchMode("review")` **之前**
          （两次 renderList 幂等，无副作用；`ModeOps.test` 锁调用次序）。
    - **AI 分析** = 一次 `agentChatOnce` + `track{kind:"analyze"}`（SessionPanelApp 的
      `KIND_KEYS` 已加 analyze→aiKindAnalyze）；prompt 在 `ai/prompts/related.ts`
      （三路材料按预算截断），**零作答数据省略薄弱段 + prompt 明令不得编造**；
      弹窗内 `renderMdHtml` 渲染，关窗不中止。
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
  （BankRecord.kramdown 契约格式）。题集 `{id,title,hPath,srcId,subject,qids[]}` 存 bank.sets
  （data/BankSets 函数式友元：ensureSets 按 records.sourceDocId 分组推导存量题集——
  零迁移机制，历史/docStats/影子专题键天然延续；setQuestions/setDocsView/setMaterials
  是装载侧全部供给，quiz 域文档 SQL/hydrate 管线 QuestionService/QuestionBatch/
  MaterialService 整体退役）。
    - **`subject` 真实学科**（Issue #83，20260914）：转换首批判定行报出
      （见 convert 域「首批第四行」），`BankSets.normalizeSubject` 归一键 +
      `peekSetSubject` 同步窥视；**唯一消费点 = 标生词的语言闸**
      （`quiz/flow/AnnoScope.isEnglishScope`：有学科以学科为准、无学科回退
      题型并集）。⚠️ **不接任何视觉/结构判定**——阅读面是材料组结构判据、
      与学科无关（`quiz/flow/ReadingScope`；把阅读面绑英语判别即 #83 根因）。
      optional、只加不改名、不 bump version、存量题集零迁移（ensureSets
      推导的存量集无此字段）。
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
