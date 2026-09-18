# 项目记忆索引

所有记忆都已移动到 `.agents/memory/` 下，读写都放在 `.agents/memory/`，按内容类型分类：

- `project/`（111 条）— 项目决策、进度、方案
- `feedback/`（21 条）— 用户反馈、协作约定
- `reference/`（14 条）— 环境、工具、外部资源
- `user/`（4 条）— 用户偏好
- `log/`（1 条）— 按日期的工作日志

若产生项目计划，存放在 `.agents/plan/`。
本仓库另有按业务域手工维护的笔记（quiz.md、ui.md 等，见同目录 README.md）与 legacy/ 早期归档，位置不变。
旧目录 `.claude/memory`、`.codex/memory`、`.workbuddy/memory`、`.dsh/memory`、`.qoder/MEMORY.md` 均为指向本目录的符号链接，通过它们读写会直接落到本目录。
