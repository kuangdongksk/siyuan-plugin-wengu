# Changelog

## v0.1.1 unreleased

- 插件题库/专题/知识点反链体系补记：bank 主记录 + 按知识点收集专题 +
  悬空对账 + 题卡重生成 + 右键「查相关题目」+ 薄弱针对性加练（详见
  docs/question-block-contract.md）
- 专题会话独立归档（`col:<id>`）：专题作答不再误记到无关文档的轮次
  统计里；专题轮次可读——「继续上次 / 只刷错题」在专题模式生效；
  重开页签恢复上次专题（prefs.colId）
- 专题模式材料并集装载：按题目来源文档合并材料、解析 group 占位，
  材料组在专题里分栏渲染（静态 Lute + KaTeX）
- 专题可编辑：管理对话框展开专题逐题移除、删除两击确认、创建后直接
  切换过去开刷
- 「收集并补题」：按勾选知识点收集已有题后，AI 生成（错题变式/概念
  辨析，逐题自检）按缺口补入专题（≤10 题/次；非反链键自动降级变式）
- 薄弱加练专题名走 i18n；知识点引用解析器合一（BankParse.parseKpRefs）

## v0.1.0 2026-08-22

First usable cut of Wengu (温故), the drill plugin:

- Quiz tab from the top bar: collapsible sidebar of generated exercise
  documents (question count / drilled / correct / total time per doc),
  question-number rail with a "show numbers" setting toggle
- "AI: make questions" turns any note into a sibling `Title·习题`
  exercise document via SiYuan's built-in AI (suitability verdict first,
  then kramdown question blocks per the block contract)
- Per-type answering widgets; auto-grading for single/multiple/judge/fill
  tolerant of real AI output (content answers, merged option blocks,
  `$…$` delimiters); self-assessment for brief questions
- Timing modes (count-up / countdown / none) with per-round session
  history and a persisted per-document `total-time` attribute
- Wrong answers sync into the "温故错题" flashcard deck (added on wrong,
  removed on correct)

## v0.5.1 2026

- [Add an editor breadcrumb button demo](https://github.com/siyuan-note/siyuan/issues/18856)

## v0.5.0 2026-08-13

- [Migrate the kernel plugin sample from MCP tools to Agent capabilities](https://github.com/siyuan-note/siyuan/issues/18638)

## v0.4.9 2026-8-4

- [Add documentation for the kernels field in plugin.json](https://github.com/siyuan-note/plugin-sample/issues/48)

## v0.4.8 2026-6-30

- [Upgrade devDependencies and implement kernel plugin demo](https://github.com/siyuan-note/plugin-sample/pull/42)
- [Enhance KernelPlugin with MCP tool registration and update ESLint](https://github.com/siyuan-note/plugin-sample/pull/47)
- Migrate i18n locale codes from legacy underscore form (`zh_CN`/`en_US`) to [BCP 47](https://tools.ietf.org/html/bcp47) (`zh-CN`/`en`)
    - Aligns with SiYuan kernel RFC 5646 / BCP 47 lang code refactor (see https://github.com/siyuan-note/siyuan/issues/7098)
    - `plugin.json` keys, i18n file names (`src/i18n/*.json`) and `README.zh-CN.md` filename updated accordingly
    - Bump `minAppVersion` to `3.7.0` (older SiYuan versions will fall back to `default` locale for this plugin)

## v0.4.7 2026-04-14

- [Improve the dock panel title and tooltips](https://github.com/siyuan-note/siyuan/issues/17366)

## v0.4.6 2026-03-11

- [Improve error handling and security for plugin data storage methods](https://github.com/siyuan-note/siyuan/pull/16717)

## v0.4.5 2025-12-27

- [Improve minimum version requirements for marketplace packages](https://github.com/siyuan-note/siyuan/issues/16688)

## v0.4.4 2025-12-23

- [Delete plugin data when uninstalling the plugin](https://github.com/siyuan-note/plugin-sample/pull/37)

## v0.4.3 2025-12-02

- [Add onDataChanged method to handle data changes in the plugin](https://github.com/siyuan-note/siyuan/pull/16244)

## v0.4.2 2025-08-26

- [Upgrade ESLint to 9.33.0](https://github.com/siyuan-note/plugin-sample/issues/30)
- [Adjust `addTopBar` and `addStatusBar` from `onload` lifecycle to `onLayoutReady`](https://github.com/siyuan-note/siyuan/issues/15455)

## v0.4.1 2025-07-22

- [Add plugin function `saveLayout`](https://github.com/siyuan-note/siyuan/issues/15308)

## v0.4.0 2025-04-08

- [Add plugin function `openAttributePanel`](https://github.com/siyuan-note/siyuan/issues/14276)

## v0.3.9 2025-03-04

- [Add parameter `nodeElement` to `protyleSlash.callback`](https://github.com/siyuan-note/siyuan/issues/14036)

## v0.3.8 2025-02-11

- [Add plugin util `openSetting`](https://github.com/siyuan-note/siyuan/pull/13761)
- [Add plugin method `updateProtyleToolbar`](https://github.com/siyuan-note/plugin-sample/issues/24)

## v0.3.7 2024-11-05

- [Add plugin util `platformUtils`](https://github.com/siyuan-note/siyuan/issues/12930)
- [Add plugin function `getAllEditor`](https://github.com/siyuan-note/siyuan/issues/12884)
- [Add plugin function `getModelByDockType`](https://github.com/siyuan-note/siyuan/issues/11782)
- [Replace `any` in IProtyle with the corresponding type](https://github.com/siyuan-note/petal/issues/34)
- [Add `data-id` attribute to menu button](https://github.com/siyuan-note/plugin-sample/pull/20)

## v0.3.6 2024-09-27

- [Add plugin event bus `opened-notebook` & `closed-notebook`](https://github.com/siyuan-note/siyuan/issues/11974)
- [⬆️ Bump braces from 3.0.2 to 3.0.3](https://github.com/siyuan-note/plugin-sample/pull/16)

## v0.3.5 2024-04-30

- [Add `direction` to plugin method `Setting.addItem`](https://github.com/siyuan-note/siyuan/issues/11183)

## v0.3.4 2024-02-20

- [Add plugin event bus `click-flashcard-action`](https://github.com/siyuan-note/siyuan/issues/10318)

## v0.3.3 2024-01-24

- Update dock icon class

## v0.3.2 2024-01-09

- [Add plugin `protyleOptions`](https://github.com/siyuan-note/siyuan/issues/10090)
- [Add plugin api `uninstall`](https://github.com/siyuan-note/siyuan/issues/10063)
- [Add plugin method `updateCards`](https://github.com/siyuan-note/siyuan/issues/10065)
- [Add plugin function `lockScreen`](https://github.com/siyuan-note/siyuan/issues/10063)
- [Add plugin event bus `lock-screen`](https://github.com/siyuan-note/siyuan/pull/9967)
- [Add plugin event bus `open-menu-inbox`](https://github.com/siyuan-note/siyuan/pull/9967)

## v0.3.1 2023-12-06

- [Support `Dock Plugin` and `Command Palette` on mobile](https://github.com/siyuan-note/siyuan/issues/9926)

## v0.3.0 2023-12-05

- Upgrade Siyuan to 0.9.0
- Support more platforms

## v0.2.9 2023-11-28

- [Add plugin method `openMobileFileById`](https://github.com/siyuan-note/siyuan/issues/9738)

## v0.2.8 2023-11-15

- [`resize` cannot be triggered after dragging to unpin the dock](https://github.com/siyuan-note/siyuan/issues/9640)

## v0.2.7 2023-10-31

- [Export `Constants` to plugin](https://github.com/siyuan-note/siyuan/issues/9555)
- [Add plugin `app.appId`](https://github.com/siyuan-note/siyuan/issues/9538)
- [Add plugin event bus `switch-protyle`](https://github.com/siyuan-note/siyuan/issues/9454)

## v0.2.6 2023-10-24

- [Deprecated `loaded-protyle` use `loaded-protyle-static` instead](https://github.com/siyuan-note/siyuan/issues/9468)

## v0.2.5 2023-10-10

- [Add plugin event bus `open-menu-doctree`](https://github.com/siyuan-note/siyuan/issues/9351)

## v0.2.4 2023-09-19

- Supports use in windows
- [Add plugin function `transaction`](https://github.com/siyuan-note/siyuan/issues/9172)

## v0.2.3 2023-09-05

- [Add plugin function `transaction`](https://github.com/siyuan-note/siyuan/issues/9172)
- [Plugin API add openWindow and command.globalCallback](https://github.com/siyuan-note/siyuan/issues/9032)

## v0.2.2 2023-08-29

- [Add plugin event bus `destroy-protyle`](https://github.com/siyuan-note/siyuan/issues/9033)
- [Add plugin event bus `loaded-protyle-dynamic`](https://github.com/siyuan-note/siyuan/issues/9021)

## v0.2.1 2023-08-21

- [Plugin API add getOpenedTab method](https://github.com/siyuan-note/siyuan/issues/9002)
- [Plugin API custom.fn => custom.id in openTab](https://github.com/siyuan-note/siyuan/issues/8944)

## v0.2.0 2023-08-15

- [Add plugin event bus `open-siyuan-url-plugin` and `open-siyuan-url-block`](https://github.com/siyuan-note/siyuan/pull/8927)

## v0.1.12 2023-08-01

- Upgrade siyuan to 0.7.9

## v0.1.11

- [Add `input-search` event bus to plugins](https://github.com/siyuan-note/siyuan/issues/8725)

## v0.1.10

- [Add `bind this` example for eventBus in plugins](https://github.com/siyuan-note/siyuan/issues/8668)
- [Add `open-menu-breadcrumbmore` event bus to plugins](https://github.com/siyuan-note/siyuan/issues/8666)

## v0.1.9

- [Add `open-menu-xxx` event bus for plugins](https://github.com/siyuan-note/siyuan/issues/8617)

## v0.1.8

- [Add protyleSlash to the plugin](https://github.com/siyuan-note/siyuan/issues/8599)
- [Add plugin API protyle](https://github.com/siyuan-note/siyuan/issues/8445)

## v0.1.7

- [Support build js and json](https://github.com/siyuan-note/plugin-sample/pull/8)

## v0.1.6

- add `fetchPost` example
