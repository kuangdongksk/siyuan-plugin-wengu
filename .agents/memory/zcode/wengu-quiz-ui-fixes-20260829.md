---
name: wengu-quiz-ui-fixes-20260829
description: 20260829 用户逐条反馈的四项修复——题号栏实测封顶/思路描边/内嵌Protyle只读配方/失效modelId总闸，均部署机器A
metadata:
  node_type: memory
  type: project
  originSessionId: sess_8a00cdab-55b5-42a0-aa4b-6cc731105b45
---

2026-08-29 一轮用户真机反馈驱动的四项修复，全部已部署机器 A（对方会话
脏文件在飞期间，构建均走干净 worktree）：

- **题号栏占满可视高**（定稿 52aa786，四轮迭代）：NumRail.applyHeights
  实测写 `--wengu-nums-max` = scroller.clientHeight − 吸顶头下缘 − 主区
  padding-bottom − 栏 margin-bottom，滚动帧内零开销重测随窗口缩放自愈；
  间距全由布局表达（见 [[feedback-spacing-from-layout]]）。
- **「思路」开关描边**（fcd5ad9）：.wengu-thought-toggle 由 ghost
  （border:0+无底色）补 1px b3-theme-border + b3-theme-surface，与
  .wengu-num/.wengu-input 同族。
- **内嵌 Protyle 选项锁只读**（07a0007）：3.8.1 前端源码核实（装机位置
  见 [[wengu-kernel-extra-traps]]）——Wysiwyg 构造桌面端无条件
  contenteditable="true"，`protyle.disable()` 只置内部标志不翻属性；
  修复 = ProtyleHost.mountOne 里构造后与装载完成各刷一遍
  `contenteditable="false"` + `data-readonly="true"`（思源 agent chat
  body 同款配方），点击作答/文本选择不受影响。
- **失效 modelId 总闸校正**（33c84fe）：agentChat 入口统一
  `ai/models.resolveModelId`——不在当前可用清单（被删/停用/旧格式）回落
  默认模型、默认也无效则省略 model 让内核自决，覆盖学伴/判分/转换/题库/
  单词全部调用点。根因：3.8.1 模型 id 为内核生成时戳格式，删配置即永久
  失效，激活学伴档案存了已删模型；内核对未知 id 一律报「请先参考用户
  指南 [人工智能] 章节进行配置」。排查法：读 `conf/conf.json` ai 段 +
  curl 直探 saveSession→chat 可快速分辨内核/插件侧。已回填 AGENTS.md。

**Why:** 四项全是真机反馈；题号栏四轮证明猜值路线不可行，后两项是
3.8.1 前端/内核行为坑（repo 的 AGENTS.md 与代码注释已记细节）。

**How to apply:** 「差几像素」「能编辑」「报配置错误」类反馈先查这四个
修复点是否回归；新挂内嵌 Protyle 一律套 lockWysiwyg 双属性配方；AI 报
配置错先怀疑存量失效 modelId。push 积压已于 20260829 随 b205197 补推清空。
