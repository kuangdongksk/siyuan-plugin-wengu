---
name: siyuan-web-mobile-entry-dock-repro
description: 移动端前端可在桌面浏览器用 /stage/build/mobile/ 复现；dock 按钮在屏外须程序化派发点击；i18n
    装机必须拷插件目录 i18n/ 子目录
metadata:
    node_type: memory
    type: reference
    originSessionId: sess_f064d4f3-35bc-4ea5-8a4e-d4c6e52bc143
---

移动端插件 UI 的真机复现通道（20260916 实测，内核 3.8.3、6806 端口、无 accessAuthCode）：

- **URL＝`http://127.0.0.1:<port>/stage/build/mobile/`**（与桌面必须用 `/stage/build/desktop/` 同理，不要用 `/app/`）。加载后 `window.siyuan.mobile === true`，插件按移动端分支挂载。
- **视口设 390×844**；插件 dock 面板与按钮都在**右侧抽屉里（getBoundingClientRect 的 x 超出视口）**，Playwright 坐标点不到——用 evaluate 程序化派发 `PointerEvent(pointerdown/up)+MouseEvent(click)` 到目标元素即可命中（SiYuan 的监听吃派发事件）。dock 按钮选择器：`[data-type="sidebar-<pluginName><dockType>-tab"]`，面板本体 `[data-type="sidebar-<pluginName><dockType>"]`（如 `sidebar-siyuan-plugin-wenguwengu-mobile-drill`）。
- **读面板内容**用 `querySelector` + textContent，不必把抽屉滚进视口；a11y domSnapshot 也包含屏外元素。
- ⚠️ **装机 i18n 拷贝位置是插件目录 `i18n/` 子目录**（`zh-CN.json`/`en.json`），拷到插件根级会被忽略——拷错位置的症状是界面显示原始 i18n 键名（20260916 实栽：弹层文案全变成 `mobileEndPickedTitle` 等键名）。`dist/index.js`/`dist/index.css` 才是拷到插件根。
- 改完插件文件要 `tab.reload()` 整页重载（前端启动时载插件 JS）。

相关：[[siyuan-web-desktop-url]]、[[siyuan-web-ui-debug]]、[[siyuan-data-location]]。
