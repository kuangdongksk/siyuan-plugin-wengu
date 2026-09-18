---
name: doc-prefer-structured-lists
description: 项目文档（AGENTS.md 等）要分条列成列表，别揉成长段散文；用户会嫌「都集中在一起不好看」（20260910）
metadata:
    node_type: memory
    type: feedback
    originSessionId: sess_08e1509d-ccc3-44b9-970b-270be8b8ed17
---

用户看到 AGENTS.md `## 项目速览` 把每个 src/ 域的描述揉成一大段、内嵌一堆逗号串联的日期备注时，反馈「分条改成列表，都集中在一起不好看」——要求把揉在一起的散文重排成每域一个小标题 + 逐条列表。

**Why:** 这份文档是给 AI 代理的机构记忆，信息密度本来就高；揉成一段后一层嵌套几十行、全靠逗号衔接，读起来/扫读都费劲。分域 + 分条后，每个事实可独立成行、可 grep、可快速定位。

**How to apply:** 写项目文档/AGENTS.md/说明时，默认用「小标题 + 分条列表」，一事实一条，别把多个要点用逗号、分号串进一个长句。保留所有硬约束与日期备注（它们是成本换来的），只是把「一条长句」拆成「多行条目」。相关机制见 [[structure-repair-prefer-direct]]（同属「别让用户费劲」的偏好族）。
