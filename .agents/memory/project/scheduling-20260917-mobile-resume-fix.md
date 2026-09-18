---
name: scheduling-20260917-mobile-resume-fix
description: 20260917 移动端「继续上次」三缺口修复单 #167→PR#168 一次过并装机；含轮询 PR 的脚本坑
metadata:
    node_type: memory
    type: project
    originSessionId: sess_f6a2a703-8742-45f8-9d00-44d2db96a4d6
---

20260917 调度：移动端「继续上次」三缺口（用户报障「每次都是新的开始」）Issue #167 → PR #168 一次过，dev=5b8acc4 已装机（disable→enable 循环重载）。

- 根因三条：①探测只在激活题集且 dock 恒落 sets[0]（多套题时恢复卡不出现）；②count 裁剪轮不写 scopeIds 快照，恢复展开全量（桌面 P2-6 的移动端对应维度缺失）；③恢复落第 1 题不像「继续」。即时模式答满自动收卷属设计内不在单内。
- NPC（青简）自曝返工一轮：首版在探测里顺手 selectSet 切卷=用户点题集 A 被静默弹到 B（选卷入口作废）——**探测必须只读**，切卷只许发生在用户点恢复卡那一步；恢复卡自带会话对象、恢复路径禁二次探测（防目标卷有更新已收卷轮时「继续」退化成新开）。
- MobileDrill.ts 490→468 行：余量仅 9 行的约束兑现=起轮/恢复/关轮生命周期整体收口进 core/MobileRound.ts，MobileDrill 只留薄转发。
- 恢复路径不再 upsert（upsert 按 id 整段换对象，重放旧快照有盖回风险；且恢复零字段变化）。
- 审查 nit 未拦：存量无快照未完成轮 + 题集题目被清空 → 恢复卡显示 n/0 且点击静默无操作（罕见角落，不阻塞）。
- ⚠️ 轮询 PR 的脚本坑：`cnb pulls list-pulls` 输出里 grep `"167"` 匹配不到（body/title 不在该输出的扁平字段里）——盯 PR 要轮询后逐条 get-pull 看 title/Ref，或 grep 标题里的 issue 号。

相关：[[scheduling-20260916-evening-two-mobile-fixes]]、[[cnb-npc-full-workflow-first-run]]
