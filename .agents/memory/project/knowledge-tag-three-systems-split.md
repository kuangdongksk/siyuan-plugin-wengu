---
name: knowledge-tag-three-systems-split
description: 知识/专题标签问题定诊（20260831）——knowledge 文本/kpRefs 块引用/专题 collection
    三套系统互不归一，AI 裸写 knowledge 无约束致「洛必达≠洛必达法则」裂键，改造三点已列待拍板
metadata:
    node_type: memory
    type: project
    originSessionId: sess_c65b3ee1-08fa-474b-bbba-c07d1b264eee
---

20260831 用户报「知识和专题有很大问题（UI/逻辑闭环/功能）」并问三件事，排查后**全部属实**（代码实证）：

**三套互不相通的"标签"：**

1. **knowledge/chapter 文本属性**——AI 每次转换无条件裸写（prompt `ConvertService.ts:183` 是字面占位 `knowledge="考点"`，无任何取值约束）；BankParse 原样入记录，knowledgeIndex 用 `kn:${r.knowledge}` **精确字符串**当键（`QuestionBank.ts:225-232`）→ 措辞稍变即裂新键（洛必达 vs 洛必达法则）。
2. **kpRefs 块引用**——仅转换时手动填了「知识点根文档」才走两级路由注入（质量最好但可选），或事后「匹配」补；不回写 knowledge 文本 → 出现「有 kpRefs 无 knowledge」「有 knowledge 无 kpRefs」两种半截记录。
3. **专题 collection**——knowledgeIndex 降级链 `kpRefs 优先→knowledge→chapter`，有 kpRefs 的题其 knowledge 永不参与索引 → 同题在不同机制下算到不同知识点头上。

**UI 断点**：题卡角标（`QuizCardApp.svelte:58`）与轮次报告（`RoundReport.ts:64`）只显示 `knowledge || chapter`，从不显示 kpRefs → 「知识文档是书签」未兑现，关联只在知识文档反链面板可见，刷题主界面双向入口都缺。

**三点改造方向（已向用户列出，待拍板，未实施）：**

1. 标签收口：prompt 加「knowledge 必须从词表选/沿用原文措辞」，词表=已登记知识文档小节标题+全库已有 knowledge 值。
2. 双写打通：路由出 kpRefs 时小节标题回写 knowledge 属性（或反向命中自动补 kpRefs）。
3. 主界面可见：题卡/轮次报告把 kpRefs 渲染成可点书签。

关联 [[knowledge-doc-association-status]]（三路关联已齐全的机制现状）。
