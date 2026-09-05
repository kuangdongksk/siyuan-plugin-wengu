# 温故 → Tauri 独立应用平迁方案（含 Vditor 双链反链）

2026-09-04 定稿。三轮讨论合并稿：初案 + 全仓勘察修订 + 思源 S3/DejaVu、
Lute/Vditor 一手源码调研。**状态：文档定稿，未开工**——是否/何时开工另行
拍板；本方案冻结架构决策与勘察结论，开工前需重验「二」节证据（行号会漂）。

## 〇、决策台账

| #   | 决策                                                                                                                         | 状态         |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------ |
| D1  | S3 进架构：M7 落地，Rust `ObjectStore` trait（LocalFs 先行、S3 后补），同步走快照仓库模型（DejaVu 缩小版），配置字段照抄思源 | ✅ 已定      |
| D2  | 编辑器 Vditor-only（IR 模式）：知识文档编辑+预览同一引擎；题卡永远 MdRender，边界在 store 层                                 | ✅ 已定      |
| D3  | 资产 URI 单出口：md 内只写库内相对路径，`resolveAsset` 决定伺服来源；`source_files` 表一步到位（`s3_key` 列预留）            | ✅ 已定      |
| D4  | 块 id = 内容哈希锚编码成冻结形态（`{14位时间戳}-{7位字母数字}`），BLOCK_REF 正则不动                                         | 默认（可翻） |
| D5  | 同步最小闭环 = 快照导出/导入（与 M7 同一打包格式，M7 只换介质自动化）                                                        | 默认（可翻） |

D4/D5 是审查轮给出的推荐默认，直接按此执行；翻案只动对应小节。
被推翻的中间结论存档：审查轮曾建议「Vditor 编辑 + MdRender 预览」分离，
Lute 源码调研证实 Vditor 三模式全由 Lute 驱动、公式渲染完整，分离方案
多余——**勿再回头**。

## 一、动机与思源耦合面

离开思源的六个耦合点（全替换）：

1. `siyuan` 包：Plugin/openTab/Custom/addDock/`Dialog`×12 文件/`Menu`×2
   （companion/ViewBindings）/showMessage/getActiveEditor/eventBus
   （ws-main、open-menu-content 右键注入）。
2. 内核工厂 `src/siyuan/`：EApi 17 端点（api.ts 枚举实测）+ Kernel
   Block/Doc/Notebook/Query + files.ts（putFile multipart）。
3. saveData 十店 → SQLite：ai-sessions/bank/companion-chat/history/
   know-hash/quiz/route-cache/settings/weakness/words（knowTrees 在
   bank.json 内非独立店；词书是 `data/wengu/` 工作区文件）。
4. AI 通道：`ai/client.ts` 走内核 agent/chat（saveSession→chat→
   removeSession 独立会话）→ 直连供应商；`ai/models.ts` 读
   `window.siyuan.config.ai` → 自建配置。
5. 块 IAL → 题块=SQLite 行（20260903 存储收口后题库本就是唯一内容真相，
   kramdown 契约只作为记录内部格式随行存储）。
6. 输入摄取：思源文档（KernelBlock.kramdown 读源）→ md 文件夹/PDF/Word。

**勘察修正**（初案误差，以仓庘认证为准）：

- Dialog 是 12 处不是 9；另有 Menu×2 与右键菜单注入，host 层需一并给。
- `stats` 不碰 KernelQuery（KernelQuery 使用者只有 bank/convert/ui）——
  统计数据本就从题库聚合，M4 无查询层替换工作。
- `agentPanel.ts`（思源内置智能体面板 DOM 自动化）整体退役，
  「页内降级」路径转正为唯一路径。
- `WordSpeak` = 系统 speechSynthesis 离线 TTS——**听音选义无音频资产需求**
  （真人词典音频仍是插件侧挂账项，若将来接也走 source_files 通道）。
- 内嵌 Protyle 已于 20260830 退役；`ProtyleHost` 现为静态渲染宿主，对
  思源唯一依赖是 `ProtyleMethod.mathRender`（KaTeX 惰性链，一个文件内）。
  初案把 CardState→ProtyleHost 列为最大暗雷——实测风险降级：换
  `katex.renderToString` 直扫 `data-content` 占位即可。
- MdRender 对图片零特判（相对路径靠宿主伺服）——独立版必须配资产伺服
  （Tauri asset protocol / resolveAsset），遗漏则知识文档与材料图全裂。

## 二、现有代码可复用地基（20260904 勘察证据）

直接复用、缺的只是反向索引与插入器的：

- **块引用渲染管线**：`BLOCK_REF` 正则（`ui/MdRender.ts:113`）→
  `postProcess` 置换 `wengu-blockref` span（MdRender.ts:119-125）→
  document 级点击委托（`index.ts:329` onBlockRefClick，树节点降级跳
  源章节文档的先例就在其中）。
- **kpRefs 全家**：`bank/data/{BankParse,BankRegen,BankReconcile,
KnowRoots,KnowTrees,BankSets,LiveCols}.ts`——题→知识节点引用、
  对账、活专题 `col-kp-{块id}` 键。
- **纯函数切块**：`convert/service/SrcChunk.ts structuralChunks`（标题
  链边界+questionHash 同款指纹），输入是纯 markdown 文本，直吃 .md 成立。
- **自包含渲染**：`ui/MdRender.ts`（markdown-it，思源同款占位形态：
  `div.p` 段落 / inline-math span / NodeMathBlock div）。

纯逻辑直搬清单（只换介质不动算法）：BankParse/BankRecording/BankRegen/
KnowLinkText/KnowTrees/KnowledgeNorm/KnowRoots、OptionShuffle/
QuestionDraft/SetWriter/SrcChunk、quiz/flow 与 render/（CardState 借
ProtyleHost 处改 host/KaTeX）、companion/rules/、ui/MdRender.ts、
ts-fsrs/echarts、全部 Svelte 组件。

反向红利（搬迁时可简化、勿当必要复杂度保留）：全仓「fetchSyncPost 必须
串行」的 workaround（串行链、600ms 去抖、防抖落盘）在 SQLite 事务下
大部分可退役；`fetchSyncPost` 实际落点已收拢在 `siyuan/{block,doc,
query}.ts` 三文件（其余 grep 命中皆为注释）。

## 三、目标架构

```
Tauri 窗口（单窗口多页签 + 左侧树；不复刻思源 dock 布局系统）
├ 前端 Svelte 5 + TS（vite）
│  ├ src/host/      替 "siyuan" 包：HostApp 页签壳 / HostDialog / Toast /
│  │                b3-lite 主题层 / KaTeX 直连（替 ProtyleMethod.mathRender）
│  ├ src/editor/    Vditor 封装（本地 cdn、IR、引用插入器、预览后处理、反链面板）
│  ├ src/store/     invoke → Rust；SQLite 装载层（替 saveData 十店与 src/siyuan/）
│  │                + resolveAsset 资产单出口
│  ├ src/ai/        client.ts 内部换直连供应商（agentChatOnce 签名不变）
│  ├ src/ingest/    md 文件夹 / PDF / Word → SrcChunk
│  └ src/{quiz,convert,bank,word,review,stats,companion}/   纯逻辑直搬
└ 后端 Rust
   ├ SQLite（sqlx + migrations + PRAGMA user_version 版本闩）
   ├ ObjectStore trait：LocalFsStore（先行）/ S3Store（M7）
   ├ PDF（pdf-extract）/ Word（docx-rs）文本提取
   └ AI 代理转发（藏 key、SSE 透传）
```

**b3-lite 主题层**（M0 必做，初案漏项）：29 个 Svelte 组件长在 b3-* 类、
scss 里 387 处 `var(--b3-*)`。host 层需本地实现这批类与 CSS 变量
（b3-button/b3-label/b3-dialog/b3-list/…），否则所有迁过去的组件裸奔。
机械工作量，但不进 M0 则 M1 全程无样式。

## 四、存储设计

### 4.1 SQLite 表映射

| 插件侧存储             | 表                                                                                                                | 说明                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| bank（questions）      | questions                                                                                                         | id,kramdown,hash,srcId,srcHash,sourceDocId,rootId,type,  |
|                        |                                                                                                                   | knowledge,chapter,difficulty,source,attempts,wrongCount, |
|                        |                                                                                                                   | right,lastAnswer,step_,slot_,totalTime                   |
| bank.sets              | sets                                                                                                              | id,title,hPath,srcId,qids(JSON)                          |
| 专题                   | collections                                                                                                       | id,path,qids(JSON)                                       |
| bank.materials         | materials                                                                                                         | id,正文                                                  |
| bank.knowTrees         | know_trees                                                                                                        | srcId→节点树 JSON                                        |
| 知识文档（原思源文档） | know_docs                                                                                                         | id,title,content(md),parent,updated（Vditor 编辑存此）   |
| 双链反链               | refs                                                                                                              | fromDocId,fromAnchor,toId,text（保存时扫 md 重建）       |
| 旧 id 映射             | legacy_id_map                                                                                                     | 思源小节块 id → 新标题锚 id（见「六」）                  |
| 源文件清单             | source_files                                                                                                      | id,kind(md/pdf/word/image/audio),local_path,             |
|                        |                                                                                                                   | **s3_key(NULL)**,content_hash,size,sync_state            |
| 其余十店同名表         | know_roots/words/wordbooks/history/weakness/quiz_rounds/ai_sessions/route_cache/know_hash/settings/companion_chat | 同义直迁                                                 |

版本闩移植：装载/落盘闸改为 `PRAGMA user_version`；数据演进守则
（字段只加不改名不删、冻结清单）整段照搬适用。

### 4.2 资产与 URI 单出口（D3）

- md 内媒体引用一律**库内相对路径**（`assets/xxx.png`），禁绝对路径与
  http URL 进库——存储介质换两次，内容数据一次不动。
- `resolveAsset(ref) → URL` 唯一出口：前期映射资料库目录（Tauri asset
  protocol），M7 换 `s3_key`。渲染层（MdRender/Vditor 预览）不感知介质。
- `source_files` 是资产单一登记处，M7 按 content_hash 回填 s3_key。

### 4.3 同步：快照仓库模型（DejaVu 缩小版，D1/D5）

思源调研结论（一手源码，20260904）：

- 同步引擎在独立库 **dejavu**（github.com/siyuan-note/dejavu，AGPL-3.0
  ——**只借模型不抄代码**，我们用 Rust 重写）。git 式快照仓库：SHA-1
  内容寻址分块（`objects/{hash前2位}/`）+ 索引（`indexes/`）+
  `refs/latest` 指针；分块去重、压缩、可选 AES 端到端加密。
- 存储是并列四选一 Provider（`kernel/conf/sync.go`）：官方云端(0)/
  **S3(2)**/WebDAV(3)/**本地文件系统目录(4)**——Local 目录（网盘/
  Syncthing）是第一公民，与 S3 同权；S3 字段：endpoint/accessKey/
  secretKey/bucket/region/**pathStyle**/skipTlsVerify/timeout/
  concurrentReqs。
- Cloud 接口是仓库语义非裸文件 CRUD（`dejavu/cloud/cloud.go`）：
  CreateRepo/GetRepos/GetIndexes/GetIndex/GetRefsFiles/GetChunks/
  UploadObject/DownloadObject/GetStat/ListObjects。增量同步靠并发
  stat 探测缺失分块，不重传全量。
- S3 实现要点（`cloud/s3.go`，aws-sdk-go-v2）：非 AWS 端点挂 SigV4
  签名兼容中间件（代理改 Accept-Encoding 头致签名失配，issue #16199
  ——接 R2/OSS 踩同款时有现成解）；ListObjects 手写 Marker 翻页。
- 编排（`kernel/model/sync.go`）：同步互斥+请求去重合并；自动同步连续
  失败 7 次退避 64 分钟；云端锁文件防两设备并发写；冲突可生成冲突副本；
  实时「感知」仅官方云端有，S3/Local 皆轮询。

我们的落地（缩小版，砍掉 tag/lan 同步/感知）：

- Rust `trait ObjectStore { put/get/stat/list/remove }`；LocalFsStore
  先行，S3Store M7 后补（endpoint 配置化，R2/OSS/COS/MinIO 同协议）。
- 同步单元 =「快照导出/导入」（D5）：SQLite dump + source_files 清单 +
  资产打包成单一 `.wengu` 快照文件，带内容哈希与 created 引用——
  M1 起就有（作答数据 M1 就产生，双机流转是刚需不是「后续」）；
  M7 只是把「手动搬文件」换成 ObjectStore 自动上传下载 + 云端锁文件 +
  refs/latest 指针，**打包格式不变，平滑升级零废弃**。
- 冲突策略：不自动合并——云端 latest 与本地 diverge 时双快照并存，
  导入向导让用户选（不丢数据）；思源 GenerateConflictDoc 同哲学。
- **绝不裸同步 SQLite 活库文件**（WAL 并发写损坏）。

## 五、编辑器与双链

### 5.1 Vditor-only（D2）

Lute 调研结论（github.com/88250/lute，20260904）：Vditor 4.0 的
IR/WYSIWYG/SV 三模式全由 Lute 驱动（lute 仓库根目录 `vditor_ir.go`
等三入口；Lute 以 dist 资产随 Vditor 分发，无 npm 依赖）。Lute 原生
解析 `((id "标题"))`，公式在 IR 有完整 marker+预览双层渲染。
**但 `render/vditor_ir_renderer.go` 无 NodeBlockRef case**——块引用在
编辑器里不会是交互 span。由此定形态：

- **编辑态（IR）**：`((id "标题"))` 显示为源码文本。IR 本就是「源码
  标记+即时渲染」混排（公式有 `$` marker、链接有 `[]()` marker），
  引用显源码形态风格一致。插入器把引用当纯文本 `insertValue`，
  零自定义语法开发。
- **预览态**：知识文档预览走 Vditor preview 管线，`afterRender` 钩子
  做与 `MdRender.postProcess` 同款后处理——块引用文本替换为
  `wengu-blockref` span，点击跳转复用现有委托思路。
- **题卡永远 MdRender**：kramdown 契约（超级块容器+part 子块）只读
  渲染，绝不让 Lute 的 WYSIWYG 碰它——边界在 store 层硬隔离。
- **Vditor `cdn` 选项必须指向打包内资产**（默认拉 CDN，Tauri 离线环境
  漏配即白屏编辑器——集成头号坑）。

### 5.2 块 id 选型：内容哈希锚（D4）

- 文档 id：md frontmatter `id: {14位时间戳}-{7位字母数字}`（新建生成；
  迁移时保思源 docId——见「六」）。
- 标题锚：hash(归一化标题链) 确定性编码为冻结形态（SHA-256 派生 14
  数字+7 `[a-z0-9]`）；段落锚：hash(标题链+段落归一化文本) 同形态。
- 性质：零持久化（内容变即锚变）、确定性、跨设备同内容同锚；被引段落
  编辑后引用悬空，显示「未找到原文」——思源对已删块同款行为，可容忍。
- 备选存档（不采用）：行内属性 `{: id="…"}` 会被 Vditor 编辑循环洗掉；
  侧车 range 表在插入/合并段落下漂移。若 D4 翻案，M0 spike S3 重做。

### 5.3 双链三件套（落 M5a，M0 建 refs 表）

1. **引用插入器**：Vditor toolbar 自定义命令 → 文档/块选择器（知识树+
   know_docs 标题树）→ 插 `((id "标题"))` 进 md。
2. **点击跳转**：解析 id → 开目标文档滚锚（标题链锚）；知识树节点
   降级跳源章节（现有先例 index.ts:329-343）。
3. **反链面板**：refs 表在文档保存时扫 md 重建该文档的反向行；面板挂
   当前文档显示「谁引用了我」+「哪些题挂了这个知识节点」（kpRefs
   反向，BankRegen 扫描逻辑复用）。

## 六、存量迁移与 id 连续性（M6，设计现在冻结）

迁移不止格式转换，核心是 **id 与指纹的连续性**：

- **导出**：迁移脚本走思源内核 API——对题库 records.sourceDocId 涉及
  的源文档与 KnowRoots 知识文档导出 md，**frontmatter 写入原 docId**，
  assets 拷入资料库目录。
- **题库存量 id 一字不动**：sourceDocId/rootId/srcId 靠 frontmatter
  保 docId 存活；KnowTrees 键=源章节文档 id 同理。
- **块级 id 换算**：kpRefs 与活专题 `col-kp-{块id}` 指向知识文档小节
  块 id，导出成 md 后块 id 丢失——导出时按 SQL 枚举每文档 heading 块
  建标题链，算新标题锚 id，写 `legacy_id_map`（旧块 id → 新锚 id），
  kpRefs/活专题键经映射换算。
- **指纹断层**：srcHash 按思源 kramdown 文本算，md 形态不同（IAL 消失）
  → 首次重新导入全量标「变更」，经 IncrementDialog 摘要过目后归位——
  一次性接受，不建 hash 映射。
- 版本闩、数据演进守则整体随迁。

## 七、冻结不变量（原样带走，一字不改）

questionHash 及归一化；WordBook.wordKey 归一化；题块 kramdown 契约
（容器超级块+part 子块）；SrcChunk.srcKey 键格式与切块确定性；
KnowledgeNorm.knKey；**BLOCK_REF 正则与 `{14位时间戳}-{7位字母数字}`
id 形态**；agentChatOnce/agentChatContinued 对外签名。SQLite 迁移时
这些算法所在模块纯逻辑直搬只换介质。

## 八、里程碑

每期独立可交付；M1+M2 即核心闭环。规模估计 8–12 周（含 M7）。

- **M0 脚手架+四 spike（1–2 周）**：Tauri+vite+Svelte5 工程；纯逻辑
  迁入过编译；host/ shim（页签壳 MVP=单窗口多页签+左侧树、HostDialog、
  Toast、b3-lite 最小集）；store/（questions/know_docs/refs/
  source_files 四表+user_version 闩）；editor/（Vditor 本地 cdn 封装）。
  **Spike 验收（全部通过才进 M1）**：
    - S1 Vditor IR 离线可编辑（cdn 本地化，无白屏）；
    - S2 `((id "标题"))` 在 IR 编辑往返完整（getValue 不丢不改写——
      Lute 无 blockref case，round-trip 是真风险）+ 预览 afterRender
      后处理替换稳定；
    - S3 内容哈希锚 → 冻结形态 id → BLOCK_REF 渲染 → 点击跳转全链路；
    - S4 b3-lite 最小集渲染一道占位题。
      S2 不过的退路：SV 模式或预览换 MdRender（5.1 被推翻的分离方案作为
      Plan B 存档）。
- **M1 题库+刷题主流程（1–2 周）**：questions/sets/collections 装载；
  BankParse 复用；QuizView 全流程；KaTeX 直连替换 mathRender
  （ProtyleHost 收敛为 host/KaTeX）；BankRecording→事务。**交付判据**：
  导入题库→开刷→答题→对错→**刷完即关不丢轮次**→快照导出/导入最小版
  可用。顺手清 20260903 审查挂账的 3 条 P1（材料组 group 读侧/slots
  聚合/存量材料迁移，都在将改造的 bank 读侧）。
- **M2 转换+AI 通道（1–2 周）**：直连供应商（Rust 转发藏 key、SSE
  透传、**超时按 SSE 空闲计的口径复刻**）；模型配置 UI（供应商+key+
  模型清单，含失效回落默认）；摄取 md 文件夹/PDF/Word→SrcChunk；
  行协议 @@Q/@@P/@@END 不变，SetWriter 直写 SQLite；增量指纹比对走
  SQLite。PromptHygiene 图片占位保留（直连下仍控成本+供应商 image
  参数差异同款坑）。
- **M3 单词域（1 周）**：words/wordbooks 表；四步梯；听音选义=
  speechSynthesis 零音频资产；WordPhonetics ECDICT 复用；WordView
  Svelte 复用。
- **M4 复习+统计+错题（1 周）**：review 复用题卡；stats 从题库聚合
  （无查询层替换工作，勘察修正）；weakness。
- **M5a 知识文档+双链（1–1.5 周）**：Vditor 编辑 know_docs；插入器/
  跳转/反链面板三件套；KnowTrees 直存；know_hash/route_cache→SQLite；
  KnowLinkText/Match/Tag 走 M2 client。
- **M5b 专题+AI 会话+看板娘（1 周）**：CollectionPanel/KnowledgePanel
  Svelte 复用；ai_sessions+SessionPanel（SessionTree 复用）；companion
  规则复用+ChatStore→SQLite。
- **M6 收尾分发（1 周）**：设置/i18n/主题；迁移脚本（「六」）；macOS/
  Windows 打包；删 SiYuan 残留；契约/AGENTS/CHANGELOG 文档更新。
- **M7 S3+同步（1–2 周）**：S3Store（字段照抄 4.3，SigV4 头忽略中间件
  参考 dejavu）；快照上传下载+refs/latest+云端锁文件；冲突双存+导入
  向导；Local 目录 provider（目录不得与库目录互相包含）。

## 九、风险与对策

| 风险                                 | 对策                                                         |
| ------------------------------------ | ------------------------------------------------------------ |
| Lute 块引用往返未知（S2）            | M0 前置 spike；不过则 SV 模式/预览换 MdRender（Plan B 存档） |
| Vditor 资产本地化                    | cdn 指向打包内 dist；S1 验收白屏检查                         |
| 双机同步是刚需非后续                 | D5 快照导出/导入 M1 即有；M7 仅介质自动化                    |
| 存量 id/指纹断层                     | 「六」legacy_id_map+frontmatter 保 docId；指纹断层一次性过目 |
| b3-lite 工作量                       | M0 最小集+随期补齐；机械但不可跳过                           |
| AI 直连供应商差异                    | Rust 统一适配层；PromptHygiene 保留；超时口径复刻            |
| 双机 Rust 工具链                     | 两台机器各装（机器 B 外置卷跑 cargo 注意路径）               |
| 平迁期间插件主线不能坏（备考使用中） | 「十」基线+cherry-pick 纪律                                  |

## 十、插件主线与双线维护

- 插件继续可用可发版；Tauri 从**干净基线 commit** fork 独立仓库
  （开工前先提交当前工作区未提交改动，含 PromptHygiene）。
- 平迁期间插件侧**只修 bug 不加 feature**，修复 cherry-pick 过去；
  冻结不变量清单（「七」）是双线对齐的锚。
- Tauri 侧不回灌插件；若彻底切换，插件仓库转维护态。

## 附、调研来源（20260904，均为一手源码）

- 思源内核 github.com/siyuan-note/siyuan：`kernel/conf/sync.go`（Provider
  常量 0/2/3/4 与 S3/WebDAV/Local 字段）、`kernel/model/sync.go`（编排：
  互斥/去重/退避/云端锁/冲突副本）。
- github.com/siyuan-note/dejavu（AGPL-3.0，只借模型不抄代码）：README
  （SHA-1 内容寻址、Index/File/Chunk/Ref 实体、objects/indexes/refs
  布局、AES e2ee）、`cloud/cloud.go`（Cloud 接口）、`cloud/s3.go`
  （aws-sdk-go-v2、SigV4 兼容中间件 issue #16199、并发 HeadObject、
  Marker 翻页）。
- github.com/88250/lute：根目录 `vditor_ir.go`/`vditor_wysiwyg.go`/
  `vditor_sv.go`（三模式入口）、`render/vditor_ir_renderer.go`（无
  NodeBlockRef case——5.1 形态决策的依据）。
- Vanessa219/vditor@4.0.0：package.json 无 lute npm 依赖（Lute 以 dist
  资产分发）、cdn 选项本地化要求。
