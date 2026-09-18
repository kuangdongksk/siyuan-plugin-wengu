---
name: repo-systematic-cleanup-plan
description: 20260915 用户定：等 #105 并入后对仓库做系统性整洁度检查；六维审计单 107-112 已派 NPC 并行只读审查
metadata:
    node_type: memory
    type: project
    originSessionId: sess_a4167dd6-8d35-4de4-b4c5-62af2b92cda9
---

用户 20260915 定的整改路线：**等 #105（PR #106）并入后**，从代码整洁度、目录
结构、组件抽离、SCSS 与组件深度绑定（**非通用样式一律写入组件文件**，共享片只留
跨组件复用）、逻辑抽离、设计规范 等方面系统性检查整改。

等待期已派**六张只读审计单**（一维度一 NPC，报告=各自 Issue 下评论，不开 PR）：

- #107 代码整洁度（死代码/重复/超长/类型卫生）
- #108 目录结构（域边界/归属/结构图谱）
- #109 组件抽离（Svelte 化完成度/粒度/禁复制核查）
- #110 逻辑抽离（可测性/编排分层/测试缺口）
- #111 SCSS 绑定（选择器↔组件归属 + 迁移计划；⚠️ 动态拼 class 的 scoped 哈希失配风险要逐条评估）
- #112 设计规范（收口《温故设计规范》草案，评论交付不落库）

**后续**：审计报告齐后由人审筛选开实现单（预计同域串行分批）。
新立规：SCSS 非通用样式写入组件文件——整改时对照 [[svelte-migration-dead-selectors]]
孤儿选择器前科与动态类名 scoped 限制。相关：[[npc-first-no-browser-loop]]、[[mobile-drill-uifix-issue-105]]

**20260915 晚进展**：前置单全清——#104 已并（d2ad524）、#106 已并（de67a2a）、
#105 关 completed。**AGENTS.md 拆分已落地**（170415e 双远端）：1977→206 行，
域笔记入 `.agents/memory/` 十个模块文件 + env-debugging/kernel-pitfalls +
legacy 归档（旧 .dsh/.workbuddy 记忆迁入后删目录），根文件只留协作约定/横切
约束/数据演进守则/索引——六审计单在新结构上跑，报告齐即开整改单。

**进度（20260915 傍晚）**：六单全部有交付——#107 目录结构 ✓、#108 组件抽离 ✓、
#109 逻辑抽离 ✓（两轮，二轮为权威版：43 发现 0P0/12P1/15P2/16P3，复核纠一轮
3 错：HistoryStore 测试已存在非缺口、StepsFlow 主链有 20 用例、无测文件实为 148）；
#110 SCSS ✓；#111 设计规范草案 ✓（4 万字）；#112 首轮误做设计规范（与 111 互补
留用），已改派**代码整洁度**重召。标题错位已修（zsh 数组坑，见 cnb-npc 记忆）。
整改顺序（109 建议）：dedup P1 归拢单 → 补测试 P1 → src/index.ts+QuestionBank
拆线 → 视图重构。等 #112 报告齐后由人审定整改批次。

**审计阶段收官（20260915 晚）**：#112 代码整洁度报告到（27K 字，硬证据流——拉官方
五版主题 css + 56 片核心 scss + 252 图标全表逐条比对）。最实发现：**3 个悬空令牌**
`--b3-theme-border`/`--b3-theme-on-primary-light`/`--b3-theme-warning`（9 处，官方
全源无定义，静默失值：.wengu-input 边框整条消失）——正规令牌白名单已由该单给出
（`--b3-theme-primary-lighter/surface-lighter`、`--b3-point-shadow`、`--b3-card-*`
八全名等均为官方正规令牌，此前"需验证"标注撤销）。其余：font-size 22 档/gap 16 档/
radius 裸 px 45 处无阶梯；`variant=main` 是自造名且被用作 AI 面板选中态；触控 40px
11 处 vs ≥44px 硬口径；i18n 死键 12 + AI 会话 title 硬编码中文 25 处；超线 6 文件。
注：该单基线 d2ad524 早于 #106 并入，图标空白/移动端实心两处已被 #106 修掉。
六单全部收口关闭。**整改批次提案已给用户待拍板**：A 零语义归拢 dedup / B 补测试锁 /
C 悬空令牌 9 处（小而最实）/ D 超线拆分 / E 设计规范落库+阶梯定档 / F SCSS 迁移。

**第一波整改落地（20260915 晚）**：#113→PR#116（悬空令牌 9 行替换）、#114→PR#118
（归拢十项 + 迁 Armed 底座发现真 bug：arm() 进门先 disarm，单向 apply 会抹掉首击
武装态——修复已并入）、#115→PR#117（10 个新测试文件 2322 行，零 src 改动）三 PR
全并，dev=6ed9685，分支已删、Issue 已闭，工作区已重建部署。**第二波在途**：
#119 整改 D（index.ts 注册器化/QuestionBank 抽 BankPersist/ConvertBatch 拆类型段
+submit 拆 plan/apply）、#120 整改 E（design-spec.md 落库 + i18n 死键 12 + 会话
title 25 处）。已定夺写入规范：main=自造实心主操作变体（移动端自给）、筛选条
选中态不用 main、Button 默认值仅兜底。F（SCSS 迁移）待 #120 落库后压轴。

**插单（20260915 晚，用户实录报障）**：#123 regen 核查缺失（P1）——题卡「重新生成」
链 runRegen 全程无核查，协议「正确项写最前」+ AI 抄旧答案字母 + shuffle 信任字母
三因叠加，把干扰项洗成正确答案落盘（用户贴的轮次实录：B 旧字母→唯一特性）。修法=
regen prompt 改「选项沿用原题顺序」+ 正确项文本比对兜底 + 失配回退 verifyPrompt
自检 + 连带查 fresh-gen 洗牌后解析字母失配老病灶。#124 AI 会话面板轮次输入/输出
块一键复制（用户点名的效率需求）。两单已召；在途四 PR：#119/#120/#123/#124。

**第二波落地 + 第三波在途（20260915 深夜）**：#119→PR#121（拆分：bootstrap/Docks+
Icons、BankPersist、ConvertBatchTypes/Model，入口 512→≤500）、#120→PR#122（design-spec.md
697 行落库 12 章+例外登记表 E1~E12；i18n 死键删 11（**wordBtn 是活键**，#112 误报——
属性式访问 this.i18n.wordBtn grep 不可见）；**main 变体删除**（官方 _button.scss 无
b3-button--main，桌面死类）、默认变体 primary→outline、筛选条选中态改 wengu-chip-on；
守卫测试 dict/ButtonVariants/SpecListings 三件套上线，与 D 单试合并自验无冲突）、
#124→PR#125（轮次块级+整轮复制）。dev=4c5173f 已部署。**#126（regen 核查）与 #122
撞 RegenDialog 一行冲突已召 rebase**（坑：PR 评论用 pulls post-pull-comment，
issues 接口对 PR 号 404）。**F 已裁量为 F1 试点单 #127**：政策边界落三文档（组件独占
且无 TS 拼串触达才迁组件 <style>；TS 渲染层留共享片+登记表）+ startpanel 试点打通
css:"injected" 构建路径 + english.scss 564 拆片回红线；后续批次按 #110 纯度表
（companion→rail→aiflow→…，panels/english/base/cards 维持共享片）待试点结论再排。
