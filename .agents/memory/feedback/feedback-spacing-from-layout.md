---
name: feedback-spacing-from-layout
description: UI 间距必须由布局表达（padding/margin/gap/实测变量），JS 只测量不决定——拒绝魔法数
metadata:
    node_type: memory
    type: feedback
    originSessionId: sess_8a00cdab-55b5-42a0-aa4b-6cc731105b45
---

题号栏高度修复四轮后（20260829「题号没占满」→「又装不下只差几像素」→
「那应该有padding和margin啊」→「底部加padding」）用户定型的工作方式：
布局间距一律写在 CSS（padding/margin/gap），JS 允许**测量**布局值
（getComputedStyle/clientHeight）算封顶写入 CSS 变量，但不许在 JS 里
硬编码间距数字。

**Why:** 固定猜值（max-height 的 200px、chrome 余量 40px）在不同机器/
主题/窗口间总有残差，两轮真机反馈都不准；用户原话「那应该有padding和
margin啊」。

**How to apply:** 遇到「差几像素/没占满/没对齐」类反馈，先找实测来源
替换猜值（已有 CSS 变量或 getComputedStyle 实读），新增间距走布局属性、
调参只改 CSS 一处。范例：NumRail.applyHeights 写 `--wengu-nums-max =
clientHeight − headH − 主区 padB − 栏 marginB` + cards.scss `.wengu-nums`
（margin-bottom/padding/gap）。相关：[[wengu-quiz-ui-fixes-20260829]]
