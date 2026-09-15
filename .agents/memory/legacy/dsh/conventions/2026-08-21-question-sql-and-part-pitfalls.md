# question-sql-and-part-pitfalls

# 温故题目查询/渲染的两个坑(2026-08-21 真实内核实测)

1. `listQuestions` 的 SQL 子查询:
    - ❌ 原版:`AND b.root_id IN (SELECT block_id FROM attributes WHERE name='custom-plugin-wengu-q' AND value='1')` → 实测返回 0 行(root_id 是文档根块 id,子查询返回的是容器块自身 id,二者不相等);
    - ✅ 修正:`AND b.id IN (SELECT block_id FROM attributes WHERE name='custom-plugin-wengu-q' AND value='1')` → 实测返回 1 行。

2. `hydrate()` 收集选项:
    - ❌ `partMd.get("option")` 精确匹配;真实数据 part 值为 `option-0`,匹配不到 → 选项不渲染;
    - ✅ 按 `option-` 前缀匹配收集(兼容 `option` 与 `option-N`),保持子块顺序;同时兼容"一个子块含多个选项"(如 `- A. ...\n- B. ...`)与"一选项一子块"两种形态。

真实验证环境:本机 127.0.0.1:6806 思源内核,accessAuthCode 为空可直连;测试容器块 20260821165017-n87hc7h(fill 题)。
