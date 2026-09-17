---
name: wengu-word-audit-20260829
description: 单词域全量审查——P1组边界已修(760fcf2)；P2×2已随全仓审查波B/D清偿；剩P3×4挂账
metadata:
    node_type: memory
    type: project
    originSessionId: sess_8a00cdab-55b5-42a0-aa4b-6cc731105b45
---

2026-08-29 单词域全量代码审查（core/flow/service/comp 共 44 逻辑文件）。

**已修（760fcf2，已部署机器A）**：①组边界 `finishCount%groupSize` 裸取模在
fresh 轨每卡误触发 AI 复盘 → `groupBoundaryDue(counted)` 纯函数+回归测试
（GroupFlow.test.ts）；②用户拍板「修复怎么能用空会话」——单词复盘 AI 从
enqueueAi+"" 会话改走 agentChatOnce 独立会话，docs/word-timing.md 决策6已随修订。
**续修（3ae85fd）**：真机确认 words 存量已是 v3（3243词FSRS/1532熟/2在学），
WordMigrate+测试+migrateV2 分支已删；仅认 v3，旧文件空起步+console.warn。
机器B 注意：若 B 本地还有未同步的 v2 副本，先开思源等同步完成再进单词面板。

**Why:** 用户明确否决 "" 空会话方案；单词复盘是一次性无上下文任务，独立会话天然并发且不与判分互堵。

**How to apply:** word 域新 AI 调用一律 agentChatOnce，不再入 enqueueAi；组边界判定只认「本卡计入计数」；进度 schema 只认 v3。

**挂账 P2**：①`wordResumeCard` i18n key zh-CN/en 双缺（LookupScreen 返回卡片按钮 title 显示原始键名）；②WordStore.get() 读失败静默 defaultProgress → 首次 save 会覆写全部进度（应区分「文件不存在」与「读失败」）。

**挂账 P3**：markFamiliar/toggleStar 缺 keyOf 空串防护；renameBook 死代码+只写 manifest 不写书文件（重启回旧名）；wengu-word-detail-first 类无样式；统计「剩余」（毕业口径）与头部「剩」（未占用口径）两套并存；p.simple 已无写入方；finishMastered 不进 groupLog/不 notifyWordGrade；manifest 条目不校验。

**规模结论（用户问「为何有6000行」）**：单词域 11589 行 = 词表数据 6821（59%，非逻辑）+ 逻辑/UI 4324（注释占 13%）+ 测试 484；功能与用户拍板决策一一对应，非虚胖。可退役资产：迁移代码已删（3ae85fd），剩 WordImport 自写 PDF 文字层解析器 291 行——不背单词进度导入若已用完可整体退役，等用户表态。

**续修（980e82a，20260830，已部署测试工作区待验收）**：起点设置面板（StartScreen）在矮 dock 里超高被裁无滚动——`.wengu-word` 是定高 flex 列且 `overflow:hidden`，卡片屏有 `.wengu-word-card` 作滚动容器但 `.wengu-word-form` 是普通块。修法：form 补同款配方 `flex:1; min-height:0; overflow-y:auto`（src/scss/words.scss）。该类只有 StartScreen 用，不影响他屏。

关联：[[wengu-full-audit-20260828]]、[[wengu-word-flow-redesign]]
