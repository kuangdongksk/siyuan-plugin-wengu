---
name: wengu-opt-compact-branch
description: opt-compact 分支——短选项紧凑排布（Lute 剥壳+估宽分档一行2/4个），已部署机器A待验收；Lute 段落真机形态探针结论
metadata:
    node_type: memory
    type: project
    originSessionId: sess_5eab66a4-4dac-4b5f-a04d-a42ab10bdb17
---

短选项紧凑排布 opt-compact（20260829）：用户反馈数学短公式选项（π/6 等）每个独占一行太浪费。分支 `opt-compact`（工作树 `D:/code/siyuan/wengu-optcompact`，基于 dev 8056ffc），提交 a99b547（设计文档 docs/option-compact-layout.md）+ 695c90f（实现）+ ca29bcd（验收返修两连），已部署机器A已重载 petal，**待用户重开题库页签验收（Neo 主题）**。

验收返修（ca29bcd，用户反馈「还是可以编辑」+选项旁泄漏 updated= 属性文本）：① `luteToHtml` 单点剥 `contenteditable="true"`——Md2BlockDOM 输出本是编辑器 DOM，静态全链路（题干/选项/解析/材料/steps）此前都可点出光标编辑；文字仍可选中（标为线索不受影响）。② BankParse IAL 残渣——思源 kramdown **读回**时列表项首段子块 IAL 行内尾随（题库落盘实测 `- {: id="…" updated="…"}A. …`）、条目自身 IAL 缩进独立成行、块引用子块 IAL 带 `>` 前缀，BankParse 只认无前缀整行 part IAL，残渣全混进选项 md 渲染成 `"updated=…"}A.` 字面泄漏；splitParts 现按 IAL_LINE（整行删）/IAL_INLINE（行内片段删）清理，题库每次装载从落盘 kramdown 重解析（parsedCache 实例级、重载即清），**存量数据重载即愈无需迁移**。诊断法：题库落盘在 data/storage/petal/siyuan-plugin-wengu/bank（无扩展名单文件），SQL markdown 字段无 IAL 可排除文档侧。

方案（用户拍板「按推荐来」=方案 C）：内容渲染保留 Lute 不自写渲染器，`unwrapSingleBlock` 把 Md2BlockDOM 段落剥成内联 HTML（KaTeX 惰性链零改动），`estimateOptWidth` 估宽分档（公式段定值 8/全角 2/半角 1；s≤10 一行 4 个 25%、m≤24 一行 2 个 50%、其余整行；flex-basis 减 column-gap 份额+wrap 兜底，估偏大=安全侧）。接线：optionRowHtml+.wengu-opts（静态/降级/复习）、steps/cloze 按钮（column→row wrap）、match 候选池。**文档模式 ol 多列未做**（设计 □4 二期：counter+`:has` 跨列）。挂账：阈值 10/24 与公式定值 8 是拍的初值，用户截图后可能要调。

关键铁证（已写进 AGENTS.md）：3.8.1 `Md2BlockDOM` 段落输出= `<div … class="p"><div contenteditable="true">正文</div><div class="protyle-attr">…</div></div>`——正文藏在 contenteditable 壳里+尾部 protyle-attr，朴素取 innerHTML 会漏块级壳。探针方法：node vm 沙箱跑思源自带 `resources/stage/protyle/js/lute/lute.min.js`（上下文注入 console/TextDecoder/TextEncoder/setTimeout；该版无 SetMathBlock）。单测 stub 按此形态（optionCompact.test.ts，与 ProtyleHost.test.ts 分文件隔离 sharedLute 模块缓存）。

**Why:** 剥壳形态若与真机漂移→静默退整行（无档类、不破版），但布局目标失效；探针结论防止下次再踩。kramdown 读回 IAL 形态是「写通道正确≠读通道干净」的双面坑。
**How to apply:** 调阈值只动 ProtyleHost 的 OPT_W_S/OPT_W_M 与 types.ts 公式定值 8；动文档模式 ol 前先读设计文档 □4 风险；解析 kramdown 新路径必须过 IAL 残渣清理（BankParse IAL_LINE/IAL_INLINE）。相关 [[wengu-quiz-ui-fixes-20260829]] [[wengu-kernel-extra-traps]]。
