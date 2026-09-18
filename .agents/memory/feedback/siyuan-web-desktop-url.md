---
name: siyuan-web-desktop-url
description: 思源 Web 端调试必须用 /stage/build/desktop/ 入口，不是 /stage/build/app/
metadata:
    node_type: memory
    type: feedback
    originSessionId: sess_558de3be-6f4f-41c5-82c5-4ed9bfe1f383
---

浏览器实测温故插件时，思源 Web 端入口 URL 必须是
`http://127.0.0.1:6806/stage/build/desktop/`，不要用 `/stage/build/app/`。

**移动端 UI 的浏览器入口是 `/stage/build/mobile/`**（20260915 实测）：
`stage/build/` 下有 app/desktop/export/mobile 四个入口——`app` 是 Electron 壳
专用（bundle 含 `require("electron")` 外部模块），纯浏览器打开必白屏
（require is not defined → 卡「点击刷新」死循环）；`mobile` 无 electron 依赖，
配 390×844 触控视口即是移动端真机形态。

**Why:** `app` 入口缺桌面壳（dock/rail/完整布局），用户已多次纠正「url 中的
app 要改成 desktop」；desktop 入口才有与桌面端一致的插件宿主环境。移动端
只在 mobile 入口可跑——桌面纠正经验不能反推到移动端。

**How to apply:** 桌面用 desktop 路径；移动端用 mobile 路径；`/stage/build/app/`
任何浏览器场景都不该出现。相关：[[siyuan-web-ui-debug]]、[[siyuan-web-auth]]、
[[npc-first-no-browser-loop]]
