---
name: mascot-and-latex-input-plan
description: 20260827 两个新功能意向——看板娘陪伴学习 + 思路/口述→AI→LaTeX 公式速记；含插件内可行管线与落地顺序评估
metadata:
    node_type: memory
    type: project
    originSessionId: sess_0d4f0739-5f8b-4e5a-98a4-bc96ff328576
---

用户 2026-08-27 提出两个新功能意向（咨询阶段，未拍板开工）：

1. **看板娘**：AI 陪伴学习，建议挂刷题页签角落。
2. **公式速记**：手写公式痛苦，希望思路/口述 → AI → LaTeX。用户 LaTeX 入门水平（问「好学吗」），定位是「校对者」不是「书写者」。

已给的评估结论（未来实现时直接沿用，避免重推导）：

- **插件内 AI 唯一通道 = 内核 `/api/ai/chatGPT`**（客户端现成：`src/convert/AgentClient.ts`）。云端小杯/Mathpix/本地 Qwen/needle 全部不可达——apiKey 是内核密文（AGENTS.md 已定论）。高频调用必须走 chatGPT 端点，不能用单会话互斥的 `agent/chat` SSE。
- **公式速记管线**：输入框（打字或 macOS 系统听写 Fn 连按；Electron 插件内无 SpeechRecognition）→ chatGPT 一发 → LaTeX → `$$...$$` 插入文档。SymPy 验算浏览器里没有，用 Lute/KaTeX 渲染验证代替（红错=语法错）。
- **看板娘两级架构**：硬信号（判题对错/连错/超时/复习完成/词卡三档自评）走纯前端规则零延迟——quiz/word/stats 域事件现成；软语境（文本→表情）走 chatGPT，输出约成有限枚举 + 兜底默认表情。素材用 SVG+CSS 动画不上 Live2D，对齐 [[ui-consistency-feedback]]（svgIcon 禁 emoji、样式进 scss 分片）。
- **建议落地顺序**：① 规则版看板娘（~1 天）→ ② 公式速记（复用 AgentClient，~半天）→ ③ 语境版表情；①②互相独立、不依赖 ③。
- needle 是用户在温故之外探索的本地小模型（14MB、.cact 微调），与本插件无耦合点，看板娘软语境也别指望它进插件。
