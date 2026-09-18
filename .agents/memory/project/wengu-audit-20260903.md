---
name: wengu-audit-20260903
description: 20260903
    审查机器B的「产物全内部化」11提交——3条P1功能断链+P2×6+P3，20260904 已全部修复部署两区并提交推送（2db456a，P3 的 SrcChunk ~n 失配未证实跳过），待用户验收
metadata:
    node_type: memory
    type: project
    originSessionId: sess_464d6abf-8957-4248-9ca1-18469ed7e442
---

20260903 对机器 B 合入的 11 提交（b48839d..16f88d4）做四代理+人工核实审查，
**20260904 已全部修复并部署两区（已提交推送 2db456a，与 MiniMax 2013 修复同批）**：
P1①材料组读侧——setQuestions/questionOf/渐进预览三出口回填 r.group，
BankParse 补解析存量容器 group IAL 兜底，Regen 替换 kramdown 时旧 IAL
组链迁记录字段；P1②slots——slotAcc 逐空聚合 + match 拆字母兜底移植回
BankParse；P1③存量材料——migrateLegacyMaterials 挂 QuizLoader（后台、
幂等、每会话每文档一次，材料 id=旧块 id）；P2×6（SetWriter 冷启动播种
lastMaterialId/5 处 IIFE 护栏/treePathsOf 同名 ~2 消歧/NumRail hidden
卡回退滚 .wengu-gunit/预览搜词离开清零/DrillUnits 材料组连续段化——
顺带修了隐性情序重排与跨段组标题行缺失）；P3 速胜（ai-sessions 版本闩/
discard 空题集/ensureSets 读 hpath/AGENTS 豁免改 574 基线/QuestionBank
492 行）。**未做**：SrcChunk 答案并块 ~n 失配（未能证实缺陷，挂账）。
验收要点：存量英语卷材料组恢复分栏组单元、cloze 逐空可判分、增量重转
组题不断链、预览搜词换卷不残留。
相关：[[wengu-ai-session-unification]]、[[project-parallel-sessions]]、
[[wengu-minimax-image-detail-fix]]
