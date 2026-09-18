---
name: wengu-ai-session-unification
description: AI 调用全量收敛 agentChatOnce(278a2a2)；20260905 面板自由追问退役→失败重试(agentChatContinued 重放+retrying 原地翻案)已部署测试区未提交；落盘缺口审计待用户定
metadata:
    node_type: memory
    type: project
    originSessionId: sess_7e260705-3cf8-4587-826c-b20e179b0687
---

2026-08-30 用户拍板「所有 AI 对话走 sessionID」并落地（提交 278a2a2，已部署机器 A 待验收）：

- `src/ai/client.ts` **唯一对外通道 = agentChatOnce**（一次性独立 sessionID，天然并发+可指定模型）；`agentChat` 收为模块私有、`agentChatConcurrent`（/api/ai/chatGPT 直答）删除、`EApi.AiChatGpt` 删除、`src/ai/queue.ts` 整文件退役。
- 顺带修掉暗病：并行转换（parallel>1）原走 chatGPT 直答会**忽略用户选的 modelId**，现在统一走独立会话+指定模型。
- 判分/出题/匹配路由等原 enqueueAi 串行调用点全部改并发；MatchDialog 匹配仍逐题 await（循环本身串行）。

**Why:** 内核并发锁按 sessionID 键控，独立会话天然并发；共享 "" 会话需要全局串行队列，跨域互相阻塞。

**How to apply:** 新增 AI 调用一律 `agentChatOnce(msg, modelId, AI_TIMEOUT.x, signal?)`，不要再造队列/换端点；旧记忆与文档里「判分一律过 enqueueAi 队列」「插件并发只有 chatGPT 直答」的说法已作废。同日先落盘了并行会话的匹配0命中失败诊断（a1c8e59）。相关：[[wengu-quiz-ui-fixes-20260829]]（resolveModelId 总闸仍在 agentChat 内）。

2026-09-05 用户拍板「关闭聊天、追问改重试」并落地（**未提交**，已部署测试区待验收）：AI 会话面板右栏追问输入条/composer/`ask`/`appendTurns`/i18n aiSend+aiContinueHint 全删——闲聊会永久混进业务记录且每次追问全量回放历史（含原始完整 prompt）烧 token。替代：error 记录右栏显示「重试」钮（aiRetry），`SessionPanelCtl.retry` 走 `agentChatContinued(turns.slice(0,-1), 末条user轮, …)`（=重跑末次调用，error 记录 turns 必以 user 轮收尾）+ `AiSessionStore.retrying(id)`（error→running 复用 succeed/fail 收口原地翻案，仅 error 态可转防重入）；超时取 AI_TIMEOUT.batch（空闲计，重试是显式动作）；「思考中」占位轮改 status=running 驱动。agentChatContinued 语义从「继续追问」变「面板重试入口」（函数名未改）。
