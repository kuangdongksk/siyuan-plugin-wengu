---
name: siyuan-builtin-icon-sprite
description: 思源内置图标 sprite 的真身位置（图标包机制）与 dock 图标 uiLayout 持久化定论
metadata:
    node_type: memory
    type: reference
    originSessionId: sess_5f3a9cc2-61f3-4e4e-a1c6-8ecc56597c81
---

思源 3.8.x 起内置图标走**图标包**机制，sprite 不在 stage 的 HTML/JS 里：

- 真身：`<工作区>/conf/appearance/icons/litheness/icon.js`（默认包，~254 个
  `<symbol id="iconXxx">`；3.8.1 conf 在 conf/ 子目录）。查图标 id 先在这里
  grep。另注意**包内图标 ≠ 核心 sprite 图标**：desktop main.js 代码里
  引用过的 id（如 iconRiffCard）才是核心、到处都有；只在包文件里出现的
  id（如 iconLanguage）运行环境 sprite 未必收录，直接引用可能渲染空白。
- 活跃包记录在 conf.json `appearance.icon`；另有 color-icon 备选包。
- **dock 图标持久化定论（20260826 真机证伪早先结论）**：conf.json
  `uiLayout` 把每个 dock 页签的 icon id 存进布局，**启动恢复用存量
  数据、不走插件 addDock 新 config**——改 config 里的 icon id 对已
  持久化的 dock 不生效，旧 symbol 一删就渲染空白。插件图标必须
  **自有稳定 id + addIcons 注册**（形状可换，id 永不改），见
  design-review §〇 第 8 条。
- 网页版验证 UI 很好用：`http://127.0.0.1:6806/stage/build/desktop/`
  （注意必须 **desktop** 构建；根路径 302 给浏览器 UA 的是 app 构建，
  用户明确要求用 desktop）。

相关：[[wengu-dock-icon-branch]]、[[wengu-word-timing-branch]]
