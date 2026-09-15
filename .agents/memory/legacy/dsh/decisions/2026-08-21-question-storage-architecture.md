# question-storage-architecture

# 题目存储架构决策(2026-08-21 回顾会话沉淀)

温故插件**不建独立题库**,题目 = 思源「容器块 + 自定义属性」。

理由:

- 思源自定义属性存于内核 `attributes` 表,属性视图可直接出统计,无需外部存储;
- 块引用/闪卡 riff 都基于块,天然支持题目↔讲义联动与错题闪卡。

架构要点:

- 一道题 = 一个容器块(建议引述块或超级块),题干/选项/解析均为其子块;
- 转换完成标记:`custom-plugin-wengu-q = 1`,插件据此切到刷题模式;
- 运行时状态属性(`attempts` / `last-answer` / `right`)也写在容器块上;
- 检测/查询:/api/query/sql 按 `a.name LIKE 'custom-plugin-wengu-%'` 聚合 attributes 表(参考插件 sy-lively 同款写法);
- 单块读写:/api/attr/getBlockAttrs、/api/attr/setBlockAttrs。

代码位置:`src/wengu/QuestionService.ts`(listQuestions / getBlockAttrs / setBlockAttrs / recordAttempt)。
