---
name: mobile-drill-uifix-issue-105
description: 移动端刷题 UI 修复单 #105 已收官（PR #106 合并 de67a2a、Issue 关 completed）；诊断结论与验收要点存档备返查
metadata:
    node_type: memory
    type: project
    originSessionId: sess_a4167dd6-8d35-4de4-b4c5-62af2b92cda9
---

20260915 开出 [Issue #105](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/105)
（P1），青简在办（--work-mode 已开，分支建议 fix/mobile-drill-confirm-scroll）。
来源=用户真机走查反馈：①题目列表要支持滚动；②刷题界面要按设计稿出「确认答案」
防误触。我曾本地实现并浏览器验证过一遍，用户纠正流程后已全部还原
（`git checkout --`）并用干净 HEAD 重建回部署工作区插件目录。

五处改动（审查 PR 时对照）：

1. **两段式确认**：`DrillScreen.pick` 删自动 submit（原单选/判断点选即答）；
   needConfirm 扩到全部可作答形态（slots 仍排除）；选择/判断未选中时确认钮
   disabled。控制器 `MobileAnswering.ts` 零改动；`MobileDrill.test.ts` 直接调
   pickLetter+submit 不受影响。
2. i18n `mobileAnswerHint` →「作答后按「确认答案」判分」。
3. `.wengu-md-scroll` 补 `touch-action: pan-y` + `overscroll-behavior: contain`
   （真机防侧栏手势吃纵向滚动）。
4. **主 CTA 实心**：`b3-button--main` 类只在桌面样式表存在、移动端没有——
   `.wengu-md-btn-solid` 要自给实心（primary 底+on-primary 字）；覆盖开始刷题/
   确认答案/下一题/题头交卷 chip（恒 primary）/交卷确认弹层确认钮。
5. **图标**：移动端 sprite（290 symbol）无 iconGrid/iconFlag/iconDoc → 换
   iconList/iconBookmark/iconFile。
6. **optionInline 单项列表剥壳**（`- A. xxx` → ul>li>p 整条带圆点渲染，
   桌面 CardState/CardSteps/QuizCard 同链路同病）：unwrapSingleListItem
   恰一 li 恰一段才剥 + 4 例单测。

审查注意：PR base 必须 dev；grep 验收（无 iconGrid/iconFlag/iconDoc、
pick 无 submit、btn-solid 含 var(--b3-theme-primary)）；AGENTS.md 移动端小节
应同步两段式口径。移动端 web 入口=`/stage/build/mobile/`（app/ 是 Electron 壳
专用纯浏览器白屏，见 [[siyuan-web-desktop-url]]）。

相关：[[npc-first-no-browser-loop]]、[[quiz-interaction-issues-12-13]]

**进展（20260915 午后）**：NPC 已出 **PR #106**（fix/mobile-drill-confirm-scroll，
「作答改两段式确认并加固滚动与主按钮实心」），质量门流水线 cnb-7bg-1k2hpvvef
**success**；已审查合并（de67a2a，base 已被 NPC rebase 到含 #104 的 dev），分支已删，#105 关单收口待发评论。另 PR #104（开刷面板行排版+样式拆片
fix/startpanel-spec-row-typography）已审查合并进 dev（d2ad524），远端分支已删，
Ref #100 本就已闭。
