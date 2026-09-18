---
name: storage-arch-ial-vs-bank
description: 存储架构两级演进定调——20260831 运行时数据自托管进题库；20260903 彻底 pivot：题目内容唯一真相=题库、转换零落盘、题集=库内实体（DriftWatch/文档管线全退役，单用户零迁移）；引擎选型否决记录；三连修复已随 86dbf33 构建装机
metadata:
    node_type: memory
    type: project
    originSessionId: sess_1ceae321-81e1-49d2-829e-d74d44e655cd
---

存储架构两级演进，均当日实施完毕装机：

**第一级（20260831）运行时数据自托管**：作答统计（attempts/wrongCount/
lastAnswer/right/slot-\*/step-\*/totalTime）停写块属性，唯一真相=题库
stats/docStats（记账在 data/BankRecording.ts）。

**第二级（20260903）内容收库 pivot**（用户拍板「不应该有新文档」）：

- 题目内容唯一真相=题库 `BankRecord.kramdown`（契约 kramdown 格式
  逐字不变，只是不再落用户文档）；转换经 convert/service/SetWriter
  直写（renderUnit→parseQuestionKramdown 反解+questionHash，与旧
  「落文档再回读入库」产物同构），**文档树零新增**。
- 题集=库内实体 `BankData.sets`（BankSets.ts 函数式友元）：新转换
  setId=`set-*`；存量按 records.sourceDocId 分组推导（ensureSets，
  标题尽力从仍在的旧文档读一次）——**零迁移机制**（用户明示「就我在
  用，不用考虑迁移」），历史轮次/docStats/影子专题键天然延续。
- 材料 bank.materials+record.group（group="prev" 占位与文档序回写退役）；
  增量指纹 srcKey/srcHash 迁入记录字段（键格式/算法冻结不变）；
  「重新导入」按 set.srcId 门控；新题 qid=gen-\*（无源块可跳）。
- **退役**：DriftWatch/OrphanCleaner/source-doc 配对/QuestionService+
  QuestionBatch+MaterialService 文档管线/ProgressivePreview 轮询/
  BankMigrate 回扫/源块尽力同步/转换「生成位置」设置段。源讲义删除
  **不再级联删题集**。
- 坑：旧材料组题集（材料只在旧文档里）材料缺失，需重转换补。
- **知识树同日收口**（用户问「为啥还有个知识树文档」→归纳产物就是
  数据）：bank.knowTrees（键=源章节文档 id）；节点 id **铸内核块 id
  形态**——parseKpRefs/BLOCK_REF 正则冻结不动是往返兼容的硬约束；
  重新归纳同路径复用旧 id（引用不悬空）；expandKnowDocs/
  buildKnowledgeIndex/lexiconOfRoots 传 trees 并流；kpRootMap 并
  internalRootMap；跳转降级开源文档；srcHash 比对出 stale 徽标。

**引擎选型否决记录（别再论证）**：IndexedDB 不随工作区走思源同步（双机
流转硬约束，毙）；SQLite native 沙箱装不了、sql.js WASM 持久化=整库
export 同 JSON 整写（毙）；CSV 整文件写通道下无优势（毙）；saveData
JSON+内存缓存+防抖是正确形态。

**Why:** 存储层最大架构变更的定调与实施记录；repo 文档记了 what，
这里记决策链与否决理由。

**How to apply:** 用户再提存储/转换产物/漂移/迁移时从「题库即唯一
真相、零落盘」出发；别再设计任何「习题文档」通道。时间序列若要上，
扩 BankStats 加 attempts log 数组即可。关联 [[product-decisions]]
[[hash-incremental-convert-proposal]] [[convert-return-protocol-plan]]
[[parallel-session-worktree-build]] [[ai-concurrency-write-audit]]。
