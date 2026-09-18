---
name: ai-route-two-level-mechanism
description: 知识路由两级漏斗机制全解（routeKnowledgeDiag 单题/routeKnowledgeBatchDiag 批量，章→小节、parseNums 数字提取容错、降级语义）+ 20260909 三弹窗改按批 15 题/批（逐题指纹缓存保留）
metadata:
    node_type: memory
    type: project
    originSessionId: sess_31af8d7c-7c2e-4056-9509-4a13e3f1ec04
---

2026-08-31 用户问「AI 路由怎么路由的，能展示每一次返回结果吗」。机制梳理（`src/convert/service/KnowledgeLink.ts` routeKnowledgeDiag:269）：

- **两级漏斗**：①全部章标题编 `编号|路径` 清单 + 题干 → AI 要 `{"chapters":[编号]}`；②命中章的 h1~h6 小节汇总（字符预算 2200，超出丢弃）→ AI 要 `{"sections":[编号]}`。上限 MAX_HIT_CHAPTERS=4 / MAX_SECTIONS=10；只 1 章时一级跳过。
- **解析容错**：`parseNums`（KnowledgeLink.ts:219）不解析 JSON，用 `/\d+/g` 抓全部数字，保留 1~清单长度区间内去重值——AI 回废话也照收；已知粗糙点：编号≥10 时 `"12"` 会被拆成 1 和 2，但清单编号与提取同规则自洽不炸。
- **降级语义**：任一级抛错（超时/模型失效/网络）→ 该题返回空映射按未命中，不阻断后续；失败经 `onFail` 收集，0 命中时 `classifyMatchFail` 归类（model/timeout/network）在状态栏给一句提示——这是目前唯一可见性。
- **四个调用点**：MatchDialog（匹配，逐题题干+选项截 2000 字）、BatchLinkDialog phase2（文本关联 miss 的 AI 兜底）、TagDialog（生成标签，路由出小节按标题命名）、转换侧 makeKnowAwareAi（路由结果变生成 prompt 的 K 清单+第 12 条标注规则）。
- **每次返回原文现状**：reply/reply2 过 parseNums 后原文丢弃，不落盘不上报。

**Why:** 用户明确想要「每次路由返回可见」；链路是 agentChatOnce → /api/ai/agent/chat SSE → 完整文本，加一个回调即可拿到。

**How to apply:** 已提方案待拍板：给 routeKnowledgeDiag 加 `onReply?: (stage:"chapter"|"section", reply, parsed:number[])` 回调（与 onFail 对称），匹配/批量关联/生成标签三弹窗状态栏下加可折叠「路由明细」逐题列原文→编号→命中小节路径；转换侧优先级低（生成 prompt 已含 K 清单）。**20260831 更新：AI 会话面板已提供事后回看原文，onReply 弹窗内实时明细降为可选，用户再提才做。**相关 [[knowledge-doc-association-status]]。

**20260909 改按批路由（三弹窗省 AI 调用）**——用户问「每次一题是不是有点太浪费了」，确认后把匹配/批量关联/生成标签三弹窗从逐题两级路由改成按批（**15 题/批**，用户拍板：只改三弹窗、不动转换侧）：

- **新增 `routeKnowledgeBatchDiag(chunks[], index, deps, onFail) → KnowSection[][]`**（KnowledgeLink.ts）：一次调用处理多题——①章级批量 prompt 要 `{"chapters":[[..],[..]]}`（第 i 元素=第 i 题）；②命中章小节**并集**共享清单、一次调用要 `{"sections":[[..],[..]]}`。返回逐题小节数组（下标对齐 chunks；零命中=空数组）。`routeKnowledgeDiag`（单题、扁平并集语义）**保留给转换侧**，零回归。
- **`routeKnowledgeBatchCached`**（RouteCache.ts）替代 `routeKnowledgeCached`：逐题查缓存（键仍 `modelId|题指纹`）、未命中按批路由、**逐题写缓存条目**——保留增量哈希一期「未变题重跑零 AI」的粒度；组失败不缓存（onFail 包 groupFailed）。`RouteCache.get/put/flush`/`indexGenOf`/`ROUTE_GEN` 全没动。
- **浪费量化**：一批 50 题首跑从 100 次调用降到 ~8 次（5 批 × 2 级），4500 字小节清单只发一遍；面板记录从「每题 2 条」降到「每批 2 条」。
- **坑：批量小节编号是并集清单下标**，不是各题自己章的编号（两题命中不同章时，题 B 必须引用并集里章 B 的节——测试用「命中不同章」用例验证）。AI 串题风险比逐题高（用户接受该权衡）；源文档批次通常命中 1 章，影响有限。
- 面板 `.wengu-ai-ttext` 逐字渲染 `turn.text`——路由调用把**完整 prompt（含系统指令+整张清单）**存为 user 轮，这是用户看到冗长 prompt 的成因（设计内，面板展示完整轮次）。
- 校验链全绿（496 测试通过）；**20260909 已实现未提交未装机**（AGENTS.md 路由描述已同步）。
