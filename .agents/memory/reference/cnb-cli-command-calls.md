---
name: cnb-cli-command-calls
description: cnb CLI 开单/召唤/查 PR 的实测命令口径——issues create-issue
  --body-file、post-issue-comment 需 --repo --number --work-mode、pulls get-pull
  拿分支
metadata:
  node_type: memory
  type: reference
  originSessionId: sess_a1e34516-cf90-485b-be44-2894bd05a991
---

20260918 实测通过的 cnb CLI 口径（补 [[cnb-npc-full-workflow-first-run]] 的旧口径）：

- **开 Issue**：`cnb issues create-issue --repo bianchao777/sasa/siyuan-plugin-wengu --title ... --body-file <file>`（返回 data.number）。
- **召唤 NPC**：快捷命令 `cnb issues comment` **不带 --repo/--issue**（依赖事件上下文环境变量，外部调用必失败）；用完整工具 `cnb issues post-issue-comment --repo ... --number <n> --body-file <file> --work-mode`。提及必须顶格 `@bianchao777/sasa/siyuan-plugin-wengu(青简)`。
- **查 PR**：`cnb pulls get-pull --repo ... --number <n>`（head.ref/head.sha/base.sha、NPC 自述 body 全文）；`cnb pulls list-pulls` 输出嵌套深、扁平 grep 拿不到字段。
- **查流水线**：`cnb build get-build-logs --repo ...`，确认 `event: issue.comment@npc` 条目出现=召唤真触发。
- **审查 worktree**：分支须先 `git fetch cnb <branch>` 再 `git worktree add /tmp/xxx FETCH_HEAD`（直接 add 远端分支名报 invalid reference）；软链主仓 node_modules 后可跑全套检查。
- zsh 坑：`echo ===` 会报 `=== not found`（= 开头扩展），分隔用 `echo ---`。
