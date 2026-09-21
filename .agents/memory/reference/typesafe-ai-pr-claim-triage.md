---
name: typesafe-ai-pr-claim-triage
description: typesafe-ai skill（~/.agents/skills/）+ Jev API 标定结果——叙事类声明初筛可用
    （7/7，假归因 0.03），技术声明仍以机械复跑为锚；脚本 /tmp/ts_calib.py
metadata:
    node_type: memory
    type: reference
    originSessionId: sess_df482117-562e-4736-8c73-01b8034d294c
---

TypeSafe「System One」小判断模型服务（skill 在 `~/.agents/skills/typesafe-ai/`，
live docs https://docs.typesafe.ai/llms.txt ；API `POST https://api.typesafe.ai/v1/systemone`，
`Authorization: Bearer <key>`，state + questions，Noul 返回 0–1 概率，原语 Choice/Noul/Score）。

20260921 标定实验（脚本 `/tmp/ts_calib.py`，key 走 env `TYPESAFE_KEY`，未落任何文件）：
拿 #178/#179/#181 已机械核实的 7 条交付声明（6 真 1 假）+ 1 条不可核查对照喂 jev-latest：

- 7/7 判对；真声明 P(true)=0.69–0.84（正向不狂热）；假归因声明（「ca4bbc7 是另一路
  另派的修复」实为 OCI 自动修复环所推）P=0.03；不可核查声明 P=0.09（按保守判 no 指令收缩）。
- 关键 caveat：证据是人工加工好的（决定性证据喂到嘴边才对）。技术类声明的可信度锚仍是
  机械复跑（worktree 五件套 / git diff / grep / 变异测试）——TypeSafe 没有增量。
- 真正的空档＝**叙事/归因类声明**（「这是另一路的修复」「我实测过」）：CI 与门禁不覆盖，
  只能靠时间线重建。Noul 初筛这类声明（<0.5 或模糊→人工查）是它在本项目流水线的合理落点。
- 数据出境前提：diff/评论要发给第三方 API，用前须用户点头；key 由用户提供、用后不落盘。
- 20260921 用户已当场提供 API key（key 不记档）；第二轮硬测试已提议未跑——只喂
  原始 diff + 交付评论、不给加工证据，看它能否自己闻出不一致（那才接近真实初筛场景）。

参见 [[timer-switch-three-line-handoff]]、[[jev-typesafe-integration]]。
