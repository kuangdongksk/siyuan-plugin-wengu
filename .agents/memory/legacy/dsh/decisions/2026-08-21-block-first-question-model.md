# block-first-question-model

# 题目块模型:block-first(2026-08-21 重构)

HEAD 40dc7c7 把存储模型从 attribute-first 重构为 block-first(commit message: "wengu: block-first contract, render document questions via Lute in tab")。

新模型:

- 一道题 = 一个超级块(Super Block)容器,容器块打 `custom-plugin-wengu-q=1` 与 type/knowledge/chapter/difficulty 属性;
- 子块按 `part` 标记:stem(题干)、option-*(选项)、mine(我的答案)、answer(正确答案)、solution(解析);
- **answer 不再是容器属性**,判分原料 = answer 子块文本与用户提交文本;
- 渲染:getChildBlocks 取子块 markdown → Lute.Md2BlockDOM,QuizView 渲染整篇文档题目卡片;
- 容器查询写法:`b.id IN (SELECT block_id FROM attributes WHERE name='custom-plugin-wengu-q' AND value='1')`。

注意:`b.root_id IN (SELECT block_id ...)` 是错误写法(root_id 是文档根块 id,子查询返回容器块 id,永远匹配不上),已在真实内核验证返回 0 行。
