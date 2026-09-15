# grading-policy

# 客观题判分策略(2026-08-21 回顾会话沉淀)

规则(实现于 `src/wengu/QuestionService.ts` 的 `grade()`):

- 归一化:两侧都 `trim().toUpperCase()`,再去掉全部空白后比较;
- `single` / `multiple`:答案字符串直接比较,多选子集不算对;
- `judge`:`√/对` 归一为 √,`X/x/错` 归一为 ×,再比较;
- `fill`:正确答案用 `|` 分隔多个可接受答案,命中任一即对;
- `brief`(简答/计算):无 answer,`grade()` 恒返回 false,走「作答 → 展示解析 → 自评」流程,插件不做自动验算。

配套:`recordAttempt()` 每次作答把 `attempts` 加一、写 `last-answer` 与 `right`(0/1)到容器块。
