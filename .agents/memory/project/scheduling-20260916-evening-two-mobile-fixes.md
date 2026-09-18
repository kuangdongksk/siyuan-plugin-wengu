---
name: scheduling-20260916-evening-two-mobile-fixes
description: 20260916 晚移动端两报障（选项三字母 / 交卷不记录）诊断→Issue→NPC→合并→装机验证全链；含双标签数据形态与 #105×#158 陷阱定论
metadata:
    node_type: memory
    type: project
    originSessionId: sess_f064d4f3-35bc-4ea5-8a4e-d4c6e52bc143
---

20260916 晚用户两条碎片报障，本地只读诊断 + 浏览器一次性复现后走 Issue→NPC 串行（同域 mobile，两单排队）：

1. **选项三字母（[#163](https://cnb.cool/bianchao777/sasa/siyuan-plugin-wengu/-/issues/163)→PR [#165](https://cnb.cool/bianchao777/sasa/siyuan-plugin-wengu/-/pulls/165)，merge 2d20687）**：真机形态 `key=C txt="D. D. ②④"`。两层根因——移动端 `QuestionBody.svelte` 直调 `optionInline(md)` **没过 `optionDisplayMd`**（桌面 `optionRowHtml` 有）；且政治五套题 kramdown 选项是**双标签** `- A. A. ①③`（实测 2411 行双 vs 1108 单，双是主流），`stripOptionLabel` 只剥一层 ⇒ 桌面也剩一个标签。修复＝移动端补 optionDisplayMd + stripOptionLabel 循环剥层封顶 3（`OPTION_LABEL_MAX_DEPTH`）。NPC 复核还把首版同义反复的 parity 测试换成 `?raw` 源级断言（组件不进单测时的正确锁法）。
2. **刷完不记录出来还是 0（[#164](https://cnb.cool/bianchao777/sasa/siyuan-plugin-wengu/-/issues/164)→PR [#166](https://cnb.cool/bianchao777/sasa/siyuan-plugin-wengu/-/pulls/166)，merge e833be0）**：#105 两段式确认（点选只落选择态）× #158 空轮静默关轮（`requestEnd` 只认 `s.answered`）组合陷阱——点选未确认对判据不可见，交卷即 `closeEmptyRound` 无痕抹除（连 removeSession 删开轮 upsert，history/bank 零残留，唯一无痕通道）。修复＝`MobileAnswering.isPickedUnconfirmed` 唯一判据 + `MobileEndGuard` 第二态弹层（去确认/按当前已选交卷走既有 submit 链）；真·空轮静默关轮零回归。契约测试断言随判据落点更新。

**Why:** 两条都是「组合回归」——单看每个 Issue 的验收都绿，交叉心智才炸；诊断靠真机复现 + 查盘对账（history/bank 全对上账 ⇒ 无痕丢失只可能是 removeSession 路径）定位。

**How to apply:** 移动端 UI 报障先在 Web 端 `/stage/build/mobile/` 复现（见 [[siyuan-web-mobile-entry-dock-repro]]）；「没记录」类先查 history/bank 对账再怀疑代码。相关：[[scheduling-20260916-walkthrough-fixes]]（同日早间调度）。

装机已推 e833be0（dist+i18n 子目录），端到端验证过：弹层文案正常、按已选交卷补记入账出报告。测试污染披露：史纲第 1 题（gen-mu3h4bww-j1w2qj）被我多记 2 次错误作答、history 留 2 条单答题会话（14:00/14:45 UTC），需要清理须停内核改文件。PR #162（word 域）是别会话在办，未动。
