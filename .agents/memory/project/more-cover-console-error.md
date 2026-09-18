---
name: more-cover-console-error
description: 第三方插件 more-cover 在温故题卡内嵌 Protyle 挂载时报 Cannot read 'element' of
    undefined——已诊断为 more-cover 缺判空，温故不受影响，处理方式待用户拍板
metadata:
    node_type: memory
    type: project
    originSessionId: sess_67681261-a222-4fcb-a95e-023806a604ea
---

2026-08-25 用户贴控制台报错 `plugin:more-cover:158 Uncaught TypeError: Cannot read properties of undefined (reading 'element')`，已诊断完毕（别再重查）：

- **责任方是 more-cover 插件**（工作区 `data/plugins/more-cover/`），不是温故。它的 `addChangeIconListener` 监听 `loaded-protyle-static` 事件后不加判空直接读 `e.detail.protyle.background.element`——`background` 是文档编辑器标题背景对象，**嵌入选读 Protyle 没有这个属性**，拿到 undefined 即崩。
- **触发源是温故每张题卡的内嵌只读 Protyle 挂载**（每次渲染卡片都会刷一条），任何嵌静态 Protyle 的插件都会踩它。
- **温故功能完全不受影响**：异常在 more-cover 自己的回调里，题卡照常。只是控制台噪音。
- 给用户的三个选项（**尚未拍板**，下次提起先问选哪个）：关掉/更新 more-cover；给上游提 issue（一句话：`loaded-protyle-static` 的 `protyle.background` 可能为 undefined，`addChangeIconListener` 缺判空）；本地热修它 index.js 加可选链 `t.background?.element`（第三方文件，更新/同步会被覆盖）。

相关：[[siyuan-api-patterns]]。
