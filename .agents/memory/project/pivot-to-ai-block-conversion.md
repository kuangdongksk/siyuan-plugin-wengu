---
name: pivot-to-ai-block-conversion
description: 用户调整方向：输入（MinerU 解析）后移，插件先定题目块契约，由思源 AI 把笔记块转成题目块
metadata:
    node_type: memory
    type: project
    originSessionId: sess_3bdb5d2e-1541-4791-98ce-e871f3905338
---

2026-08-21 用户调整方向：暂不做 MinerU 解析器（原 M1 后移），插件先定义「题目块契约」——需要 AI 打的参数，由思源 AI 把笔记块转换成带属性的题目块；转换完成（容器块带 `custom-plugin-wengu-q=1`）后，插件在 dock 面板切「素材 ↔ 刷题」模式即可开始刷题。契约权威文档在仓库 `docs/question-block-contract.md`，代码同源 `src/wengu/attrs.ts` + `types.ts`。分支 `dev`，首个提交 d0d9fe4。

**How to apply:** 继续按契约驱动：读取侧用 `/api/query/sql` 检测 `q=1` 的块；train 前先核对 `docs/question-block-contract.md`。MinerU 解析器待未来按需接入，勿默认重启解析优先路线。相关：[[product-decisions]]、[[work-rules-siyuan-plugin]]。

2026-08-21 补充——思源内置 AI 插件无法主动调用（见 [[siyuan-api-patterns]]），AI 转块必须由用户在思源 AI 界面手动触发。若需要"插件一键全自动转块"，插件须自行直连外部 LLM（OpenAI 兼容端点），并需向用户确认 `dataEgress`/`externalCost` 副作用与模型配置。已向用户提议补一份"AI 转换提示词模板"文档（把契约转成人话、AI 界面粘贴即用），未获明确答复。

2026-08-21 补充——UI 架构决策（用户拍板"打开新页签"）：**弃用 dock**，改顶栏「温故」按钮 → `openTab` 自定义页签（`addTab` 注册，见 [[siyuan-api-patterns]]）。页签内由 `src/wengu/QuizView.ts` 渲染两态：题目列表 ↔ 单题答题；客观题（single/multiple/judge/fill）输入自动判分并写回属性（attempts/last-answer/right），大题（brief）走自由输入。契约 + 读取 + 判分已落代码，提交 2f57e92（dev 分支）。

用户示例结构（《高数篇-填空-题解》，`### 习题N` 题干 + `#### 答案` 解析 + `____` 空位 + LaTeX）可直接套 `type=fill` + `answer` 契约。已部署到真实思源 `工作/data/plugins/siyuan-plugin-wengu/`（见 [[siyuan-data-location]]）。

**待办（下一步按需选）**：① 用户在思源 AI 里先转换一道题，验证「列表出现 + 答题判分」闭环；② 契约 → "AI 转换提示词模板"文档；③ M1/M2 解析器/导入仍后置。

2026-08-21 **架构转向：弃「属性优先」改「块优先」**。我把题型做成了"属性优先"（容器块 + 一串 `custom-*` 属性，答案=属性字符串，题干/选项/解析是没人读的子块），用户明确评判："我觉的这些设计都不行"。落差点是：选项/题干/解析在实现里没有"走法"；答案塞进属性字符串；答题被迫放进插件自建页签 UI。

**新方向（块优先）**：一道题 = 文档里的一组自然块，一切在思源编辑器内发生，插件只读块。结构：题干块 → 选项块 → 「我的答案」块（空，用户在文档里直接打字）→ 答案块 → 解析块。每块一个属性只做标记（容器块 `q=1`；子块 `part=mine/answer/solution`）。**不做插件答案 UI**，答题 = 用户在编辑器里往 mine 块打字 + 点"判分本题"；答案块用 CSS 选择器隐藏/模糊，答完解锁。判分规则不变（选择比字母、多选比串、判断比 √/×、填空比可接受串），只是比较对象从属性字符串换成块文本。这样绕开了"向编辑器注入 DOM 输入框"的脆弱点。

**Why:** 用户指出属性字符串存客观答案 + 子块不参与计算 == 答案/选项/解析没有真实走法，答题 UI 只好外包给页签。块优先让答案、选项天然是块（可编辑、可被 AI 转换），多子块归一个 `q=1` 容器 = 一道题，判分只比两个文本块。
**How to apply:** 重构时：契约文档 `docs/question-block-contract.md` 需从属性驱动改写成块驱动（`custom-plugin-wengu-q` 仍作容器标记，`part` 标记 mine/answer/solution 子块）；读取与判分改为读子块文本而非属性字符串；用 CSS 按属性选择器隐藏答案块。此前基于"属性优先"的 `attrs.ts`/`types.ts`/`QuizView`（页签答题）都是过渡物，可能被替换或改造。

**已提两个待用户拍板的问题（未答复）**：① 作答手感——"就地在文档里打字到 mine 块" vs "答题卡式点选（仍需页签渲染容器块内容）"；② 用户说"都不行"是否还有契约（依赖 AI 转换 / 属性过多 / 闪卡统计方式）之外的不满。

2026-08-21 用户拍板「块-页签」混合方案，核心是**如何在新页签里渲染/解析原文**：**一个页签渲染一整个文档的全部题目**，容器用**超级块**（`{{{...}}}`），答案用**引述块**（`> ...`），样式都用思源自带类名（`b3-*` 主题变量），不自己瞎写。渲染原料是子块的 `markdown`，走全局 Lute → `ProtyleMethod`（见 [[siyuan-api-patterns]]）。

2026-08-21 **已落地提交 40dc7c7（dev）**：

- 契约改块优先（`docs/question-block-contract.md`）：一道题 = 一个超级块容器（`custom-plugin-wengu-q=1`）+ 子块 `part` 标记（`stem`/`option-*`/`mine`/`answer`/`solution`）；**答案落在 `answer` 子块文本，不再塞属性字符串**。
- `types.ts` 扩展 `stemMd/optionMd/solutionMd`；`QuestionService.hydrate()` 用 `getChildBlocks` 取子块、按 `part` 属性归类；`QuizView` 页签渲染整篇题目为卡片，题干/选项走 Lute + `ProtyleMethod.mathRender/highlightRender`，答案/解析子块判分前不渲染。
- 顶栏按钮用 `getActiveEditor()` 记当前文档 id，页签渲染该文档。
- 结构地在真实思源上实测：API token 直连内核，验证了容器块 `q` 命中、`part` 属性、`getChildBlocks`/`getBlockKramdown`。tsc/eslint/build 全绿。

**待办（下一步按需选）**：① 在思源里重载插件实测页签渲染（`dist` 块优先版尚未重新部署到运行目录）；② 契约 → "AI 转换提示词模板"文档；③ M1/M2 解析器/导入仍后置。

2026-08-24 **重要：远端 dev 已远超本机本地认知**（两台机器并行开发，见 [[git-remote-push]]）。origin/dev 现含大量后端（机器 B 推）已有功能：背单词 dock/复习、AI 转换渐进式呈现、PDF 一键导入、错题闪卡、多步引导题等。**该 memory 中"块优先契约"是早期本机实现，远端在 40dc7c7 之后重构了 `src/wengu/`（拆出 CardHtml/ConvertService/QuizLoader/WordBook 等 30+ 模块，QuestionService 已含 option-0/1 容忍 + steps 步进题聚合 + normalizeAnswerMd）。** 在远端代码上继续开发时，先以 origin/dev 现状为准，本 memory 的历史（dock 弃用/块优先/Lute 渲染）多为已落地事实，不必重复实现。

2026-08-25 机器 B 已 `git pull` 同步到 d6712d5——**全分支合流完成**：wengu/pdf-import（MinerU PDF 导入+原位替换）、wengu/english（E0-E4：材料组分栏/完形逐空/翻译作文 AI 判卷/生词联动）、wengu/ai-gen（题库数据化①~⑥：薄弱画像/插件题库/对账/重生成/右键反查/针对性生成）全部并入 dev，无游离特性分支。装机时 pnpm 顺手补装了新依赖 `fflate`（pdf-import 引入）。

2026-08-26 **仓库分域重构 + 内核工厂迁移**（用户指令：「主文件组织方式不太好，按功能分文件夹，不要导出文件，index 是入口文件」+「顺带借鉴 sy-lively 的目录组织」）：78 个平铺 `src/wengu/*` 全部 git mv 到七域——`src/siyuan`（内核 API 工厂：api.ts EApi 枚举 + KernelBlock/KernelDoc/KernelNotebook，迁自 sy-lively 构建工厂 + attrs.ts 契约常量）、`quiz`（index=QuizView）、`convert`（index=转换编排）、`review`、`word`（index=WordView，词库数据随域放 word/data/）、`stats`、`bank`（index=专题编排）、`ui`（FormHtml/KnowPicker/SettingsDialog/shared.ts=旧 ui.ts）；共享类型上提 `src/types.ts`；302 处导入脚本重写。**各域 index.ts 必须是入口编排代码、禁纯 re-export barrel**（用户明确要求）；新增内核调用先走工厂。同日落盘改 appendBlock 增量追加（详见 [[convert-pipeline-pending]]）。**⚠ 当日 106 个路径改动全部未提交**（含此前页化/选择器等），已建议用户提交一版；机器 B 已装机重载。
