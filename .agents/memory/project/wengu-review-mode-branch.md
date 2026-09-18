---
name: wengu-review-mode-branch
description: 错题复习模式分支——D1~D6 全落地并已并入 dev（2026-08-25 全合流）
metadata:
    node_type: memory
    type: project
    originSessionId: sess_2e656ce9-8e3c-41c2-815f-019e9ba56078
---

wengu/review-mode 分支：错题本（复习模式）+ 统计增强，设计文档
docs/review-mode.md（D1~D6 全部拍板）。**已完整落地并并入 dev
（9d2ca69），worktree/分支已清理**。实现要点存档：

- 入口统一为 QuizView.enterReviewMode({docId?, qid?})——头部切换器/
  侧栏右键/统计面板三路共用；数据在 ReviewFlow 模块级缓存（TTL 60s）。
- QuizView 常年贴 500 行红线：ConvertViewAccess 段拆去 ConvertAccess.ts
  （宿主接口成员名与视图 *Of 访问器同名做结构匹配），新改动须先想好
  挪哪段。
- 错因分布用横向 CSS 条（stats.scss wengu-stats-cause-*），未按设计稿
  复用纵向 wengu-bars——视觉原因，契约已按实际记。
- 掌握口径 D4=最近一次对即掌握；「连续 2 次对」从严版仍挂账。

**头部切换器待删（2026-08-26 用户拍板，未实施）**：温故页签头部
「做题 | 复习」切换器（wengu-mode-seg/wengu-mode-btn，样式在
src/scss/review.scss，markup 在 CardHtml.ts renderHeadHtml）用户反馈
「样式不太对」，但结论不是修样式而是**整个删除**（「头部切换器将被
删除，不用看了」）——删除后复习模式入口只剩侧栏文档右键。动手时须
连带清理：ViewBindings 的 [data-mode-seg] 绑定、review.scss 的 seg
样式、i18n modeQuiz/modeReview 若无他处引用。
相关：[[feedback-data-source-simplicity]]、[[wengu-neo-theme-traps]]
（错题本两栏布局 Neo 下待用户验收）。
