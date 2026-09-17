---
name: wengu-dialog-deblocking
description: 20260905 七个AI弹窗全部去阻塞(点击即关窗+后台跑+面板停止+单飞闸)已部署测试区；未提交；转换流有意未接面板停止
metadata:
  node_type: memory
  type: project
  originSessionId: sess_e06130bf-8341-4166-bf4b-e57336133eea
---

20260905 用户定夺「修复所有」后，七个 AI 弹窗（重新生成/匹配/批量关联/生成标签/变式重练/薄弱加练/收集补题）统一改「点击即关窗」：参数收齐即 `dialog.destroy()`，AI 后台跑，终态走思源通知。机制件：`ai/flow.ts launchAiFlow`（单飞闸 aiFlowBegin/End——六重型批流互斥，防内核写流并发互吞）；`client.ts` 中止登记簿 stopBySid（`aiAbort()` 句柄 + `AiTrack.onSid` 运行时回调把记录 id 挂回流级 AbortController，finally 注销）；AI 会话面板 running 记录加「停止」钮（`abortAiSession`，未接线流静默无效）。GenCore/GenQuestion 补了 AiAbort 通道，中止保留已产出。**已提交推送（bd03097）**，两区部署、测试区已重载，待用户真机验收。

**注意**：转换/增量流有自己的页内转换条+停止钮，**有意不接**面板停止（点停静默无效是预期）；变式重练完成后仍自动切专题（保留原语义）；CollectionDialog 纯收集支路不变。

**Why:** 弹窗模态在长 AI 期间阻塞整个思源；原先模态还是天然串行闸，后台化后必须自建单飞防并发内核写互吞。

**How to apply:** 新增长 AI 弹窗照抄该口径（收参→destroy→launchAiFlow→run 内终态 notify）；不要再造弹窗内转圈。与 [[wengu-option-packed-repair]] 同批未提交，验收后合并提交。
