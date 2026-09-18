---
name: svelte-migration-dead-selectors
description: 背单词 innerHTML→Svelte 迁移留下孤儿 CSS 选择器——旧渲染器的 data-act 属性选择器静默失效，样式神秘失效先查这个
metadata:
    node_type: memory
    type: project
    originSessionId: sess_d3ef15b2-3a92-4e9a-9d16-f600790f5fa6
---

2026-08-27 真机踩坑：背单词查词列表横向滚动条 + 排版散架。根因是**单词域 Svelte 化迁移（dfd658b）把渲染从 innerHTML 换成组件后，旧渲染器模板专用的 CSS 选择器成了孤儿**：查词结果行的「单词左/释义右省略」flex 规则写在 `.wengu-word-opt[data-act="lookuppick"]` 上，Svelte 版 LookupScreen 的按钮没有 `data-act` 属性，整条规则静默失效——按钮退化 block、行内 span 上 `white-space:nowrap` + `overflow:hidden/ellipsis` 双双无效（ellipsis 只对块/flex 容器生效），长释义把卡片内容撑到 ~800px（容器 ~356px）顶出横向滚动条。

已修一处（LookupScreen 行改挂专用类 `.wengu-word-lk` + meaning 补 `min-width:0`），但 **words-home.scss / words.scss 里可能还有别的旧模板选择器没被触发过**——只有走到对应 UI 态才会暴露同类断裂。

**Why:** 这类坏法零报错：构建绿、tsc 绿、控件能点，纯粹是「计算样式和作者意图不符」，纸上读源码很难发现；且源码里 grep `data-act` 能找到幸存规则但看不出它们已经失配。
**How to apply:** 单词域再出现「布局神秘失效/难看」先怀疑这个：grep src/scss 里带 `data-act=` 的选择器，对照 comp/*.svelte 的实际标记找失配对；修法是给元素挂新专用类而非恢复 data-act。视觉/布局问题别只纸上分析——开真机浏览器实测计算样式（见 [[siyuan-web-ui-debug]]）。相关：[[ui-consistency-feedback]]。
