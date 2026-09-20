---
name: recall-repo-memory-before-market-answers
description: 用户随口提"我要出的/我说的那个"类延续性话题时，先翻仓库 .agents/memory/ 再答，别先用世界知识凑
metadata:
  node_type: memory
  type: feedback
  originSessionId: sess_eb306cd9-27fe-4a22-a022-8d7c9646435c
---

2026-09-18 用户问「政治微信刷题小程序叫什么」，指的是他要自研上线的独立产品
（仓库记忆 `.agents/memory/project/wx-miniprogram-quiz-spinoff.md`，20260917 定向），
我直接答了一堆市面竞品（苍盾等），用户回「我是说我要出的，你一点不看记忆吗」。

**Why:** 仓库 `.agents/memory/` 是第一记忆源（AGENTS.md 明确"改哪个域先读对应
模块文件"）；用户随口一问往往指记忆里已有上下文的事，用通识作答既是错误答案，
又显得没读档。

**How to apply:** 遇到指代不明但像延续既有话题的问题（"对了…""我说的那个…"
"我要出的…"），先 grep `.agents/memory/`（`project/`、`log/`、索引 README.md）
再作答；记忆里查无此事就明说"记忆里没记录"，并补一句"是不是没记上/要现在定吗"，
别拿通识凑数。
