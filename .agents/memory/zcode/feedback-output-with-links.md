---
name: feedback-output-with-links
description: 调度输出必须带可点链接（CNB Issue/PR/构建、本地文件绝对路径），用户指定项目记忆存仓库 .zcode/MEMORY.md
metadata:
  node_type: memory
  type: feedback
  originSessionId: sess_0e98c269-4ad8-4c3c-aa2f-1edaf1290b07
---

用户要求（2026-09-10）：汇报里提到的每个具体对象（Issue/PR/分支/构建/本地文件）首次出现时就附**可点击链接**，不要裸编号。

**Why:** 用户是调度方，要随手点开核对状态；裸编号需要手动拼 URL。

**How to apply:**
- CNN 基址 https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu；Issue=`/-/issues/{n}`、PR=`/-/pulls/{n}`、构建=`/-/build/logs`；API 走 api.cnb.cool + `~/.cnb/token` 的 Bearer token。
- 本地文件用绝对路径 markdown 链接。
- **用户指定的项目记忆位置：仓库根 `.zcode/MEMORY.md`**（有 git 的文件夹内、.gitignore 已收录）——新的持久协作偏好优先写那里并保持同步，本目录只放指针级副本。

相关：[[project-parallel-sessions]]
