# src/companion/ —— 伴学看板娘「小书童」

- 规则层表情+台词 / AI 增强与聊天走智能体 agentChatOnce 独立会话并发；双宿主=刷题
  页签挂载层+单词 dock 内嵌；各域收口一行 `notify*` 接入事件。
- 管理工作区面板已 Svelte 四件套化（2026-08-27，comp/CompanionPanelApp）；聊天历史
  按学伴 id 分份持久 saveData("companion-chat")，core/ChatStore 串行写；默认学伴
  物化为 id=default 的正式条目——可删可改与自定义同权，列表至少保留一个。
