---
name: wengu-md-selfcontained
description: 渲染自包含化(markdown-it替Lute+内嵌Protyle退役)已部署测试工作区未提交——并行会话同窗口交织QuizShell；markdown-it版本组合坑；块引用=查看原文链接
metadata:
    node_type: memory
    type: project
    originSessionId: sess_ae10b8bd-c0bc-47b7-a880-752687402f59
---

渲染自包含化（2026-08-30，用户拍板「去 Protyle→去 Lute→块引用=按钮」
三轮收敛）：`ui/MdRender.ts`（markdown-it）替代 window.Lute/Md2BlockDOM
读方向；ProtyleHost 退役内嵌 Protyle 轨（mount/mountOne/protyles/8s
等待/双锁只读全删），QuizShell 删 PROTYLE_INLINE_MAX 分流全量走静态
管线。**已提交 9a53a63 并推送**，部署测试工作区待用户视觉验收
（公式/表格/上下标抽卷对比）。并行会话的 TreeList 工作收编为 abb6a4a
（QuizShell/quiz.index 混合 hunk 随我的提交落盘）。

**Why:** 题卡本就 disable+锁只读，Protyle 编辑价值为零；Lute 是宿主
全局对象（window.Lute/SetInlineMath/Md2BlockDOM 壳全是真机坑源）。

**How to apply:**

- **markdown-it 版本必须 14.1.0 + @types/markdown-it 14.2.0**：14.3.1
  与 @types 组合时包内 lib 与 @types 是两套互斥声明；State/Options
  类型从 `MarkdownIt.StateInline` 命名空间限定取（node10 解析下深
  路径 import 全不可用）。
- $ 桥：tokenizer 级规则（inline+block ruler）产思源同款占位
  （inline-math span / NodeMathBlock div，data-content 带源码）→
  KaTeX 仍走 ProtyleMethod.mathRender 惰性链，零 katex 依赖。
- 段落输出定制 `<div class="p">` 与 Lute 形态对齐（CSS/剥壳零改）；
  markdown-it 的 ul/ol/table 等标准标签在 card-render.scss 补了基线。
- 块引用 `((id "text"))` 源文本级预处理→占位符→渲染后置换
  `.wengu-blockref` span，document 级委托跳转（插件入口挂/卸）。
- md 扩展语法（^上下标^/==高亮==）未装插件（考研卷场景基本都在
  $ 里），有需求再补 markdown-it-sub/sup/mark。
- IAL 残渣清理复用 BankParse.stripIal（新导出）。
