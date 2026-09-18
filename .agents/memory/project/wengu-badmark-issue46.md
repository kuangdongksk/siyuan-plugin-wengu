---
name: wengu-badmark-issue46
description: 预览模式标记错题+顶部批量重转Issue#46已召唤NPC跑着(20260913 16:23,流水线cnb-68o-1k2ctqeg6)等PR
metadata:
    node_type: memory
    type: project
    originSessionId: sess_4482839f-2c9e-4f41-959d-e1f76daa9b53
---

2026-09-13 用户第三条需求，[Issue #46](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/46) 已开（排队：#44 在跑 → #45 → #46，见 [[wengu-dispatch-20260913]]）。

**语义澄清**：「标记为错题」= 题目本身出错（生成质量问题），**不是**错题本的作答错误——文案要区分。

**设计要点**：

- `BankRecord` 加 `badMark?: "1"`——照抄 `srcStale?: "1"` 同款口径（optional/不 bump version/不写 kramdown 不动 questionHash 冻结清单）；`replaceRecordKramdown` 不动此字段，qid 不变标记跟随。
- 卡头钮仅预览模式显示、两态（再点取消）；新增按钮须查预览三处清理面（PreviewFlow 摘行/pointer-events 名单/DOM 手术）。
- 顶部批量钮=预览头部 QuizHeadApp onAct 通道，「重转错题(N)」N=0 不显示；点击即关窗，launchAiFlow + `regenRecords`（RepairDialog 先例，内建 regenInFlight 防重入）；**跨卷全局收集**；成功自动清标记、失败保留；「重转」=逐题重新生成，不是整卷重转。

相关：[[wengu-annobar-bugs-issue45]]
