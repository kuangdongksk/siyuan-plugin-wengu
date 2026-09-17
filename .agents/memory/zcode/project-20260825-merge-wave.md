---
name: project-20260825-merge-wave
description: 2026-08-25 三分支合流+结束本次做题+选项洗牌——已部署待用户验收
metadata:
  node_type: memory
  type: project
  originSessionId: sess_2e656ce9-8e3c-41c2-815f-019e9ba56078
---

2026-08-25 会话成果（dev@1b45ec3，已部署到机器 A 插件目录并重载 petal）：
- math-render / review-mode / topic(专题补全，设计文档 docs/topic-collection-review.md
  四项待定夺按建议拍板) 三分支全部并入 dev，worktree 与分支已清理。
- 新功能「结束本次做题」：头部按钮（做题中、已答≥1）提前收卷，报告只含
  已答；薄弱画像 applied/causeApplied 改 `${会话id}#${结果条数}` 水位增量
  （同轮多次收卷不重不漏，旧纯 id 条目=全量已计）；下次「继续上次」接着做。
- 修复 AI 选择题答案恒 A：根因是 prompt 让模型「先写正确项再补干扰项」；
  修复=extractQuestions 规整链尾部 OptionShuffle 洗牌+答案字母重写
  （single/multiple/steps；「以上都对」类位置敏感措辞跳过；存量文档不追溯，
  重生成即洗）。
- 用户需重开温故页签验收；错题本两栏布局须 Neo 主题下复查（[[wengu-neo-theme-traps]]）。
相关：[[wengu-review-mode-branch]]、[[project-parallel-sessions]]
