---
name: hash-incremental-convert-proposal
description: 增量哈希省 AI 成本方案——一期路由缓存+二期增量重转换均已落地（4345eac/8cb837b）；三期题级 src-hash
    回写可选未做；真机验证待用户跑
metadata:
    node_type: memory
    type: project
    originSessionId: sess_09aada81-907b-454f-9e8b-c21b6faacd7f
---

增量哈希省 AI 成本：方案定稿于仓库 `docs/incremental-hash-plan.md`，两期已落地（均推 origin/dev 并装机机器 B，**思源当时未运行、装机后未做真机验证**——下次跑通：①同题库重跑「匹配」秒完成=一期生效；②新转换一份带标题讲义→改源文档一段→右键「重新导入」出增量弹窗=二期生效）。

**一期（4345eac）路由缓存**：`src/bank/data/RouteCache.ts` routeKnowledgeCached 三弹窗共用；键=`modelId|questionHash(路由输入)`，整表代数=indexGenOf（章 docId+path+小节 id+path 指纹）；空表首见代数即采纳；零命中空结果照缓存、onFail 失败不缓存；saveData("route-cache") LRU 2000、跑完与 bank.flush 同节奏。

**二期（8cb837b）增量重转换**：`SrcChunk.ts`（structuralChunks 结构切块：标题链键 H:章/节、前导段 P0、超 5000 字空行二切子键 #k；withSrcAttrs 容器 IAL 注入 src-key/src-hash；classifyChunks **两阶段**——先全局指纹匹配再键配对，逐块贪心是单测抓出的缺陷：键会先吃掉该被指纹解救的组）。ConvertBatch 已换结构切块（498 行贴红线）+注入；「重新导入」分支=无续跑记录+题集带 src-hash 才走增量（DocOps.runIncrementalReimport），全部相同收口「源未变化」；IncrementDialog 逐块选（默认保留省费）/设置 convertKeepOld 直通；ConvertIncrement 落盘=删旧(KernelBlock.remove 回填)/标 src-stale/串行补生成追加到既有题集末尾（不删旧重建，未变块统计保留；新题排在文档末尾）；中止自愈（追加块自带指纹重跑即「相同」）+refreshDocFor 幂等重扫（失败/中止也扫）。ConvertRun.startExclusiveConvertRun 独占槽复用页内转换条/停止钮。

**三期（20260831 评估后搁置）**：题级 src-hash 回写要 AI 回显来源段（动核心生成 prompt，风险不成比例），且「源没变还重生成」的浪费路径已被二期块级三态分类拦住——定论记计划文档；若未来 AI 产物带来源段标注，加一个属性即可重启。

**收尾（c170721）**：KnowledgeLink 540→420 行回红线内——注入/后处理（strip+inject/applyKnowLinks/sectionKramdown）拆出 `convert/service/KnowRef.ts`，7 处 import 改指，纯搬移。计划全部收口（一期+二期落地、三期搁置），真机验证仍待跑（思源两轮都未运行）。

**20260914 新痛点与拍板（Issue #74 已派，流水线 cnb-t6g-1k2f8sefh）**：用户报「逐段生成（批边界由 AI 决定，不可复现），重新导入按整卷重转」提示仍在且源没改也整卷重烧、断言「不管是不是批导入的都应该有哈希」。事实：20260910 起全部转换（含分片并行批量转）都是逐段自推进——分片只给并行度、片内批边界仍由 AI `@@TO` 定 ⇒ src-key 全是 `A:<偏移>`，`DocOps.ts:144` 见此前缀跳过三态分类（i18n notifyReimportCursor）；记录级 questionHash/srcHash 一直都有，缺的是**可复现分块键**。用户拍板 **方案 A+分段增强**：题集新增 optional `srcContentHash`（整篇源 kramdown 哈希）+ `segs: {s,e,h}[]`（每已落库批的段边界+段哈希，flush 时追加、首尾相接覆盖已转范围）；重导判定顺序=**有续跑记录→照旧续跑 > 源哈希未变→「源未变更」零动作 > 逐段比对从第一失配段起重转（删 srcKey 偏移 ≥ segs[k].s 的记录后 resume 续写）> 存量无段表回退现状**；文末追加（全段命中但整篇哈希不同）只续转尾部。AI 定的边界经段哈希事后可验证=分段确定性问题的绕法。PR 待审。

相关：[[convert-pipeline-pending]]、[[ai-route-two-level-mechanism]]、[[knowledge-tag-three-systems-split]]
