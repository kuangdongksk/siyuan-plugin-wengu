# 增量哈希方案（内容寻址转换/关联）

2026-08-31 定稿方向。目标：文档只改一部分时 AI 只处理变更部分，题只改
一道时只重生成了这道——按内容哈希跳过未变输入，省 AI 调用成本。

## 〇、为什么不用思源历史/比较 API

内核 history 体系（`/api/history/getDocHistoryContent` 等）面向「整文档
回滚」，前端的版本比较是 UI 组件（`history__doc-compare` 对话框选两个
版本渲染 diff），**内核没有暴露「diff 两版本返回变更区间」的程序化
API**；且文件历史需在设置里开启才有数据。就算能拿到 diff，把变更区间
映射回「哪个转换块」也绕不过自己切块这步。结论：自建内容寻址，不依赖
思源历史。

## 一、现有地基（已存在，直接复用）

- **题级哈希**：`BankParse.questionHash(kd)`——剥块 id 与 `updated`
  时间戳后的双 djb2 指纹（`h1-h2` base36）。`BankRecord.hash` 逐题存
  储，`BankData.hashed` 做「指纹 → qid」反查，现用于跨卷同题去重与
  解析缓存失效。**「每题一个哈希」已在跑。**
- **分块转换**：`ConvertService.chunkKramdown`（5000 字空行边界）、
  每块独立路由+生成、独立落盘——增量替换的天然挂点。
- **路由结果可缓存**：MatchDialog/BatchLinkDialog/TagDialog 三处共用
  `routeKnowledgeDiag`，入参是题目文本+知识索引，纯函数式可缓存。

## 二、分期方案

### 第一期：路由结果按题哈希缓存（✅ 2026-08-31 已落地）

实现：`src/bank/data/RouteCache.ts`——`routeKnowledgeCached` 共用入口
（MatchDialog/BatchLinkDialog/TagDialog 三弹窗换调），模块级单例
`initRouteCache`/`routeCache` 由 index.ts onload 注入
`saveData("route-cache")`。要点与本节方案的差异：

- 缓存键：`questionHash(路由输入文本)`（弹窗侧路由喂的是 routeTextOf
  的题干+选项，按实际输入取指纹）+ 模型 id；知识索引代数
  （`indexGenOf`：全部章 docId+path 与小节 id+path 的指纹，比「章数/
  小节数」更严——任何结构级变更必失效）作为整表代数，不符即整表
  作废重建。
- 缓存值：`{id,title}[]`；**AI 明确判零命中的空结果也缓存**（空也是
  有效答案），但 AI 调用失败（onFail 触发）不缓存，下次重跑再试。
- LRU 上限 2000 条（命中刷新时序，Record 保插入序淘汰最旧）；
  put 只进内存，一轮跑完与题库同节奏 flush（串行落盘链防内核并发
  互吞）。单测 `RouteCache.test.ts` 13 例。

### 第二期：结构切块 + 块级 src-hash + 增量重转换（✅ 2026-08-31 已落地）

实现：切块/注入/分类纯函数在 `src/convert/service/SrcChunk.ts`
（单测 SrcChunk.test.ts 14 例），落盘执行在 `ConvertIncrement.ts`，
入口接线 DocOps.runIncrementalReimport + `convert/ui/IncrementDialog`
（逐块选弹窗）+ ConvertRun.startExclusiveConvertRun（独占运行槽）。
与本节方案的差异与要点：

- **结构切块**：`structuralChunks`——标题行（h1~h6）为边界，键=祖先
  标题链 `H:章/节`（同链重复 ~2 消歧）、首标题前导段 `P0`；超 5000 字
  的大块复用 chunkKramdown 空行二切，子块键 `H:章/节#k`。转换主管线
  （ConvertBatch）已切换，offset 保留续跑断点照旧；前置检测的窗口
  切块（ConvertDetect）与切块无关，不动。
- **三态分类两阶段**：先**全局指纹匹配**（同内容=同块——子块序漂移、
  标题改名内容不动都零成本跳过；逐块贪心会让键先消费掉该被指纹解救
  的组，必须整轮先行），剩余块再按**键**配对（键同指纹异=变更），
  配不上=新增；两头不沾的旧组=消失。`custom-plugin-wengu-src-key`
  随 `src-hash` 一起写进容器 IAL（计划里只提了 src-hash，补 key 是
  「变更 vs 新增」可区分的必要信息），保留旧题打 `src-stale="1"`。
- **入口优先级**：重新导入时「无续跑记录 + 题集带 src-hash」才走增量
  （整卷完成态）；有续跑记录（中断未完成）照旧断点续跑，无 src-hash
  的旧版题集照旧整卷重转——升级路径不产生重复题。全部相同直接收口
  「源未变化」零成本。
- **中止自愈**：增量执行中止后已追加块自带指纹，重跑分类即「相同」
  跳过，无需续跑记录；失败/中止路径同样跑题库幂等重扫
  （refreshDocFor：追加块入 records、删除块出 records）。
- 省费模式设置项 `convertKeepOld`（设置→AI 转换）：跳过弹窗、变更/
  消失全保留、只补新增。新块**串行**生成（增量通常只几块，不复制整卷
  的并发池），追加到既有题集末尾（不删旧重建，未变块统计原样保留；
  新题在文档序上排最后）。
- 回填内核路由：`EApi.DeleteBlock` + `KernelBlock.remove`（20260829
  清理时因零调用方移除，现有消费方后回填）。

### 第三期（可选）：题级 src-hash 回写——20260831 评估后搁置

原设想：每题容器 IAL 加该题来源**段落**的指纹，重生成单题前先比对源段
是否真变——没变直接拒绝（「源未变化，无需重生成」）。

评估结论（二期落地后）**搁置**，理由：

- **粒度拿不准**：分块生成时哪道题来自哪个段落是 AI 决定的，插件侧
  确定性可知的最细粒度=块（二期已落 src-hash）。要拿到题级指纹只能
  让 AI 在产物里回显来源段（动核心生成 prompt + 解析 + 可靠性兜底），
  收益与风险不成比例。
- **守卫目标已被覆盖**：重生成（RegenDialog）是用户手动修复坏题的
  动作——用户给了改好的原文块才值得重花一次 AI；「源没变还自动重生成」
  的浪费路径在增量重转换里已被块级三态分类拦住（相同=跳过）。
- 若未来 AI 产物带来源段标注成为现实需求，在二期基础上加一个属性
  即可，无需现在动管线。

## 三、约束与注意

- 归一化口径必须与 questionHash 一致（剥 id/updated、空白归一），
  否则思源读回 kramdown 的格式噪声会造成假变更。
- 结构切块对「无标题纯段落流」文档退化为按空行大块（边界=空行组），
  仍比偏移切块稳定（中间插入只影响所在大块）。
- IAL 新属性 `custom-plugin-wengu-src-hash` 需同步
  `docs/question-block-contract.md` 与 `src/siyuan/attrs.ts`。
- 思源历史/快照体系保持零依赖（见 §〇）。
