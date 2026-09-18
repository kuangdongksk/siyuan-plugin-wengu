---
name: wengu-neo-theme-traps
description: 用户思源用第三方 Neo 主题（暗色），会改原生 config__side/滚动条样式——插件弹窗 UI 必须在 Neo 下验证
metadata:
    node_type: memory
    type: project
    originSessionId: sess_1b34d0db-265d-4869-9d5e-2f34fe45ee44
---

用户工作区（D:/data/思源/工作）思源 3.8.0 用**第三方 Neo 主题 v1.2.7**（暗色，装在
`conf/appearance/themes/Neo/`）+ color-icon 图标包，不是官方 daylight/midnight。

**Why:** Neo 对 `.config__panel .config__side` 设 `overflow:auto; padding:8px 0;
border:unset`，与原生 `.config__tab-scroll` 的 `-12px` 负右 margin 失衡 → 设置类弹窗
左导航出横向滚动条（20260823 温故设置弹窗真机踩坑；思源原生设置同样受影响）。
任何复用思源原生 config___/b3-_ 类的自定义 UI 都可能被主题改样式。

**How to apply:**

- 调 UI 不能只在官方主题下看；复现方法：拷 base.css + `conf/appearance/themes/Neo/theme.css`
    - dist/index.css 到本地 http 页，注入 load 时 scrollWidth>clientWidth 探针（浏览器验证）。
- 插件侧防御范式：内容根加作用域类（如 `wengu-setting`），在插件 css 里
  `.config__panel.wengu-setting …` 同特异性覆盖，靠插件 css 后加载取胜。
- 真机 conf.json 读外观：`conf/conf.json` 的 `appearance.themeDark/themeLight`。

20260826 新增：Neo 给 `.b3-button--icon` 渲染**边框**（单词域头部图标钮
真机实例）。插件纯图标钮一律用无框通用类 `wengu-iconbtn`
（design-review §〇4，见 [[wengu-dock-icon-branch]]），别用
`b3-button b3-button--icon`。
