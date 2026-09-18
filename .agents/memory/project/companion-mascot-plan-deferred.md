---
name: companion-mascot-plan-deferred
description: AI 伴学看板娘（companion 域）已实施三轮（20260827）——三栏格局（rail 工作区导航）+多套学伴配置+自定义 prompt/形象图片/模型，含架构速查与踩坑
metadata:
    node_type: memory
    type: project
    originSessionId: sess_0d4f0739-5f8b-4e5a-98a4-bc96ff328576
---

2026-08-27 AI 伴学看板娘「团子」三轮迭代均落地装机（远端 dev 链：3ec8a71 三栏+看板娘 / a5889ff AI 并发 / 7a73abb rail 漏拼修复 / cfd8db2 formRow 撑满父宽）。第一轮：域+双宿主+三层能力；第二轮：**多套学伴配置**（用户点名「语文老师、数学老师」式切换）——每套 profile 独立 {id/name/prompt/imageDir/modelId}；第三轮：温故页签改成三栏格局（rail 左栏 44px 四图标钮）+ 三个管理面板（CompanionPanel / CollectionPanel / KnowledgePanel）。

架构速查（改伴学功能先看这里）：

- 通道定案：统一走智能体 `agentChatOnce`（**独立 sessionID 并发通道**：AgentClient 里 saveSession→chat→removeSession 全自动，撤掉了串行队列，20260827 改造提交 a5889ff）；直答端点 `/api/ai/chatGPT` 留给一次性判断（AiJudge/ConvertDetect 不动）——用户拍板「直答端点适合判断，是一次性的」
- **agent/chat 并发解锁已实测并接入**（20260827 三轮探针）：不传 sessionID 时全局互斥（后到者 busy）；锁按 sessionID 键控——`saveSession {id:"{14位时间戳}-{7位字母数字}", revision:0, entries:[{id,type:"user",content}]}` 落盘后 chat 带独立 sessionID 双路零 busy（AGENTS.md 内核坑有完整配方；removeSession 防落盘堆积已内置 agentChatOnce finally）
- src/companion/：index.ts（initCompanion/attachCompanion 双宿主/notify* 帮手）、CompanionCtl（规则层+AI 节流 45s/activeProfile 取 prompt/模型/图目）、Images.ts（自定义形象：工作区目录下按文件名匹配表情 happy.png/开心.png，候选名×扩展名 GET 探测，未命中回退内置 SVG；URL 逐段 encodeURIComponent）、Expressions（9 表情+ALIASES+normalize+SVG 面部）、Lines（4 人设×12 事件兜底台词，硬编码中文）、Prompt（**personaDesc 参数注入**——profile.prompt 优先，表情枚举协议锁定不可覆盖）、comp/*.svelte、CompanionPanel.ts（**学伴管理工作区面板**，从 ui/CompanionSettings.ts 整体迁来）
- 事件接线：quiz 收口=QuizView.recordAnswer、整卷=roundComplete、词卡=WordView.finishCard、单词收工=advanceAfterFinish done 分支；quiz 宿主=renderList 尾 attachCompanion（层未断开跳过）、word 宿主=WordApp.svelte 内嵌；$state 必须组件顶层声明（闭包传参报 state_invalid_placement）
- 设置：全局 companionEnabled/companionAi/companionPersona（兜底台词风格）+ companionProfiles/companionActiveId；SettingsDialog 伴学 tab 已瘦身只剩两开关（原 CompanionSettings.ts 已删）
- 500 行对冲：quiz/DocOps.ts、quiz/ModeOps.ts+ViewBindings.toggleSideTreeFor、word/GroupFlow.ts+CardOps.ts、WordStart.makeStartCtl、bank/BankMigrate.ts（refreshDocFor/ensureMigratedFor 整迁）；红线当前 quiz/index.ts 491、QuestionBank 468、WordView 499
- 三栏格局（第三轮）：温故页签最左 `.wengu-rail` 四钮（刷题/学伴/专题/知识文档），QuizView.workspace 字段 prefs 持久化，renderQuizShellFor 早退 WorkspaceShell 分发；管理面板 CompanionPanel（设置页伴学 tab 瘦身为两开关）/CollectionPanel（新增 renameCollection+删除联动清 col: 会话）/KnowledgePanel（collectKpRefs+kpRootMap+knowledgeIndex 推「被题目挂住的知识文档」，无持久注册表）

**踩坑（必看）：**

- **rail HTML 拼接坑**（提交 7a73abb 修复）：四路渲染（复习/工作区/错误兜底/CompanionPanel）都拼了 renderRailHtml，**唯独 QuizShell 刷题分支漏拼**——结果重开页签落进 quiz 工作区时左栏消失，bindRailFor 也无效；改完后刷题分支拼 + 绑定即可，**新增渲染路径都得拼 rail**
- **formRow 撑满父宽坑**（提交 cfd8db2→b4a426e 两步修复）：`.wengu-formrow` 需 `.b3-label.wengu-formrow{ display:flex !important; width:100%; box-sizing:border-box }`——①主题运行时注入的 .b3-label 同特异性会覆盖，要复合选择器抬到 0,2,0；②主题 .b3-label 有 24px 水平 padding，content-box 下 width:100% 右溢 48px 必须 border-box
- **.fn__flex-1 零基宽坑**（提交 1a7eac8）：主题定义 `{flex:1;min-width:.1px}`，formRow 横排里 width:100% 的 textarea 会把标题格挤成 0 宽、内容竖排堆出 707px 高竖条——大文本域用堆叠块 .wengu-cp-stack（标签在上控件占满在下）不走横排；textarea 还需内联 height:auto 否则主题固定行高 26px
- **「没撑满」观感真凶**：.wengu-ws-page/.wengu-ws-editor 的 max-width 已放开（6011ee9），面板占满主区
- **petal 重载不刷新已开浏览器页签的 JS/DOM**：旧模块继续渲染旧结构但新 CSS 全局生效 → 「改一半生效」假象；IAB 验证新代码必须先 tab.reload() 硬刷新
- CompanionPanel 全局区（启用开关/AI/人设下拉）从底部挪到顶部（标题下方），避免与 per-profile 编辑区割裂
- 已知边界：设置结构变化在单词 dock 侧要重开面板生效；图片探测 9 表情并行×(3 名×6 扩展) 上限 ~162 个静态 GET

**IAB 浏览器实测**（20260827 更正）：早前结论「Web 端裸奔无法验证」是错的——**入口要用 `/stage/build/desktop/`**（`/stage/build/app/` 在浏览器永远卡 loading 罩）；desktop 入口完整可用，rail 按钮 playwright click 偶发超时改用 evaluate 取中心坐标 + `tab.cua.click({x,y})` 点。这比让用户贴 DOM 慢但能拿 computed style 定位根因（本轮三个布局根因全是这么钉死的）。

相关：[[siyuan-api-patterns]]、[[word-card-bubble-flip]]（companion 层 pointer-events:none 已从根上避同类冒泡）
