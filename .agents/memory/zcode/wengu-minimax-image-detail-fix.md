---
name: wengu-minimax-image-detail-fix
description: MiniMax 2013 图片附件坑修复——PromptHygiene 占位符往返消毒；已部署两区+探针双验证、已提交推送(2db456a)待用户真机重转验收
metadata:
  node_type: memory
  type: project
  originSessionId: sess_1d73f1f8-874d-4f59-85d6-bf31afe27cba
---

20260903 会话：用户转换《概率篇-选择-题解》带图批次全灭（「网络异常，请稍后再试: invalid params, invalid image detail: auto (2013)」）。根因=内核 agent chat 用 Lute 抠 user 消息里的 `![](assets/…)` 成 base64 附件、`detail:"auto"` 发供应商（kernel/agent/attachments.go，单请求≤4张/20MB），MiniMax 的 image_url.detail 只认 low/default/high（2013=invalid params）；内核 isImageInputUnsupportedError 白名单不匹配此措辞不会降级重试。

**修复**（已部署 工作+测试 两区、测试区内核探针双验证 raw=2013 复现/占位符=正常出字、**已提交推送**：并行会话 723c9ef→rebase 后 2db456a）：`src/ai/PromptHygiene.ts` sanitize/restore 占位符往返（`〔插图:路径〕`），接入 ai/client 两条公开通道（含 agentChatContinued 历史回放）+ QuestionDraft.cleanPartText 兜底还原；prompt 规则 5/6 与 RegenDialog 改「占位还原成图片行」措辞（示例必须用 `![](插图原路径)` 这类非 assets 前缀，否则被自消毒命中）。落盘 kramdown 逐字同构、指纹零影响。另加转换条终态错误一键复制钮（iconCopy→iconCheck 1.2s）。

**Why:** 往 agent chat 发文档 kramdown 的新通道必须过 PromptHygiene 消毒，否则带图文档在 MiniMax 上必挂（其他供应商 schema 严格时同理）。
**How to apply:** 新 AI 入口一律走 agentChatOnce（已总闸消毒）；prompt 里教模型还原图片行时示例路径勿以 assets/ 开头。细节已记 AGENTS.md 内核坑与 CHANGELOG。关联 [[wengu-audit-20260903]]。
