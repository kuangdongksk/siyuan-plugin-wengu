---
name: word-card-bubble-flip
description: 单词卡「点卡翻面」冒泡坑——推进按钮点完同步换卡后，同一次点击冒泡到卡根把新卡误翻面直接显示答案；卡根 onclick 已加 button/input 守卫
metadata:
    node_type: memory
    type: project
    originSessionId: sess_d3ef15b2-3a92-4e9a-9d16-f600790f5fa6
---

2026-08-27 真机踩坑（用户报「回想直接把答案展示出来了」）：QuizCard 根元素挂 `onclick=reveal()`（点卡翻面），鼠标点「下一个」/三档按钮收尾时——按钮 handler 先跑 → finishCard→enterPrompt **同步**写新卡 phase="prompt"/cardMode → 同一次点击继续冒泡到卡根 → reveal() 守卫全过 → 新卡当场翻面显示答案+三档兜底（selfGrade 已被重置所以不是「下一个」态）。键盘路径不走 onclick，键盘自测不暴露。

修法：卡根 onclick 忽略来自 `closest("button, input")` 的点击（单一收口，后续加按钮不复发）；星标/熟/回首页等仍自带 stopPropagation。

**Why:** Svelte 5 `$state` 变量在 handler 里同步更新，事件继续冒泡时祖先 handler 读到的是新状态——「换卡+误翻面」在同一次 click 里串联；零报错，只有鼠标流可见。
**How to apply:** 任何「容器级点击翻面/展开」+ 内部按钮会推进状态的组合，容器 handler 都要挡交互元素（比给每个按钮 stopPropagation 可靠）。排查同类截图时用 i18n 文案区分视图态：wordSelfEn=翻面反馈、wordRecallHint=正面提示。相关：[[word-ladder-final]]、[[svelte-migration-dead-selectors]]。
