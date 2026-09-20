---
name: remote-naming-per-machine
description: 两台机器 git 远端命名相反——外置卷这台 cnb=CNB/origin=github，AGENTS.md 93001b7 的 origin=CNB 口径是另一台机器的；推错一次 github 存档
metadata:
    type: reference
---

20260920 实测（外置卷 baiWeiNV7200 这台机器）：`git remote -v` =
`cnb` → https://cnb.cool/bianchao777/sasa/siyuan-plugin-wengu（CNB，NPC 开发仓），
`origin` → git@github.com:kuangdongksk/siyuan-plugin-wengu（GitHub 存档），
另有 upstream=siyuan-note/plugin-sample。而 AGENTS.md/记忆 93001b7 写的
「origin=CNB、github=存档」是**另一台机器**的命名。

**Why**：调试环境按机器区分，远端命名也按机器不同；照文档口径无脑
`git push origin dev` 会把 dev 推进 GitHub 存档仓（本会话实测发生一次，
无实害但制造了存档与 CNB 的历史分叉——rebase 前同内容提交）。

**How to apply**：动远端前先 `git remote -v` 核实，别信任何文档里的
远端名；推送 CNB 用 `git push cnb dev`（本机）。存档仓允许落后/分叉，
别随意强推对齐。参见 [[cnb-cli-command-calls]]。
