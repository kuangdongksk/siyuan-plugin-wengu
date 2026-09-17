---
name: wengu-full-audit-20260828
description: 三轮全仓审查五波全修（A~E 20260829「直接全部修复」）已部署机器A；③波挂账13清11遗留3条；窄屏守卫+部署竞态教训
metadata:
    node_type: memory
    type: project
    originSessionId: sess_171906d3-4d72-4e64-8f7a-9083d0719183
---

2026-08-28 全仓代码审查（4 并行代理+机械扫描，每条 P1 亲自核码）后两波修复，
`72b6e8f`（9 个 P1）+ `60aee73`（10 个 P2）已提交部署机器 A，推送遇 GitHub 断连由后台循环补推。

**已修要点**：strip+inject 幂等（重跑匹配不再叠悬空 solution IAL，含自愈+2 单测）；
OrphanCleaner/repointSourcePairs 改 rowsAll（>64 配对不再误删活文档）；WordView
learned.add 迁移丢码补回（复习五题型轮换复活）；TimerController.consume 并入
baseSec（会话用时不再塌缩 1~15s 锯齿，+3 单测）；wengu-pv 类重渲染先摘（退出预览
不再锁死 steps 选项）；agentPanel marker 改「你是刷题」；知识树 doc 节点渲染
node.children；设置弹窗学伴开关接 syncEnabled；ConvertBatch flushPrefix promise
链互斥；WordAi key 冻结跨书竞态；学伴 runChat 发起捕获归属；WordStore.save
串行链；6 处裸 agentChat 补 enqueueAi；markFamiliar 先 roll；backfill+ladder；
查词标熟逐出 freshWin；slots 部分恢复解锁；steps/slots 整题 bankMirror。

**Why:** 多处是「不变量只在默认状态成立」「迁移丢一行」类静默退化，构建链全绿
（零测试覆盖），只有逐调用路径推演能发现。

**How to apply:** 验收：重跑同一题匹配两次→题库 kramdown 逐字节稳定；复习轨出
题型轮换卡；预览退出后 steps 题可作答；并发转换（parallel≥2）渐进文档题序正确。

**第二轮审查（同日）已全部修复 1197b11：quiz 恢复编排5（endedAt/scopeIds快照/realtime绕开/renderList统一恢复/cloze三修——后两修还带出正常流程雷：optRow锁不清第二空起点不动、全答完越界）+convert链3（rowsMapAll抛错+alive空拒删/signal三阶段/弹窗X拦接）+P2六项（终态条terminal/PdfImportRow复位/extractZip目录层/空文档提示/HistoryStore不吞错+inflight/brief降级/重刷override强制fresh）。原发现清单（留档）**：quiz 恢复编排 5 个
P1——wrong/wrongAll 轮收卷后永远显示「继续上次」（unfinished 不查 endedAt，
StartPanel.ts:154）；继续范围轮 scopeFilter 用该轮自身重算（范围自引用漂移）；
AI 实时 steps 轮「继续」失效且重复会话条目（startRealtime 清空先于 restore，
StepsFlow.ts:39-47 vs index.ts:447）；中途全量重渲染不恢复已答卡（收起目录/
设置变更/切工作区后可重复提交，restoreAnsweredCards 只挂 2 处）；cloze 部分
恢复不写 data-locked/不重渲（当前空错位+已答空可重复提交）。P2：材料组重渲染
强推 activeQIdx 到末组；HistoryStore 读异常清空整份历史+并发首载丢更新；after
模式 brief AI 失败静默不记账；复习「重刷本文档」被换成「继续上次」。convert 链
3 个 P1——OrphanCleaner 存活查询吞错归空/闭笔记本不进索引→全量误删（rowsAll
沿用 rows 吞错语义，需 alive 空且 pairs 非空整体拒删）；MinerU 终止按钮三阶段
全无效（pollResult/putToOss/落盘循环无 signal 检查点）；导入中弹窗 X 可销毁
对话框变后台孤儿锁按钮 20 分钟。P2：终态状态条带死「终止」钮且 replay 复活、
PdfImportRow 文件输入不复位、extractZip images/ 字面前缀与 full.md basename
兜底矛盾、PDF 导入与在途转换可并行违串行纪律、空文档静默返回。另：quiz/index.ts
与 WordView.ts 已压线 500 行，下次改动前先拆。相关 [[wengu-wordbook-multi-model]]
**挂账（③波未修，CHANGELOG 有清单）**：NumRail 可见序数错位、steps 逐题秒数恒
0、统计 tab 无代际护栏、replaceDocInPlace 先删后建、MatchDialog 取消不中止在途、
SSE 尾帧/复位、signal 已 abort 不设防、kernelRemoveFile 吞错、首页 derived 切书
不刷、到期「今天稍后」算进明天、书尾在学窗口搁浅、专题边界计时错账、aiAnalyze
完成踢回首页。相关 [[wengu-wordbook-multi-model]] [[wengu-companion-ai-density]]

**第三轮全仓审查（20260829，4 并行代理+逐 P1 亲核）→「直接全部修复」五波
全清，均已部署机器 A**：A fe5bfde（quiz 静态渲染管线：材料组漏绑作答/胶囊
0/0/decoratePreview stale/分片窗口就地 restore/收卷锁）+ B f50b438（三存储
吞错上抛+HistoryStore 串行链+MaterialService rowsAll+client 鉴权/abort 设防/
SSE 掐流+死代码清扫）+ C 0dfd7d1（convert 续跑 5 洞：done 清进度/resume 文档
前置接管/落盘失败=failed 收口/refreshDocFor 增量入库+prune/备份式原位替换；
互斥门/MinerU 重试/WeakDrill 锁/64 位指纹/ws-main 对账）+ D 8056ffc（redoHard
复位三件/标熟双记 familiarized/导入索引化/detailQ 代际/wrongTotal；挂账清偿
steps 秒数/序数错位/专题计时/统计护栏/首页 derived/到期口径/aiAnalyze）+
E 647673f（quiz/index 489、WordView 417 拆线；MessageChannel yield/观察器按
根分份/dozeTimer 清理/KP 定时器/QB flush 重排/extractBlockId 消毒）。挂账
③波 13 条已清 11 条。**未修遗留**：书尾在学窗口搁浅（原始发现细节缺失定位
不到）、decoratePreview 全卷同步 Lute（预览大卷仍一次冻结）、rows/rowsAll
吞错双口径未统一、MaterialFlow 模块级 Map 滞留、KnowledgePanel 面板样式类
（对方会话 P3）。**补记（同日下午）**：用户报设置弹窗「内容超出」——内核 base.css 窄屏断点 @media(max-width:750px) 把 .config__item>.b3-text-field 等拉成整行（0,2,0 盖 fn__size200），复合选择器 .b3-label.wengu-formrow>.fn__size200 0,3,0 压回（1bb4ce1），6806 网页版 700px 视口复现+验证。**部署竞态**：并行会话 12:46 又覆盖部署（worktree 构建缺我 scss 提交），已从共享树重建部署盖回——每次部署后要 md5 复核，对方的构建可能不含我最新提交。**验收要点**：题库模式材料组题可作答；纯选择题长卷胶囊
计数正常；预览中收起侧栏无重复按钮；转换完成后面板不再显示「未完成」；
中断后续跑追加题进题库；树里删习题文档后题库/专题自动清；steps 题逐题秒
数>0；长卡中段作答题号不错位。另一会话同期在修（model id 校正 33c84fe、
Protyle 选项锁、思路描边），工作区尚有他们的 client.ts/question-block-
contract.md 未提交，勿动；push 遇 GitHub 断连需循环重试。
