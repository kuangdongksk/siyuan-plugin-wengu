---
name: custom-block-question-pivot-proposal
description: 3.8.3 深化路线定盘（Tauri 废弃）——一期自定义块视图层已装机真机验证，二期块内作答、三期存储块化待拍板
metadata:
    node_type: memory
    type: project
    originSessionId: sess_5f324d95-64f3-4591-b9c3-5d7682c136ad
---

20260907 用户看 issue #8418（思源 3.8.3 自定义块）提议：自定义块渲染题目、数据用思源原生存储获得 SQL 查询；**同日拍板 [[tauri-migration-plan]] 废弃**（「优势都没了」——UI 自由度/SQL 查询/原生同步三支柱被 3.8.3 抹平）。**方向=思源深化**，三阶段路线获准。

**一期（视图层，20260907 完成并于同日从 dev revert）：** 块 `;;;siyuan-plugin-wengu/question` content=qid，渲染器 `quiz/render/CustomBlockRender` 题库取题只读渲染（fallbackQuestionHtml+KaTeX 惰性链），卡头题型徽标+「在温故中打开」（复用 index.ts 抽出的 openWenguTab）；入口=面包屑 addBreadcrumbButton（特性检测防老前端）+ `quiz/ui/PickQuestionDialog`（kramdown 原文关键词过滤、点击即插 Md2BlockDOM）。另有 addToolbarItem 编辑器工具栏「标为线索」（`flow/ToolbarClue` 跨容器挂当前题，准星图标/⌘⇧L/三态反馈）。**存储零变更**。真机验证全通（;;; 落盘往返/渲染/公式/交互/按钮 tip 均实测）。

**20260907 晚按用户要求整体 revert 出 dev（3669e76），改动单锚定在 `feat/custom-block-clue` 分支（ce2d4bd/be7b5b9/566bbee 三提交，与并行会话零文件交集可随时 cherry-pick 回任何基线）；机器 B 插件目录仍装着功能版（未回退重装）。** 配套细节随分支走：类型包 siyuan@1.2.7、addTopBar id、pnpm `minimumReleaseAge: 0`（exclude 在 lockfile 校验路径失效 pnpm#10361——**若再装新发布包必撞，分支合回时要带上**）。

**onDataChanged 一期有意不动**：3.8.3 默认（不覆盖=整插件重载）已堵多设备数据丢失；轻量重载有 UI 持引用分叉风险（words $state 深代理绑旧 cache、bank parsedCache），留三期存储重构统一设计。

**二期（待拍板）：** 块内交互作答（渲染器内作答走 BankRecording 记账）。**三期（大 pivot，二期验证后）：** 题目内容块化+统计入 IAL+题集=文档+SQL 查询+bank.json 一次性迁移（双形态读时 fallback）。三雷仍在：作答高频写撞 attributes 索引延迟+fetchSyncPost 串行；**setContent 走 Protyle 事务栈 undo 会回滚**（统计别走块内容）；数据从插件私有降级用户可碰（复制块=分叉）。机器 A 须升 3.8.3。

**踩坑（已回填 AGENTS.md 内核坑）：** createDocWithMd 必须三参分离 `{notebook, path, markdown}`，path 带笔记本名前缀=静默失败（code 0 data null 文档不落盘）；自定义块渲染容器类名 `custom-block__content`；Web 端验证插件别信 window.siyuan.plugins（不存在），查顶栏按钮 DOM。

关联 [[storage-arch-ial-vs-bank]]（三期=对该架构的反向变更，冻结清单全要重审）、[[siyuan-382-plugin-api-upgrade]]。
