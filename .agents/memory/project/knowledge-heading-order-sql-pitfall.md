---
name: knowledge-heading-order-sql-pitfall
description: 知识面板小节树乱序根因——MinerU 导入语料全部块 sort/created 退化，SQL ORDER BY sort
    返回任意序；文档序唯一可靠来源=getBlockKramdown 解析
metadata:
    node_type: memory
    type: project
    originSessionId: sess_becdfd3a-2831-46b6-819c-ecdbe69f215e
---

20260907 诊断「知识的层级问题」定论：知识面板小节树/路由小节清单顺序错乱的根因是
`headingsByRoot`（KnowledgeLink.ts）用 SQL `ORDER BY root_id, sort` 取标题块，而
真实语料（/MinerU 三本讲义 23/23 章节）**所有块的 sort 只有 0/5/10 三种值、created
整秒并列**——SQLite 对并列 sort 返回任意序（时好时坏，随查询计划变）。症状：章序
「五、二、一、四、三」、h4 先于 h3 出现→就近挂靠全挂顶层（李2-矩阵 20 标题 18 个
顶层，应为 5）。同雷四处：KnowledgeLink.headingsByRoot、KnowOutline.docBlocks
（AI 归纳输入+srcHash 指纹）、KnowRef.ts:60、KnowHash.ts:65；BankSets.ts:144 是
存量迁移自写块场景有 created 兜底不致命。getDocOutline 只回两层（h5 丢）不可全靠；
转换主管线取源走 getBlockKramdown 不受影响。**修复方向：文档序以
KernelBlock.kramdown 解析标题行为准（id→位置映射回填 SQL 行）**。

附带发现（同日）：375 条 gen- 题记录 kpRefs 全空→面板题数全 0，属「词表唯一命中
宁漏勿错」的设计内行为（346 个 AI 自由文本考点与全部小节标题零命中），要挂引用
走「匹配/批量关联」AI 路由。另：面板树还有存量遗留《4-常微分方程·知识树》文档
（旧落盘时代产物）混在章节列表里。

**Why:** sort/created 退化是导入器写块方式决定的（不逐块设 sort），无法从数据侧
修；任何新读块顺序的代码都别信 ORDER BY sort。
**How to apply:** 修复已落地（ff19933，20260908 装机推送）：`KernelBlock.docOrder`
（siyuan/block.ts，根块 kramdown IAL id 出现序，按文档 updated 缓存、失败降级
保持 SQL 序）+ `byDocOrder` 回排，四处消费点全接；headless 真机验证=李2-矩阵
18→5、李6-二次型 4→1、张5=6 与 kramdown 真值一致。注意：①缓存键=doc root
updated，思源同步盖文档保留原 updated 时序表可能陈旧（降级=沉底不乱序，可接受）；
②干净 worktree 构建坑：pnpm verify-deps 不认符号链接 node_modules（用 `sh
node_modules/.bin/webpack --mode production` 绕过），webpack 配置还要预拷主仓
dist/kernel.js；③排查期间工作区数据被同步实时改写（李4 标题 43→5，updated
却停在旧日期）——SQL 索引读数与 kramdown 不一致时以 kramdown 为准。见
[[storage-arch-ial-vs-bank]] [[parallel-session-worktree-build]]。
