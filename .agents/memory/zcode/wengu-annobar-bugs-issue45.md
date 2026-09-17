---
name: wengu-annobar-bugs-issue45
description: 浮条两bug(预览出浮条+非英语卷出标生词)已随PR#49合并(97eb02c)——模式闸+卷级判定+组题材料面板组内卡反查
metadata:
  node_type: memory
  type: project
  originSessionId: sess_4482839f-2c9e-4f41-959d-e1f76daa9b53
---

2026-09-13 用户真机报浮条两 bug，[Issue #45](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/45) 已开（**尚未召唤**——一次只跑一个 NPC，等 #44 PR 合并后去评论召唤）。

**根因**（均在 `src/quiz/flow/AnnoFlow.ts` 体系）：
1. 预览/复习出浮条：`bindAnnotationLayer` 构造器一次性绑定（`ViewBindings.bindViewFrameFor`），`positionBar` 不判视图模式。
2. 非英语卷出「标生词」：`barChildren` 无条件渲染该钮。**不能按题型分流**——英语阅读=single、数学单选也=single，题级判不开；须**卷级**判定（该卷题型并集含 cloze/match/essay/trans 任一；`BankSets.setTypeUnion` 现成零 AI，判定按卷缓存防 selectionchange 高频查库）。

**修法要点**（Issue 内已写全）：`AnnoCallbacks` 加 enabled 闸（`()=>v.mode==="quiz"`）、切模式立即 hideBar 防残留、标生词按选区起点所在卡反查源卷判定（聚合混合刷各卡各判、反查失败宁可不出现）、非英语且非可标区=无钮不出空条、quiz 模式既有行为逐字节不变。

相关：[[wengu-dispatch-20260913]]
