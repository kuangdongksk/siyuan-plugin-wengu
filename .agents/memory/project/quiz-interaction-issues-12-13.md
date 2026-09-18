---
name: quiz-interaction-issues-12-13
description: 20260910 做题交互批次全部收口：#12/#13/#14/#21 关单（PR15/16/17/24/25 均并）、#10 单词移动端 PR#11
    已并待真机验证；20260911 ZCode 接管调度一天内清完全部在途 PR
metadata:
    node_type: memory
    type: project
    originSessionId: sess_37f9327f-ee87-4ab4-8460-25eb86d7bb39
---

20260910 做题交互批次（CNB NPC 云端开发，见 [[cnb-npc-full-workflow-first-run]]）：

- **Issue #12 → PR #16 已合并（dev=6b9d629）关单**：跳过/不会按钮 + after 模式收卷前可改答案 + 答满改手动收卷（头部钮在 after 下变「交卷并查看答案」）。本地审查出两 P1（NPC 修复轮 0bd0ffe 修掉）：①`restoreContextFor` 恢复揭示判据改 `!!session.endedAt`（答满≠收卷，旧判据下「答满未收卷」的轮重开即全卷泄题）；②steps/slots 完成与恢复路径补 `ui.revealed=true`（否则解析区永久隐藏）。附带语义沉淀：`.wengu-graded` 退为纯「已判分」，内容显隐（解析区 .wengu-static-sol/答案解析 part/考点标题 .wengu-card-title）全挂 `.wengu-revealed`；`pushSessionAnswer` 改按 qid upsert（原地覆写、answered 不涨、correct 差值修正）；题库镜像首提 recordAnswer/重提 recordVerifyResult（applyOverride 共用，wrongCount 曾错不清零）。
- **Issue #14 → PR #15 已关单**：考点标题作答前隐藏（纯 CSS visibility 保 margin-right:auto 占位、防 display:none 挤居中回归）；用户自行合并，与 #16 的联动（闸改挂 :not(.wengu-revealed)）随 #16 解冲突落地。
- **Issue #13 → PR #17 已合并关单**（同题两投：PR #18 被 #17 取代未并）；后继 #19（揭示闸补写入点）也已并。
- **PR #11（#10 单词移动端）20260911 已审查合并、#10 关单**：环境检测 `isMobileUi`（window.siyuan.mobile）+ `wengu-mobile` 标记类分流（禁 media query，桌面 CSS 字节级不变）+ iOS 首播进手势同步栈（word/core/TapSpeech）。**待真机验证**：移动端 dock 背单词四步梯全流程 + 听音卡发音。
- **Issue #21（steps 跳过/不会）→ PR #24 + 复审修正 PR #25 均已并**：#25 把步级守卫从 `ctl.graded` 换 `stepsFrozen`（revealed||locked，对齐 answeredFrozen 口径）、收口快照从「全错占位」改真值（修「答完全变错/申诉翻对基线清 0000」）、steps「不会」后反悔改答走 recordAnswer+bankOverride 覆写题级空串账；CardState 的 steps 段外移新文件 CardSteps.ts 压红线。
- **20260911 调度接管**：用户指示 ZCode 接管全部 issue/PR 调度（只调度不开发）。当日审并 PR #25/#11，关 #10，删尽 8 个已并/废弃远端分支（fetch --prune 后远端只剩 dev）。#16 真机走查仍待做。
- **20260911 装机**：ae51f0e（#25/#11 并入后）构建部署成功——md5 四对一致、特征串（wengu-mobile/notifyMobileQuizOnly）grep 在位、petal 重载 code:0 enabled:true；走查清单已给用户，仍待做。后续新报障见 [[quiz-annobar-select-clue-redesign]]。
