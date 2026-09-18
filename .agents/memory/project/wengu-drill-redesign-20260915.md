---
name: wengu-drill-redesign-20260915
description: 桌面刷题界面对稿重设计：用户点名题号栏/头部/考点chips/自评星/错题本为基准+硬约束多题长卷；OD run 06816268
    成功产出入仓 design/（sidebar-gap-list.md + wengu-sidebar-redesign.html），待用户过审拆 Issue
metadata:
    node_type: memory
    type: project
    originSessionId: sess_e634f889-91a5-4b25-a9c0-e1c9c3891d9d
---

2026-09-15 深夜轮（接 [[wengu-dispatch-20260915]] 第四轮）。用户翻设计稿逐屏点名：

**用户拍板的需求**：

- 视觉基准=稿的 ①题号栏 `.qnav`（「就很好看」）②头部统计条 `.stats` ③考点 chips `.kcaps` ④自评掌握度五星 `.selfrate` ⑤错题本 `.mistake` 整套。
- **硬约束：桌面端做题主区必须保持多题长卷，禁止稿的单题卡翻页形态**（用户原话「一定不能是单题的题卡」）。
- 新交互：①英语阅读组材料↔题目之间加**可拖分隔条**（用户修正：语义按 **antd Splitter**，不是我最初想的裸 resize 条）②**切习题必须弹二次确认**。
- 稿里两处怪要修：错题本题集名裸露「-题解」后缀、日期混用 MM-DD 与 YYYY-MM-DD。

**交付（OD run 06816268-88d0-40bb-a2bc-7d635d5c3b8e，agent=claude，~19 分钟成功）**：

- `design/sidebar-gap-list.md`（37KB）：§0 oklch→b3 令牌映射表 / §1-6 三列差距表（S/A/B/C）侧栏·题号栏·头部·题卡·错题本·材料区 / §7 新增特性规格 a-e / §8 指针。
- `design/wengu-sidebar-redesign.html`（104KB）：七区块施工稿，多题长卷形态没跑偏，带明暗切换验证钮，标签配平零问题（prettier DIRTY 与既有稿先例一致，无字面量标签问题）。
- 产物**直落仓库 design/**：项目=`fdbb75ad-e850-4431-8456-4e457d2bf63d`，用 `POST /api/import/folder {baseDir,name}` 把 design 文件夹整个导成 OD 项目（用户明确要求建项目必须指定文件夹）。文件未提交，等用户过审。

**实施进展（20260916 第一波审并合并+部署）**：

- **PR #139（#136 错题本）→ 492b8fc 合并**：单列可展开行/行头五件套/displaySetName 剥尾缀（–—连字符变体+悬停保全名）/fmtDayShort+fmtDateTime 跨年分层/清单区无滚动条；规格落 sass 真编译断言（追加在 ui/ButtonVariants.test.ts 的 sass 口径段）。一审过，零打回。
- **PR #140（#135 视觉）→ afd547b 合并（一轮打回后过）**：侧栏 280px/题号栏 64px 无滚动条/头部 46px/考点 chips（revealed 闸+无 ctx 降级 static）/自评五星 radiogroup（session `selfStars` optional 键，取消=删键）。**NPC 顺带把「≤500 行红线」落成了 CI 闸**（`scripts/check-line-limit.mjs` + `check:lines` 进五件套，EXEMPTS 豁免表=上限只许减、反向没收额度；dev 的 quiz/index.ts 实测已被养到 576 破 574 基线，此 PR 压回 574）——我打回一轮：脚本 `URL.pathname` Windows 崩（CI Linux 绿假象），NPC 以 `fileURLToPath` 修掉（`pnpm check:lines` 本机实测 480 文件全过）；同轮完成与 #139 的 i18n 尾键 rebase。stats 域被顺带接入（`searchKcapFor` 考点检索视图）属 §4.3 验收项，合理越界。
- **两区已部署**（工作/测试 `data/plugins/siyuan-plugin-wengu` 根级，新类名已验进 index.css）。
- **第二波并行在跑**：#137 切卷确认（pipeline `cnb-jjp-1k2j10fq8`）、#138 分隔条（`cnb-eao-1k2j10evd`）——两者都可能动 i18n 尾键，后合并者 rebase 合尾。
- 真机验收清单（用户）：①侧栏/题号栏/头部明暗两态（Neo）②长卷题号栏内滚无滚动条 ③错题本展开行+题集名去后缀+日期跨年 ④考点 chip 点击落统计检索 ⑤自评五星。

**挂账**：PR #133（#131 转换链修复）仍 open 待专项审查（重活，单独轮次做）；#132 复核 prompt 审计状态未查。

**入仓与派工（当晚收口）**：

- 设计文件走 PR **#134** 入仓（docs/sidebar-redesign-spec，**必须 prettier --write 后再提交**——.prettierignore 不含 design/，OD 产物直接提交必挂格式门；本地 stdin 校验要盯全量输出，tail 截断害我误判干净一次）→ merge-pull 合并 **5858654**、远端分支已删。design/ 下 `.od-skills/` 与 `*.artifact.json` 是 OD 项目脚手架，不入仓。
- 实施四单已建：**#135 刷题工作区视觉**（侧栏+题号栏+头部+题卡chips/自评星+题号栏无滚动条）、**#136 错题本重排+显示规则**——两单已召唤青简并行在跑（pipeline `cnb-jif-1k2isg92i` / `cnb-1h7-1k2isgjf6`，互斥改动面已写进评论）；**#137 切卷确认**、**#138 阅读组分隔条**（antd Splitter 语义）排队待 #135 合并后召唤（避撞 quiz/index.ts 与 cards.scss）。

下一步：审 #135/#136 的 PR（先看 CI，拉独立目录跑四件套）→ 合并后召唤 #137/#138 并行 → 真机验收（明暗两态+长卷滚动）。

相关：[[wengu-opendesign-mcp]]、[[feedback-opendesign-for-visual-compare]]
