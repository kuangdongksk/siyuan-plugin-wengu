---
name: wengu-companion-ai-density
description: 团子 AI 反应做题侧自适应节流已实现并部署机器A待验收——每题候选触发、慢节奏(≥60s/题)每题发、快节奏150s、批次必触发；未提交
metadata:
    node_type: memory
    type: project
    originSessionId: sess_fd4a5e1c-097c-46b9-a8d1-015eb0e4dd19
---

接 2026-08-27 的「逐题没喂大模型」疑问：用户 08-28 定稿密度并已实施——
做题事件不再只认里程碑（连错3/连对5 的精确匹配坑随之消解：每道 quiz-answer
都是 AI 候选触发点），间隔随答题节奏自适应（用户口径：稀疏=每题触发、
频繁=两三分钟一次）：

- 节奏估计：最近 5 次答题时间戳（PACE_WINDOW）平均相邻间隔；平均
  ≥60s/题（QUIZ_SLOW_PACE_MS）判慢节奏→间隔 0 每题触发；否则 150s
  （QUIZ_FAST_GAP_MS）。样本不足（前两题）按快节奏保守。
- 批次事件（quiz-round-done/word-done）**不设间隔**仅 enrichBusy 互斥
  ——「每批必点评」是用户明确预期；word-grade 单词条仍永不触发 AI。
- 丢策略保留：间隔内不排队不补发，到点后下一题自然触发；AI 成功覆盖
  规则台词、失败静默保底（台词仍无法区分来源层）。

落点：src/companion/rules/Enrich.ts 纯函数 + 3 例单测；CompanionCtl
.maybeEnrich 改用、eventDesc 泛化普通单题（带用时+连对/连错计数）；
CHANGELOG 已加条目。休息后回来窗口均值被拉高会自动落慢节奏档（符合稀疏语义）。

**状态：已构建部署机器 A（md5 校验、petal 重载、119 测试全绿），未提交**
——工作副本上叠着 [[wengu-word-flow-redesign]] 的 {name} 模板化 7 文件，
等用户真机验收后一起落提交。

**How to apply:** 用户若反馈「太吵/太稀」，只调 Enrich.ts 三个常量即可
（分界/快档间隔/窗口），决策结构勿动；word-grade 是否纳入仍悬而未决，
动前先问。

**20260828 更新：已随 e254118 提交推送（连同 {name} 模板化/ChatStore/
小书童物化整批），「未提交」状态作废。** 全局悬浮层架构收尾同批落地
（onload 挂 body/onunload 卸/quiz 旧 API 清退/WordApp 内嵌摘除）。
