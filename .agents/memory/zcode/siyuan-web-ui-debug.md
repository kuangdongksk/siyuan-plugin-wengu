---
name: siyuan-web-ui-debug
description: 插件 UI 调试直接开思源网页版（6806 的 desktop 构建）——比搭假复现页好；附截图查看与资源路径
metadata:
  node_type: memory
  type: reference
  originSessionId: sess_5f3a9cc2-61f3-4e4e-a1c6-8ecc56597c81
---

**用户明确偏好（2026-08-26）**：调插件 UI 样式别搭合成复现页，直接打开
思源网页版看真实渲染（「你不如直接打开思源的」）。

- 内核 6806 就服着完整前端：**必须访问
  `http://127.0.0.1:6806/stage/build/desktop/`**——浏览器访问根路径会被
  重定向到 `/stage/build/app/`，那是另一套构建，弹 API token 认证窗；
  手动敲 desktop 路径则免认证直接进完整界面（用户强调「必须把 app
  换成 desktop」）。用户口中的「6080」实为 6806。网页版里 Neo 主题、
  温故页签、背单词 dock 全部真实可用，改样式可现场验证。
- 浏览器内截图（nodeRepl.emitImage）返回的是 CDN URL 而非可视图像——
  要「看」图须把 URL 喂给 `mcp__4_5v_mcp__analyze_image`。
- file:// 页面 Browser Use 导航不了；要开本地页须先起 HTTP 静态服务。
- 若确需搭静态复现：思源 base.css 在 WindowsApps stage
  `build/desktop/base.*.css`，Neo 主题在 `<工作区>/conf/appearance/
  themes/Neo/theme.css`，图标 symbol 在 conf/appearance/icons/litheness/
  icon.js（见 [[siyuan-builtin-icon-sprite]]）。
- **stage CSS 走内核 HTTP 拉（20260830，WindowsApps 目录 Git Bash cd
  权限拒绝）**：`curl http://127.0.0.1:<port>/stage/build/desktop/`（免
  认证）grep 出 `base.<hash>.css` 链接再拉文件。顺手定论两条上传控件
  事实：`.b3-form__upload` 是**隐形全覆盖 input**（absolute 铺满父容器/
  opacity:.001/font-size:0，须 position:relative 父按钮）——思源官方配方
  即 `<button class="b3-button b3-button--outline" style="position:
  relative"><input class="b3-form__upload" type="file">`（设置-同步「导入
  配置」同款，main.js 里还有生成此结构的工厂函数）；`.b3-file` 在思源
  CSS **无定义**、是裸原生控件——插件上传控件一律用 b3-form__upload
  配方（StartScreen 两文件行已换，见 [[wengu-import-tsv-redesign]]）。
- Bash 陷阱变体：`node -e` 内联正则的反斜杠（`[\s\S]`）会被 Git Bash
  双引号悄悄吃成 `[sS]` 假阴性——含反斜杠的脚本一律 Write 成 .js 文件
  再跑，别内联。
- **IAB guest 点击寿命（2026-08-26 踩坑）**：每个 guest webview 只有
  **第一次 `cua.click` 生效**，之后所有坐标点击静默失效（顶栏/页签内
  全灭，无报错）；reload 不恢复。对策：要 N 次点击就开 N 个 guest——
  布局会恢复已开的温故页签，新 guest 等启动（~12s）后把首击用在关键
  按钮上。Playwright locator.click 常超时（actionability 判定被透明层
  干扰），坐标点击 + `getBoundingClientRect` 取中心更可靠。
  **但连开多个 guest 后整个面板会挂死**（`browser guest not attached
  (webview not ready)` 反复出现，visibility 开关/等待均不救）——悠着
  用，一次会话别超过三四个 guest；挂了只能等面板自愈。
- 验 CSS 规则是否命中：弹窗开着时读
  `getComputedStyle(action).gap` + 各 button `getBoundingClientRect()`
  实测间距/宽度（隐藏态 w=0），比截图更硬。
- **CSS 溯源配方（20260829 实战，定位设置行溢出根因用的就是它）**：
  枚举 `document.styleSheets`（含内联 style 标签），对每条 rule
  `el.matches(selectorText)` 且**必须 try-catch**（`::picker` 等新伪
  元素选择器会让 matches 抛 TypeError 中断全脚本），命中且带
  width/margin 的输出 media/selector/cssText——一次拿全命中清单，比翻
  压缩 css 猜快得多；@media 上下文会随 rule.conditionText 一起暴露
  （grep 压缩文件时 media 包裹容易被正则剥离误判成顶层规则）。
- **插件 CSS 注入形态**：不是 `<link href=…/index.css>`，内核把文件
  内容塞进**内联 `<style>` 标签**（styleSheets 里一堆 "inline" 之一，
  头注释 MIT License）。验证部署生效 = 查该 style 标签是否含新规则
  特征串；md5 只对得上磁盘、对不上页面。
- **部署缓存三层坑**：浏览器按固定 `?v=版本` URL 缓存旧 css——petal
  重载+页面 reload 后 style 标签可能仍旧内容；
  `fetch('/plugins/<pkg>/index.css?bust='+Date.now(),{cache:'no-store'})`
  旁路看内核真实伺服内容（响应 last-modified 还能判断文件被谁何时改
  过——本轮靠它发现并行会话 12:46 覆盖部署）。
- `setViewportSize({width:700,…})` 可复现窄屏断点布局，但
  `tab.reload()` 会重置视口——reload 后须重设；弹窗开着时缩视口可
  原地复测（computed width 直接分辨哪类控件中招）。
- evaluate 内跑「点击→轮询→量测」长链会撞 32s 命令超时：拆成多个短
  evaluate 分步执行，每步从 DOM 现查状态；插件重载后顶栏按钮 id 会变
  （`#plugin_<pkg>_0` 失效），用 aria-label 找。

相关：[[wengu-neo-theme-traps]]、[[project-parallel-sessions]]
