---
name: tauri-migration-plan
description: Tauri 平迁：20260907 晨判废弃、当晚用户重新打开（温故 UI 自绘度高平移成本低）——与三期存储块化互斥，最终方向待拍板
metadata:
    node_type: memory
    type: project
    originSessionId: sess_5a2d9cd4-b23e-4c17-b9bf-d59d529fb452
---

**状态（20260907 晚）：用户重新打开讨论，未定。** 晨间判废弃（用户「优势都没了」——3.8.3 自定义块/attributes 索引/原生同步抹平能力差距）；当晚用户反驳：「如果是 html 实现的话 Tauri 还是有点必要」——**温故 UI 自绘度极高**（quiz/word/stats/AI 面板全 Svelte 自绘、20260830 起渲染甩 Lute 改 markdown-it+KaTeX），思源依赖只剩四样：UI 宿主（页签/dock/Dialog 壳）、b3- 主题变量、AI 通道（agent/chat 内核藏 key）、存储同步。废弃判断只抹平「能力差距」未抹平「自主性差距」（AI 直连自由/SQLite 规模/无版本耦合）。**关键：三期存储块化是单向门**——数据嵌进思源块后再迁 Tauri 要先写块→SQLite 导出器；反之 bank.json→SQLite 导出器百来行。真正分岔=三期动不动手（375 题离万级预警远，不急）。自定义块一期两路通用不白做。方案文档 [[custom-block-question-pivot-proposal]] 的 M0~M6 资产清单仍有效，「数据全新起步」可改为写导出器迁存量。

以下为历史方案存档：

2026-09-04 用户提出把温故插件转成自己的 Tauri 应用，**完全脱离思源**。计划已草拟（ExitPlanMode 被拒未批），方向与口径如下：

**用户拍板的口径：** 完全脱离思源；输入=markdown 文件夹 / PDF / Word；存储=SQLite + S3；数据全新起步（不迁存量）；完整平迁当前全部功能。

**两个默认口径（用户未细定，我按最合理推断）：** 编辑器走只读渲染 + 直接 KaTeX（用户提「思源开源 markdown 编辑器」但探查发现插件 20260830 已甩掉 Lute 改 markdown-it，且题目内容本就只读无手编——不需要 WYSIWYG，这恰是「完整平迁」的忠实口径）；S3 放源材料原件（PDF/Word/markdown + 图片 + 听音音频），跨设备同步留后续。

**SiYuan 耦合六点（全替换）：** ①`siyuan` 包导入（Plugin/openTab/Dialog/showMessage/fetchSyncPost/ProtyleMethod）②内核工厂 src/siyuan/（17 个 EApi 端点）③saveData 十店（ai-sessions/bank/companion-chat/history/know-hash/quiz/route-cache/settings/weakness/words + 词书文件 data/wengu/wordbooks）④AI client.ts（思源 agent/chat→直连供应商）⑤块 IAL（题块非块，BankRecord kramdown 契约直存 SQLite）⑥输入摄取（思源文档树→md/PDF/Word）。

**纯逻辑直搬资产（零 SiYuan 依赖）：** BankParse/BankRecording/BankRegen/KnowLinkText/KnowTrees/KnowledgeNorm、OptionShuffle/QuestionDraft/SetWriter/SrcChunk、quiz/flow/* 与 quiz/render/_（除 CardState 借 ProtyleHost）、companion/rules/_、ui/MdRender.ts、ts-fsrs/echarts、全部 Svelte 组件。

**冻结不变量必须原样带走（数据级）：** questionHash 及归一、WordBook.wordKey、kramdown 题目契约、SrcChunk.srcKey 格式、KnowledgeNorm.knKey。attrs.ts 属性名→SQLite 列/JSON 字段名。SiYuan「字段只加不改名/版本闩」守则由正经 SQLite migration 取代。

**分期：** M0 脚手架+host shim+SQLite 骨架；M1 题库+刷题主流程（CardState→ProtyleHost 是暗雷）；M2 转换+AI 通道（client.ts 签名不变换内部、agentChatContinued 历史回放自建）；M3 单词域；M4 复习+统计+错题；M5 知识树+专题+AI 会话面板+看板娘；M6 收尾打包。M1+M2=可用核心闭环，估算 6–10 周全量。

**架构：** Tauri 窗口 + Svelte5/vite 前端（src/host/ shim + src/store/ 存储层 + src/ingest/ 摄取层）+ Rust 后端（sqlx SQLite、aws-sdk-s3、pdf-extract/docx-rs、AI 代理转发藏 key）。

**20260907 进展与方向冲突：** 计划文档已落仓 docs/tauri-migration.md（随 bd03097 拉取，另一机器提交）；同日用户另提议走 3.8.3 自定义块把题目数据更深嵌入思源原生存储（[[custom-block-question-pivot-proposal]]）——**两方向互斥**（块化后再迁 Tauri 需先写「思源块→SQLite」导出器，成本更高），已明示用户须二选一，待表态。

**关系：** 与 [[storage-arch-ial-vs-bank]]（思源存储两级演进）方向不冲突——题库即唯一真相的模型直接落 SQLite；与 [[product-decisions]] 的「思源原生路线」决策有张力，但 Tauri 化是更高阶决策（用户 0904 明示）。**Why:** 用户要从插件作者转为独立应用作者。**How to apply:** 批准后按 M0 起步，纯逻辑模块原样搬只换存储介质；保留冻结不变量算法一字不改。
