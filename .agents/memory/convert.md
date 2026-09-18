# src/convert/ —— AI 转换（`index.ts`=转换编排）

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
  `draft/ConvertDetect.ts` 只剩 parseTypes / parseSubject / questionPreview 三个纯解析。
    - **首批第四行 `SUBJECT`（Issue #83）**：题集真实学科，与题型**同批同
      协议**报出（零额外 AI 调用），片执行器 `deps.reportSubject` → 编排层
      取**首个非空**（同卷各片一致）→ `SetWriter.openSet` 落 `BankSet.subject`。
      三条口径：① **只有首批报**（多批各报各的会让题集学科随「最后一批」
      漂移，非首批 prompt 明确免报，回复里带了也不采信）；② 未报/占位
      「无」不上报（宁缺勿错——不落假学科，判别回退题型并集）；③ 续挂的
      存量题集**只填不改**（首批复检不覆写既有学科，要改须显式重转）。
      ⚠️ 解析正则冒号后必须是 `[ \t]*` 而非 `\s*`：`\s` 含换行，AI 写
      空的 `SUBJECT:` 行时 `\s*` 会把下一行 `@@Q ...` 吃成学科名（同
      GlossEntry 的 MARK_RE 跨行踩坑），落进题集的是一串标记行垃圾。
- **进度按已读比例**：批数事前未知，`ConvertProgress.readPct` 出「已读原文
  p% · 累计 c 题」（并行下 = 各片进度之和）。
- **批数两种口径必须分账**（20260910 并行回归）：`ConvertProgress.batch` =
  **已落库批数**（`submit` 每落一批 +1）；`BatchedResult.batches/total` 与
  `ConvertProgressRecord.batches/total` = **实际 AI 调用批数**（= Σ
  `SegmentResult.batches`，含零产物批、不含纯标题跳过窗口）。两者同时发生但
  语义不同，混用一个变量即面板/终止提示批数翻倍；回归测试
  `convert/service/test/ConvertBatchCount.test.ts` 锁死该口径。
- **批量转换 = 串行队列**（Issue #37，20260912）：弹窗选中的「文件夹式
  文档」（自身空、子文档有货）或勾了「连同子文档」的源 → 展开成子文档
  清单，**同一 ConvertRun 单例**逐篇串行跑（`ConvertBatchQueue.runBatchQueue`
  → `runSingleDoc`），一篇跑完/终止再起下一篇（与 ConvertIncrement 串行
  补生成、BankHealth.regenRecords 同款）。四条硬口径：
    - **队列全程占住 active 槽**：内层单篇 done/failed 收口会清槽，队列
      每起下一篇前 `setActive(run)` 占回；只有整队列收口或转抉择态才真
      释放——否则用户能在换篇间隙点别的转换插队；
    - **每篇各自成题集**：`BankSets` 按源文档推导天然支持，零新存储；
      `ConvertProgressRecord.batch?{index,total,groupTitle}` 只加不改名
      （optional、**单篇记录不带此键**、无 backfill、不 bump version）；
      写入点两处（失败篇 `settleFailed`、终止篇 `settleAborted`→`keepConvertRun`），
      载荷由纯函数 `ConvertRunState.batchMetaOf(cfg, docId)` 算；消费点是
      管理面板「未完成记录」行尾（`convertPanelRecordBatch` 标「第 i/N 篇 · 队列名」）——
      重开思源后仍能认出这条记录属于哪个队列的哪一篇。面板分篇行进度的
      实时态走运行中的 `ConvertRunSnapshot.batch.items`（内存，不落盘）；
    - **单篇失败不打断队列**：记一行失败继续下一篇，终态汇总
      「N 篇完成、M 篇失败：清单」走 `ui/Notify`；
    - **「停止」= 整队列停**：当前篇转保留/丢弃抉择（沿用单篇 aborted 语义，
      抉择记录里的 cfg.srcDocId 换成**当前篇**——单篇的 keep/discard 按
      cfg.srcDocId 记/清进度），剩余篇全部标 cancelled。
    - ⚠️ **逐篇清/记进度必须用本篇 id**（`settleDone/settleFailed` 收 docId
      参数）：批量下 `cfg.srcDocId` 是根，直接拿它记进度=清错篇的记录。
    - **分篇状态六态**（`ConvertBatchItem.status`）：queued/running/done/failed
        - `stopped`（用户终止时**正在跑**的那篇，已生成部分待保留/丢弃）+
          `cancelled`（因终止而**没跑**的剩余篇）——别把两者混成一个（面板分篇行、
          终态汇总都各按各的口径；`QueueTail` 四段 done/stopped/failed/cancelled
          之和恒 = 队列总篇数，不许有篇被漏计）。
    - **停止时剩余篇的 items 必须真翻牌**：`cancelRest` 只累加计数不改状态
      的话，面板分篇行永远停在「排队中」而汇总却报「已取消 N 篇」。
    - **换篇要占回槽 + 复位「转换中」**：内层单篇 **failed** 收口会
      `setActive(undefined)` + `setConverting(false)`（done 分支 inQueue=true
      不清，故这是兜底不是唯一写入点），队列每起下一篇前两者都补一遍
      （漏 `setConverting` 会让页内转换按钮在篇间误判空闲、用户能插队）。
    - 子文档发现走 `service/source/SubDocs.planSubDocs`（同笔记本 path LIKE
      递归、`rowsAll` 分页防 64 行截断、hpath 字典序=文件树序）；
      `buildBatchQueue` 纯函数（带单测）定队列组成：勾选=根+后代，未勾选
      且根空壳=只后代（空壳根永不入队——转换注定零产物）；`isBatchQueue`
      定「是否真起队列」——队列与「单篇=源自身」等价才退化，**空壳文件夹
      只有 1 个子文档时也必须走队列**（否则转的是空壳源本身，白跑一趟报
      「文档内容为空」）。
    - 回归测试 `convert/service/test/ConvertBatchQueue.test.ts`（串行/占槽/
      失败续跑/停止取消/分篇进度）与 `SubDocs.test.ts`（队列组装）。
    - **空壳判据 = 「有无正文」不是「有无块」**（Issue #42，20260912）：
      MinerU 等导入器的壳文档**全都带一个空段落块**（`content=''` 的 `p`），
      旧判据「`root_id` 下有无任何非 doc 块」在真机上恒为「非空」→
      `rootEmpty` 永假 → 未勾选时不自动展开（队列=根自身 → 转空壳报
      「文档内容为空」），勾选了则根 + 全部中间篇各报一次失败噪音。
      故 `SubDocs.HAS_TEXT_SQL` 只认「content 去空白后非空」的块，且
      **SQLite `TRIM` 只去空格**——换行/制表符要先 `REPLACE` 成空格
      （char(10)/char(13)/char(9)）再 TRIM，否则「只含换行的段落」会被
      误判成有正文。
    - **中间层空壳不入队**（`SubDocs.shellIds` / `hasTextProbeSql`）：
      `planSubDocs` 先按 hPath 前缀确定性选出目录级候选
      （`middleLayerIds`），再**只对候选发一次 SQL** 判空，**空壳才剔**、
      有真实内容的中间层照常入队。剔除落在 `planSubDocs`（唯一 SQL 供给
      点）而不是 `buildBatchQueue`——后者是签名固定的纯函数、拿不到
      「谁是空壳」，语义与既有用例全不动。
        - ⚠️ 探针**极性靠命名锁死**：`hasTextProbeSql` 回的是「**有正文**」
          集合，空壳 = 候选减去它。反过来当「空壳集合」用会**删掉有货的
          中间层** = 有真实内容被漏转，比不剔除更坏。
        - ⚠️ 探针必须**按篇聚合**（SELECT DISTINCT root_id … WHERE root_id
          IN (…)），不能写成「取一条命中」——`LIMIT 1` 让整批只回一篇，
          多候选判定失真。
        - 两条都用**真 SQLite 端到端**锁死：`SubDocsPlan.test.ts` 复刻 660
          真机结构（空壳根 + 3 个空壳中间篇 + 6 篇有正文叶子）跑整链，
          `SubDocs.test.ts` 直接跑探针 SQL 验极性与聚合——这两条纯函数
          断言验不出来，极性反了能全绿。
- **批量转换中断后可继续**（Issue #62，20260913）：三块咬合，缺一块闭环就断。
    - **逐批断点检查点**：`convertDocBatched` 的 `onCheckpoint` 在 `submit`
      每批 `flush` 后回调，`runSingleDoc` **仅 `inQueue=true`** 时接它落进度
      记录（单篇流程不接，记录时机逐字节不变）——批量跑到一半直接关思源，
      正在跑的那篇也有断点可续跑（原先只有 failed /「保留」抉择才落）。
      ⚠️ 中途值 `batches` 只能是**已落库批数**、`total` 恒 0：批数由 AI 的
      `@@TO` 决定、事前未知——它是**中途值**，与收口记录的「AI 调用批数」
      是两个口径（AGENTS.md「批数两种口径必须分账」不许破）。
    - **重发队列跳过已完成篇**：`runBatchQueue` 起跑前**一次 `bank.all()`**
      建 `srcId → setId` 映射（别逐篇 all()），逐篇判定收口在纯函数
      `classifyQueueItem(resume, hasSet, reconvertDone)`：有续跑记录→续跑；
      无记录但有题集→**视为已完成、零 AI 跳过**；皆无→从头转。勾
      `cfg.reconvertDone`（弹窗「重转已转换过的篇」，**仅队列模式显示**）
      则第 2 类照跑。查库失败一律按「无题集」处置（宁多烧不漏转）。
      `QueueTail` 由四段改**五段**（done + **skipped** + stopped +
      failed.length + cancelled，和恒 = 总篇数），新状态
      `ConvertBatchItem.status="skipped"`（与 done 分开是为让面板说清
      「这轮没跑」）。全跳过时无产物可切、不调 `onDone`（正常）。
    - **面板「继续生成」恢复整个队列**：`BatchMeta` 加 optional
      `rootId`（`batchMetaOf` 取 `cfg.srcDocId`），面板据此预填**队列根**并
      标记 `resumeQueue`——弹窗在子文档探查落定后自动勾「连同子文档」，
      整个队列展开、逐篇按 id 自查续跑（**不需要新恢复通道**）。存量记录
      无 rootId → 退化为现状单篇预填（optional、无 backfill、不 bump）；
      `ConvertDialogCtl.start` 的队列口径是
      `resumeRec && !resumeRec.batch ? [] : this.batchQueue()` ——只有
      **单篇**记录（无 batch 键）走单篇续跑不展开队列，带 batch 的记录
      走队列。
    - ⚠️ **`cfg.resume` 传不传看 `asQueue`，不是看「记录有没有 batch 键」**
      （20260913 复审修复的真机级缺陷）：队列逐篇自查记录
      （`ConvertBatchQueue.resumeOf`），起真队列时 `cfg.resume` 传了也是
      白传；但**存量队列记录（带 batch 但无 rootId）面板只预填该篇自己**
      ——那一篇若是叶子（无子文档）`isBatchQueue` 即假、退化回单篇流程，
      此时不传 resume 就丢了断点游标、整篇从头重烧（验收 5 破）。
      写成 `resumeRec && !resumeRec.batch ? {...} : undefined` 是这个坑的
      原形：判据必须与「本跑到底起没起队列」同源。
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
    - **逐段题集的重导**（20260910；Issue #74 加源级哈希与段表）：逐段自推进
      写入的记录 src-key 形如 `A:<区间起点偏移>`（批区间口径），批边界由 AI
      决定、不可复现——DocOps 见该前缀即**跳过增量三态分类**；确定性结构
      切块的存量题集（`H:` 键）增量能力不变。
        - **源级凭据两个 optional 字段**（`BankSet.srcContentHash`/`segs`，
          只加不改名、无 backfill、不 bump version）：转换每批 flush 后追加
          一段 `{s, e, h}`（段首尾相接、连续覆盖 `[0, 已落库游标]`）并写整篇
          哈希——`e` 取**本批实际落库游标**（非片尾），偏移口径与 `A:` 键、
          断点游标同一字符串同一单位（剥块 id IAL 后 kramdown 的字符偏移）。
          纯逻辑在 `convert/service/source/SetSegments`（`advanceSegs` /
          `hashContent` / `planReimportBySegs` / `qidsFromOffset`，带单测）。
        - **判定顺序三条不许挪**：① **有续跑记录 → 照旧断点续跑**（记录在
          =上次没跑完，不做未变更短路、不做段比对；批量队列逐篇自查记录同
          口径）→ ② 无记录 + 整篇哈希命中且等于当前源 → **零动作**
          （notifyReimportUnchanged，不删不烧）→ ③ 无记录 + `segs` 在 →
          逐段比对取**第一条失配段** k：删该题集内 `srcKey` 偏移
          `>= segs[k].s` 的记录（`removeRecords` 既有回收口径）后从该处
          续转；全段命中但整篇哈希不同（文末追加）=从末段 `e` 起续转、一段
          不删；④ 无 `segs`（存量/旧记录）→ 现状行为整卷重转。
          ⚠️ **无段表就不认整篇哈希**（凭据缺失宁多烧不漏转，且两者同点写入
          不该分叉）。
        - **源文本必须两边同源**：`DocOps.srcTextOf` 读源时剥的 IAL 正则与
          `ConvertBatch` 入口**逐字一致**——两边取的不是同一条字符串，哈希
          永远命中不了「未变更」（`SetSegments` 侧另有单测锁同源）。
        - **续跑篇起跑前校正凭据**（`ConvertBatchQueue.refreshSetHash`）：
          队列逐篇自查记录续跑，路上用户可能已改过源——当前源哈希与题集记的
          不同就清掉 `srcContentHash`（段表保留，逐段比对仍能定位失配段），
          否则下一次重导会误判「未变更」而漏掉已改内容。

- **洗牌同步改写解析字母**（Issue #123，20260915）：协议让 AI 按「正确项写
  最前」写**解析**（「A 正确，B 错误」），`shuffleGroup` 原先只重写答案字母
  → 解析字母全部失配。现按**同一条字母映射**（旧字母 → 新字母，与 `newRun`
  共用同一套 `order`，禁分头重算）改写解析类部件里的**独立裸字母词符**。
    - 词符口径：A–H 单字母 + 词边界（`(?<![A-Za-z])[A-H](?![A-Za-z])`）；
      跳过的命中必须**原样补回**（`out += slice(last, at) + to`）——早期实现
      用 `continue` 跳，会把受保护区之后的文本整段吞掉，单测实测抓出。
    - **保护区**（`protectionMask`，逐字符布尔遮罩）：行内代码、围栏代码、
      `$…$`/`$$…$$`、`\(…\)`/`\[…\]`——公式里的 A 不是选项字母，改了
      就是静默毁公式（与 gloss 域 `^{}` 的 protectedSpans 同纪律）。
    - **所有格前缀**（`students' A`）不认（避免误伤）；位置敏感措辞组本就跳过
      洗牌，「A 和 B」类解析天然不失配。
    - ⚠️ **语义前提**：该改写假定「解析字母 = 本组选项的序位字母」（=「正确
      项写最前」协议的含义）。重生成链已改 keep 序（选项按原题顺序），此时
      映射恒等、改写零动作；**keep 序下解析仍写旧字母属语义错误，位置映射救
      不了**，由 `bank/gen/RegenVerify` 的核查 + AI 自检兜底（见 bank 域）。

- **20260915 大转向：库=死形态，洗牌挪去展示层**（Issue #131，与 #123 同根
  的第二/第三期）。#123 只给 regen 链接了核查（`reseatAnswer`），**转换链
  仍在跑「正确项写最前 ＋ AI 抄原题字母」的自杀组合**：真机重转 220 条
  draft 里 32 条答案字母已错（14.5%），落盘洗牌把错位忠实传播进库。定案
  「库是死的、洗牌是函数、解析无选项字母」，四块咬合：
    - **keep 序逐题条件规则**（`ai/prompts/protocol.ts` 的 `OPT_LINE_BY_BANK`）：
      `protocolSpec(types, { bank: true })` 要求 AI **逐题判断**——原文这道题
      本来就有现成选项 → 按原题顺序与字母原样给出；原文没有（讲义/笔记新造
      题）→ 正确项写最前。整卷转换（`ConvertBatch` 的 makeCall）与增量重
      转换（`ConvertIncrement`）都传 `bank=true`；出题/加练/变式链不传
      （默认变体逐字节不变，prompt 测试锁着）。`order:"keep"`（regen 专用）
      与 `bank` 并存时 `bank` 优先。
    - **写库洗牌全部撤除**：`ConvertSegment`/`ConvertIncrement`/`GenQuestion`/
      `RegenDialog` 四处 `shuffleDraftOptions` 调用点全删——bank 与题源文档
      统一为**死形态**（选项按原文顺序、答案字母指向原文位置）。附带收益：
      落库 kramdown 确定性（重转换 hash 稳定，不再每次随机洗一遍）。
      ⚠️ `draft/OptionShuffle.ts` **实现与单测保留**（存量数据仍在用），
      死形态下若在生成链上恢复调用 = 把死形态又洗乱，别再接线。
      ⚠️ **`OptionShuffle` 的解析字母改写口径已接出**（#176）到
      `draft/LetterRefs.ts`（词符/保护区/所有格/英文正文词/引用前缀）与
      `draft/OptGroups.ts`（选项组分组/字母表/长文本截断/引用前缀映射）——
      展示层洗牌（`quiz/render/CardDisplayShuffle`）与落库规范化共用同一套，
      改口径只改这两个文件，别在调用侧另起正则。
    - **解析里的选项字母引用**（Issue #176，20260918 — 落库侧堵新流量）：
      #131 的冻结口径「库内解析不含任何选项字母」在真机上**没守住**（工作区
      bank 实查 841 道里 835 道带字母引用）。落库链新增**第二道**：
      `normalizeDraftOptionRefs`（`OptionRefReplace`）把解析/题干里的
      **裸字母**与**「字母 + 全文」**引用规范化为 `「选项文本」`
      （长文本截断复用 `OptGroups.displayText`，与标记替换同形态）。
      三条落库链**同链调用**（`normalizeDraftOptionRefs(replaceDraftOptionRefs(
unpackPackedOptions(d)))`）：`SetWriter.append` / `GenQuestion.genWithVerify`
      / `RegenDialog.runRegen`——加新链照这三处自己接。
      口径要点：
        - **无凭据（字母超出该组选项数）一律原样**——宁可读起来突兀，也不
          静默改写/删字（同标记替换的降级口径）；
        - **受保护区一律不碰**（与标记替换相反！标记是显式意图故照常替换，
          裸字母是**猜测**，碰了就是静默毁公式）；
        - 「字母 + 全文」形态把标签（`B.` / `（B）`）与全文**一并吃掉**，
          否则留「『文本』. 文本」叠影；裸字母形态**保留**引用后的空白
          （`「文本」 正确`）、标点不归引用（`A，B 均错`）；
        - **存量零迁移**：存量解析的字母由展示层洗牌时改写
          （`CardDisplayShuffle` 同步 remap），本道只管新流量。
        - ⚠️ **「字母 + 全文」吃掉的区间必须跳过后续命中**（20260918 复核
          修掉的实缺陷）：`matchAll` 按**原文**位置迭代、不看上一处的游标，
          而选项正文自带独立字母是常态（英文阅读题 `A. A big plan…`、
          `B. The author…`）——不判「已吃过的区间」就会把它们当第二处引用
          再换一遍，输出重复叠影（`「A big plan」「A big plan」 big plan`）。
          判据只看位置，与字母本身无关（同 `rewriteLetters` 的跳过口径）。
        - ⚠️ **`Plan A` 的英文正文词排除要认多格空白**（同次复核）：
          `WORD_BEFORE` 原写 `[ \t]$`（只认一格），`Plan  A works` 双空格
          排版漏判 ⇒ 正文里的字母被当引用改掉；改 `[ \t]+$`。
    - **解析选项引用标记协议**（`draft/OptionRefReplace.ts`）：凡指代选项
      一律写 `〔opt:X〕`（全角方括号，与「〔插图:…〕」同款、与 IAL `{:` 无
      碰撞），**不得用裸字母指代选项**；非指代的大写字母（Plan A、维生素 A）
      照常书写。落库前把标记换成选项文本（「」包裹）。X 非法（**该组**选项
      数内）→ 降级裸字母（丢标记不丢信息）；数学环境内的标记**照常替换**
      （标记即显式意图，与 gloss 域 `^{}` 的取舍相反）。
      ⚠️ **三个接线点，不是「唯一落库出口」**（20260915 审查 P1 修正）：
        1. `SetWriter.append`（转换 / 增量两条链）；
        2. `bank/ui/RegenDialog.runRegen`（**直写 `replaceRecordKramdown`，
           不经 SetWriter**）——原稿断言「唯一落库出口」对 regen 不成立，
           漏接线的后果是 keep 序 prompt 要求的裸标记**原样写进题库并显示
           在题卡上**。落点在 `reseatAnswer` 之后、`verifyPrompt`/`renderUnit`
           之前（自检看到的必须就是落盘形态）。
        3. `bank/gen/GenQuestion.genWithVerify`（加练/变式链，产物经
           `addGenerated` **直写题库**）——**第二个被「唯一出口」漏掉的链**。
           P1-2 把标记约定改成缺省恒在后这条链也开始要求 AI 写标记，而它当年的
           两道格式处理（拆行 + 替换）是随 `shuffleDraftOptions` 一起被撤掉的
           ⇒ 裸标记与挤行选项**双双原样落库**（真机后果：题卡解析显示
           `〔opt:A〕`、挤行题只剩一个选项）。现按 SetWriter 同款两步接线：
           ① `unpackPackedOptions`（拆行、不碰答案字母）→ ② `replaceDraftOptionRefs`。
           `GenQuestion.test.ts` 三例锁住（标记不落库 / 自检入参=落库形态 /
           挤行字母不动）。
           ⚠️ **regen 链同样漏了拆行**（同次补齐）：`RegenDialog.test.ts` 新增
           一例锁住——`shuffleDraftOptions` 撤除带走的是**两道**处理，只补标记
           替换仍会让挤行回复落库成「只剩一个选项」。
           **判据：凡是「AI 产物直接落库」的链（不经 SetWriter 的），标记替换
           与挤行拆行都要各自接线** —— 加新链时照 regen 与 gen 这两处自己接，
           别指望 SetWriter 兜。
           ⚠️ **标记约定缺省恒在**（同次审查 P1）：它曾随 `order`/`bank` 条件生效，
           把 `GenQuestion` 的 conceptPrompt/variantPrompt（加练/变式，走**默认
           协议**）漏在链外——那些链解析写裸字母、写库又不洗 ⇒ 一进卡就指错，
           正是本单要杀的 bug 类。现 `withSolRule = opts?.solRule !== false`，
           `solRule: false` 只作逃生口（无调用方）。protocol 测试锁三个变体都带。
           ⚠️ **字母表按部件分组**（同次审查 P1）：`option*`（顶层）与
           `step-k-option*`（第 k 步）是**各自从 A 起**的独立字母表。拍平进同一
           张表时，两步各 3 选项的题里 step-2 解析的 `〔opt:A〕` 会换成 **step-1**
           的选项文本（静默错内容）。`ctxGroupOf` 按部件名定组（顶层
           `solution`/`stem` → 顶层组；`step-k-*` → 第 k 步组），与
           `CardDisplayShuffle` 的逐步独立洗牌同源，两处一起看。
           ⚠️ 契约现实：`resolvePart` 只认 `step-N-(stem|option|answer)`，
           `@@P step-1-solution` 会解析成空名被丢 ⇒ **逐步解析当前不入协议**
           （整题解析统一写 `@@P sol` = 顶层组）；上面的 `step-k-*` 分支是前瞻
           实现，测试里有一条断言锁住这个现实。
    - **挤行拆行接出**（`draft/OptionUnpack.ts`）：旧 `unpackPackedSingle`
      是「格式规范 + 把答案改成 A」的合体，后者建立在「正确项在最前」假设
      上——死形态下字母指向原文，改答案就是凭空判错。新函数**只拆行、不碰
      答案字母**，接线与标记替换同点：`SetWriter.append` 与
      `GenQuestion.genWithVerify`（两处都是纯函数、都不改调用方手里的 draft）。
      ⚠️ 挤行拆行**也不是 SetWriter 独有**：出题链同样直写题库，原先由
      `shuffleDraftOptions` 顺带做的拆行随之一并撤掉，漏接即「挤行题只剩一个
      选项」落库。
    - ⚠️ **展示层洗牌换的是副本对象**（`quiz/render/CardDisplayShuffle.ts`
      在 QuizShell 里 `buildDrillUnits` **之前**跑）：凡按 `indexOf(q)` /
      身份比对做「题在整卷里的下标」的地方**必然落空**——本次顺修三处
      （`FlowDom.markNum`、`AnswerFlow.skipQuestion`、`markNumAnswered`）
      改为 `qIndexById(host, q.id)`。以后加任何「卡 → 卷内下标」的反查，
      一律走 id，别用对象身份。
    - ⚠️ **展示层排列按 (会话 id, 题 id) 定种子**（20260915 评审，与 quiz 域
      同一条）：会话/题库只记字母、排列只在卡里，重渲染重掷会把恢复的字母
      指到别的选项上；恒等排列要重掷（「像没洗」）。**答案侧必须升序**——
      `gradeQuestion` 对纯字母答案是整串比较、用户点选恒升序，答案不排序则
      多选题「点对也判错」。两条口径的由来与单测位置见 quiz 域同名条目。

- **语篇材料块判定 + 真题优先 + 悬空兜底**（Issue #148，20260916）。真机：
  英语真题聚合文档转换后「**题目分开了**」——第 1 批片段只有文章正文（题目
  在后批），AI 判为讲义口径**自造 8 题**且不出材料块；第 2 批 5 道真题全写
  `group=prev`（引用「文中紧邻其前的材料块」）**引用悬空**。根因：规则 4 的
  「一题对一题 vs 讲义出题」按**单批片段**判定，AI 对「这篇文章是后面真题的
  材料」没有意识。三块咬合：
    - **prompt 4.2 语篇判定**（`ai/prompts/convert.ts`）：考研英语/真题风格的
      **文章语篇**（成段英文正文 + 标题/来源行含 `Text N`/`Part A`/`逐题细解`/
      `逐句精讲`/`Reading Comprehension` 等特征即认定）**即使本片段没看到配套
      题目，也必须按材料输出**（`@@Q material=1` + `@@P body`，有译文加
      `@@P trans`），**不得自造题、也不得跳过**——配套真题几乎总在紧随的批次。
      判定顺序：**先按特征认出语篇、再看本批有没有配套真题**（互不排斥）；
      本片段同时有配套真题时按规则 7 一题对一题 + `group=prev` 挂靠。
    - **prompt 4.1 真题优先去重**：同一文档里只要有现成真题就以**真题为准**，
      不得再为同一语篇/同一考点自造题（真机撞车：自造态度题 vs 真题态度题）；
      自造题**只用于完全没有现成题目的语篇/章节**（纯讲义/笔记/无题文章）。
    - **prompt 规则 7 悬空禁止**：写 `group=prev` 的小题，其本批之前必须已有
      材料块（同批内材料块在小题之前）；本批之前从没有材料块又本批也没有
      → **先补材料块再写小题**，孤立小题不写 group。
    - ⚠️ **prompt 与代码是两道防线，缺一不可**：prompt 是概率事件，回收侧必须
      有确定性兜底（下条）。
- **`group=prev` 悬空兜底**（Issue #148 验收 3，`output/SetWriter.ts`）：材料=
  文中紧邻其前的材料块，`lastMaterialId` 为空的旧行为是**静默**不写 group
  （读侧 `DrillUnits` 缺材料本就按独立题渲染，不算坏指针，但用户只看到「题目
  分开了」而不知原因）。现口径三条：
    - **显式降级**：写 `prev` 却没有材料块 → 不写 group 字段、解析视图也不带
      `group`（独立题），即**降级而非悬空**（宁缺勿错，不落指向不存在材料的
      group）；
    - **计入 `AppendOut.danglingGroup`**，由编排层并进完成消息警告
      （`convertGroupDangling`「{n} 道题的共享材料缺失…已降级为独立题」）；增量
      链同口径（`IncrementOutcome.danglingGroups` → `incrGroupDangling`）。
    - ⚠️ 判据是「**写了 prev 且无材料**」而不是「有无材料」：不写 group 的普通
      题不计数。
- **完成消息的两段拼接体抽出**（Issue #148，`run/ConvertBatchTypes.ts`）：
  `warnSuffixOf`（四段自检警告：插图缺失/空批/定位失败/**悬空 group=prev**，
  非零才出现、顺序固定、各前导一空格）+ `doneMessageOf`（「题型清单 · 知识点
  反链数」主题段 + 上述警告尾巴，`convertTypeList`/`convertKnowCount` 有值才
  拼）。抽出前这段内联在 `convertDocBatched` 收口里、四条分支都测不到
  （该函数要 AI 与 IO）；抽成纯函数后逐分支单测直锁。`countMissingImages`
  的原料（源文/产出）也在 `doneMessageOf` 内部算，调用方不拼计数。
- **长选项的解析替换形态**（Issue #148 追加评论，`draft/OptionRefReplace.ts`）：
  英语阅读题的选项是完整英文长句，整句塞进解析会让「正确答案：〈60+ 字符英文
  整句〉」连占三行（真机截图）。现按**码点**（`Array.from`，不用 `str.length`
  ——代理对按 code unit 判会误判）判长：超过 **40 码点** 的选项只留前 **30 字**
    - 省略号（`「A proposal to establish…」`）；短选项（政治题「维护封建统治」）
      维持全文替换、逐字节与改造前一致。
        - ⚠️ **截断后不补字母提示**——追加评论把「…（D）」列为备选形态，首版实现
          照做了，**复核后撤销**（自验缺陷，20260916）：字母是**位置引用**，烘进
          解析文本即随库固化在**转换时**的序上；而展示层 `CardDisplayShuffle` 进卡
          现洗选项时**只重映射 `answer`、不重写解析文本**（设计如此）。于是洗一次序
          就失配：卡上「正确答案」按 `answer` 给 A 项加色、解析里的「（A）」指另一个
          选项——5 个会话 5 次失配（每轮换排列、每次都错到别处），**真机可见的错误
          指代**。故只截断、不带字母：前 30 字本身即指代（选项互异），「正确项是哪
          个」另由 `answer` 字母 + 描色呈现，不需要解析再带一份。
        - ⚠️ 由此**重新守住**「库内解析不含任何选项字母」的冻结口径（`docs/question-block-contract.md`）
          ——回归锁在 `OptionRefReplace.test.ts` 末组：用**真实** `shuffleListForDisplay`
          断言「换会话洗牌后解析逐字不变 + 答案字母仍指向同一选项文本」。加任何
          「往解析里写字母」的改动前先跑它。
