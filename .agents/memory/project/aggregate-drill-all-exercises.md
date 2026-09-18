---
name: aggregate-drill-all-exercises
description: 「全部习题」聚合合刷+题集分组可视化（86dbf33 已装机待真机验证）——虚拟专题 id "all" 不落
    collections；顺序=题集插入序×集内 qids 序零重排；题号栏 hover 标题用原生 title（滚动容器裁切行内浮层）；顺修专题模式
    hasDoc 回归
metadata:
    node_type: memory
    type: project
    originSessionId: sess_c9526378-fcca-4528-9ad8-1c5e7d6123d2
---

20260903 应用户需求落地「全部习题」聚合合刷（提交 86dbf33，已部署装机+petal 重载，**待用户重开温故页签真机验证**）。用户定调：市面三类题源（按章节的册子/成套卷/单章节文档）**顺序绝对不能乱**（已录 [[product-decisions]] 第 9 条）。

**Why:** repo 的 CHANGELOG/AGENTS 记了 what；这里记决策链与验证状态，防止后续会话误动顺序口径或重造聚合入口。

**How to apply:**

- **顺序口径（冻结）**：聚合顺序 = 题集插入序（BankData.sets 的 JS 对象键序；新转换=完成先后，跨重载稳定）× 集内 qids 序；开刷范围裁剪全是保序 filter，全仓无洗牌路径。任何聚合/分组改动不得重排这两层。
- **"all" 是保留字虚拟专题**：BankSets.AGGREGATE_ID，**不落 data.collections**（专题管理面板/清单天然不可见不可删），仅 CollectionFlow/侧栏树流程层认它；轮次按 `col:all` 独立归档（继续上次可用）；restore 恒有效不走 rows 校验。mintSetId 恒 `set-` 前缀无冲突。
- **分组数据源=记录 rootId**：setQuestions 与 questionsOf（手动跨题集专题）解析时都归位 parsed.rootId=sourceDocId；buildSetGroups 取**连续段**——同集再现=新段（不合并），分组只切视图。
- **题号栏 hover 标题走原生 title**：`.wengu-nums` 有 `overflow-y:auto`，行内浮出标签会被 x 向裁切（CSS overflow 组合限制，浮 chip 逃不出滚动容器）——用户若嫌原生提示弱，需换栏外 popover 方案而非行内标签。
- **顺修的旧回归**：专题模式 hasDoc 自 76496f7（20260826 预览改版）起误判 → 空「题库为空」态+不挂开刷面板+卡全锁；现为 `colMode || !!doc`。
- **装机构成注意**：86dbf33 的部署产物从工作区构建，**包含另一批未提交改动**（convert 一题一答/预览搜词等，见 [[parallel-session-worktree-build]]）——真机验证时看到那批行为属正常。
