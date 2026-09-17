---
name: feedback-delegate-decisions
description: 用户以「你来决定」授权代理自主决策——先给带优先级的结论，然后直接执行
metadata:
    node_type: memory
    type: feedback
    originSessionId: sess_265f8127-992b-406c-9fe3-b3f644f5fb04
---

给出自检/评审结论（分「真 bug / 清理项 / 低优先级备查」）后，用户回复
「你来决定」：期望代理自己定夺修哪些并直接做完，不再逐项确认。

**Why:** 用户信任代理的优先级判断；回头追问会拖慢节奏。

**How to apply:** 评审/方案类任务先输出带明确推荐的分级清单；用户表态
授权（或默认继续）后，按推荐子集自主执行完并汇报，只把真正的设计
决策（如改 session 结构）留成记录待定，参见 [[user-kaoyan-exam-prep]]。
