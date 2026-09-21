---
name: user-runs-config-commands-manually
description: 本机配置变更先给可粘贴的命令/提示词让他能自己跑；他说「你直接改」后再动手——别闷头执行也别干等
metadata:
  node_type: memory
  type: feedback
  originSessionId: sess_55be0b89-af87-4c1a-bf4d-5a7d1c13e35a
---

20260920 修 open-design MCP 一事的完整弧线：我直接执行 `claude mcp add-json` 被
拒——「不是 Claude，是 zcode，可以先把提示词给我，我手动跑，你先查问题」；等我把
根因和 python 补丁命令给出后，用户改口「那你直接改配置文件不就行了吗」，于是我直接
Edit `~/.zcode/cli/config.json` 完成，用户接受。

**Why:** 用户要的先是**知情权和即时性**——提示词要第一时间到手（他当天催过两次
「先给我提示词」），而不是等我把别的活干完；但并不排斥 AI 动手，他一句话授权后就该
直接改，别再让他自己跑一遍。

**How to apply:** 改用户级配置（`~/.zcode/cli/config.json`、MCP 注册等）：①先诊断
验证修法；②**立刻把可粘贴的命令/修正 JSON 原文给出**（带备份步骤与预期输出），别压
到最后才给；③用户明确说「你直接改」就马上动手。另：本机无 `zcode` CLI，ZCode 的
MCP 配置直接在 config.json 里改；open-design 的 args 曾被按空格截断成多段是根因。
参见 [[timer-switch-three-line-handoff]]。
