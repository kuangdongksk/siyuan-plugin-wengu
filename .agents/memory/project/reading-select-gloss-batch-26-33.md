---
name: reading-select-gloss-batch-26-33
description: 20260911 滑选/排版/词条批次（#26~#33）全合并装机：拖选解锁=宿主 .layout-tab-container
    user-select、词表 @@G 行协议、待真机走查三批
metadata:
    node_type: memory
    type: project
    originSessionId: sess_fa8916aa-4b62-4fa1-af1a-face57737667
---

20260911 阅读体验批次（CNB 调度，一天内 #26→#33 全收口，见 [[reply-with-pr-issue-links]]）：

- **拖选失效根因（#26→PR#27）**：思源壳层 `base.css` 的 `.layout-tab-container{user-select:none}` 盖住一切自定义页签（Protyle 自己覆盖、插件没有）——AnnoFlow 浮条靠 selectionchange，选区起不来整链死。修=根容器 `.wengu-panel` 只声明一次 `text` + 控件面收窄。**CSS 级联两铁律（#32 补漏定稿）**：①根上禁写 `.wengu-panel *` 毯子 text（每后代显式 text 压过控件继承的 none，按钮内文字 9 处泄漏）；②收窄必须盖后代（button 的 none 只管自己那格）。Svelte onclick 是 property 赋值不落 DOM 属性，`[onclick]` 选择器全空。段距=card-render 基线表漏 `.p`（`div.p` 无默认 margin 是对齐 Lute 的刻意设计）。
- **滑选标注重设计（#28→PR#29/#31）**：可标区域两态（组题=材料面板/非组题=题干），浮条按锚点分流；高亮唯一后处理 `refreshClueMarkFor`（三时机幂等，定位=文本节点级子串匹配宁缺勿错）；chips 两击删除；**长卷全卡常驻→chip/复核归属题必须按卡 `data-qid` 反查**（`ClueMark.clueOwnerQid`），写 currentQuestion 会删错题/判错题。复核输入组题=材料、非组题=题干（prompt 只换措辞）。SKIP 两处理互不嵌套（gloss span 与 clue mark 互跳过）。
- **词条保真（#30→PR#33）**：考研真相形态「词 ^{记号} 音标 释义」。落库行协议 `@@G 词 | 音标 | 释义`（@@ 同族、竖线分隔防冒号雷、材料 bodyMd 不进 questionHash）。AI 只搬运（GLOSS_RULE 只在英语题型段），代码兜底 foldGlossIntoDrafts（AI 词表优先、单材料才补、`^{...}` 落库前剥净）；渲染 GlossDom 词表样式+正文词形精确匹配首现包下划线序号（不做词干还原）；MdRender 加 kramSup 规则兜字面 `^{补}`。undefined 全量兜底=英语约定本就含词条段（与题型化前语义一致，NPC 文档化）。
- **同日复审修复 PR #34/#35 已审合并（21d2b56/bc22c6b），合并态 tsc+754 测试绿、dev CI success、重新构建装机（思源关机态部署冷启动自载）**：
    - #34（fix/clue-mark-render，修本批真机缺陷）：①chips 不渲染根因=**chips 槽本身就是 `[data-clues]` 行元素**，旧 renderClueRow 按容器语义再找后代永远 null 静默早退；②高亮落隔壁词根因=归一串（留折叠空格）与 indexMap（只记非空白）两套坐标错位，改 `normWithMap` 一次扫描同源产出；③组内共享槽刷新加 `isGroupCurrent` 守卫（运行态优先、DOM 兜底、读不到不拦）；④「标为线索」按选段起点卡反查（滚动跟踪滞后会挂上一题）。
    - #35（fix/gloss-hardening）：①`^{...}` 处理避开数学/代码区间（`protectedSpans`，剥除与采集共用 `eachMark` 一条扫描链），数学卷 `$x^{2}$` 不再被剥成公式丢指数；②多篇材料一律不兜底补词表（`mats.length===1` 才补防串篇）+ `isConfidentEntry` 置信判据（带音标或词性标签才算真词条，滤数学伪词条）；③GlossDom 落格改 `assignHitsToNodes` 一次性映射+**按下标倒序施工**（正向 splitText 会把同节点后续命中挤出界=只有首词形高亮）；④连字符算词边界（`funding-based` 命中 `funding`）。
    - **⚠️ 审查坑（实证）：NPC force-push 后 PR 的 CI success 挂在被丢弃的旧 head sha 上**（#34 CI=f0201eb、head=82cf595，#35 同款；旧 sha 本地 bad object）——本地四件套必须实跑补验证，别拿 PR 页 CI 绿当数。孤儿分支 feat/anno-redesign=同一修复的旧基线（#33 前）首推，逐文件核对被重推版完全覆盖后删。
- **待真机走查**：①拖选+段距 ②滑选重设计（政治/语文题干标注、两击删除、恢复高亮；#34 修后 chips 应能渲染、英文多词选段高亮不再错位）③控件面无文字可选+词条联动（需含词条行源文重转换验证；#35 修后数学卷上标不被剥）。
- 调度节奏沉淀：NPC（deepseek）会后自行复审已并 PR 开补漏 PR（#31/#32/#34/#35 均自抓），审查时同类 handler 多入口要逐个核；CNB PR head sha 轮询格式见会话。
