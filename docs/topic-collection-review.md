# 专题补全设计审核（wengu/topic，2026-08-25）

## 〇、范围与结论

用户选定方向：修断链①~③ + 生成侧补全④ + 小项清理⑤。**不做「专题文档化」**
（专题仍留插件 storage，不落思源文档、不进反链图谱）。

现状锚点（证据，均指 dev@7cd8ed5）：

| #   | 断点                                                                      | 位置                                                             |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| ①   | 专题作答会话误归属到自动选中的无关文档；专题轮次清空展示（写了读不回）    | QuizView.ts:127-132、QuizLoader.ts:108-115、QuizView.ts:282-284  |
| ②   | col 模式 materials 取自无关文档；材料组题降级独立题、材料面板空挂         | QuizLoader.ts:131、ProtyleHost.mountStatic 不填 [data-mprotyle]  |
| ③   | removeFromCollection 零调用（专题不可编辑）；删除无确认；创建后不自动切换 | QuestionBank.ts:315-321、CollectionDialog.ts:112-116、124-135    |
| ④   | 「收集成专题」只收已有题，无「按知识点 AI 补题」路径                      | CollectionDialog.ts、WeakDrill.ts 生成管线未复用                 |
| ⑤   | 薄弱加练标题硬编码中文；kpRefs 双解析器；CHANGELOG 停 v0.1.0              | WeakDrill.ts:112、BankParse.ts:137-145 vs WeaknessStore.ts:66-75 |

## 一、A：专题会话域 id（修①）

**核心：会话的 `docId` 字段在专题模式下落 `col:<collectionId>`，文档模式不变。**

- **A1 归属改写**：`DrillViewAccess.docIdOf()`（QuizView 实现，仅 beginDrillFor 一个消费者）
  在 col 模式返回 `` `col:${colFlow.id()}` ``。`startRound` 里 `docId: ctx.docId`
  （StartPanel.ts:264）随之落对地方；其余 docId 语义（侧栏选中、材料、prefs）不动。
- **A2 专题轮次可见**：QuizView.load 的 col 分支改为
  `rounds = history.docSessions("col:" + colId)`（替换现在的 `rounds = []`）。
  「继续上次」「只刷错题」读 rounds（StartPanel.ts:246-259），在专题里自动生效
  ——顺带修掉「写了读不回」。
- **A3 重开恢复**：`WenguPrefsIo` 加 `colId?`；persistPrefs 存 `colFlow.id()`；
  启动 load 前恢复（直接内部 set，不走 switchTo 避免 reload 递归）。docId 仍按
  现规则自动选中（作为「回文档模式」的落点），但会话不再落它头上。
- **A4 统计隔离**：`docSessions`/StatsPanel 文档页签按 docId 精确匹配，`col:` 前缀
  不命中任何文档（已核 StatsPanel.ts:150-157）；统计总览（allSessions）包含专题
  练习量——视为合理口径。col 模式下 `docTotalSec` 置 0（不挂无关文档累计）。
- **A5 历史遗留**：已被污染的旧会话（混在文档 docId 里的专题轮次）不做自动甄别
  迁移，保留原样。

## 二、B：专题材料并集（修②）

- **B1 数据来源**：col 分支装 materials——对专题题目记录按 `sourceDocId` 去重
  （gen- 题为空串跳过），逐文档 `listMaterials` + `resolveGroupPlaceholders` 按
  qid patch group 占位（手法同 QuizLoader.ts:116-127），合并成并集。块 id 全局
  唯一，跨文档不会串组。
- **B2 静态渲染**：`mountStatic(root, list)` 加 `materials` 参数，补填
  `[data-mprotyle]` 材料面板（`mdFragmentHtml(bodyMd)` + `renderMath`）。组单元
  壳 `renderUnitsHtml`/`bindGroupUnits` 本就无 col 分支，实现时验证即可。
- **B3 gen- 题**：无 group、无材料依赖，自然走独立题卡。

## 三、C：专题可编辑 + 创建即切换（修③）

- **C1 展开**：已有专题行加展开钮（svgIcon iconRight/iconDown），列出该专题题目
  （`questionsOf` → stem 截 60 字，尾注来源卷名），每题 × 移除
  （`removeFromCollection`，API 现成）。
- **C2 两击确认**：删专题/移除单题统一两击——第一次点变红色「确认」态，3s 未复点
  自动复原；不引入新弹窗（siyuan 包未导出 confirm，已核 types）。
- **C3 编辑生效**：移除/删除后刷新对话框与侧栏；若被编辑专题正活跃，触发视图重载
  （CollectionDialogDeps 加 `onEdited(colId)`，colFlow 活跃时 reloadFromCollection）。
- **C4 创建即切换**：`createCollection` 成功 → `dialog.destroy()` + `onSelect(row.id)`
  （与点行切换同款行为）。
- **C5 死代码**：`questionFromRecord`（QuestionBank.ts:472-474）删除。

## 四、D：知识点补题（④）

- **D1 共用生成核**：WeakDrill 的 `generateOne` 抽到新文件 `src/wengu/GenQuestion.ts`，
  知识点参数改为 `{key, title, wrong?, topCause?, aiNote?}`（缺省字段 prompt 相应行
  省略）；WeakDrill 改调用，行为不变（薄弱场景字段齐全，prompt 等价）。
- **D2 bank API**：加 `appendQidToCollection(colId, qid)`（按 id）；WeakDrill 用的
  按 title 的 `appendToCollection`/`addGenerated` 保持不动（兼容）。
- **D3 入口**：CollectionDialog 新增「收集并补题」按钮 + 模式（变式/概念）与目标
  题数（1~10，默认 5）控件；流程：`collectQids` 收已有 → `createCollection` →
  逐勾选知识点按缺口生成（attempt 上限 3×，单题超时/自检同 GEN_TIMEOUT_MS）→
  `appendQidToCollection` → flush → onSelect 切过去。状态行复用 drill-status 样式。
- **D4 模式可用性**：变式需该点 ≥1 入库题（收集场景默认满足）；概念需 `kp:` 键
  （sectionKramdown 要块 id），`kn:`/`ch:` 键自动降级变式并在状态行提示一次。
- **D5 反链**：生成题 kpRefs 沿用 `injectKnowledgeRefs` 注入；`kn:`/`ch:` 无块 id
  → refs 为空，与现状一致。

## 五、E：小项（⑤）

- **E1** 薄弱加练标题 i18n：新键 `drillColTitle`「薄弱加练·{m}.{d}」（en 同款），
  `fmt` 插值；`drillDone` 文案同步显示实际标题。
- **E2** kpRefs 解析合一：BankParse 导出 `parseKpRefs(md)`（现 137-145 行正则+去重），
  WeaknessStore.weakKeys 改调用，删重复正则。
- **E3** CHANGELOG 增补 v0.1.1（未发布）：bank/专题/知识点反链/右键反查/薄弱加练/
  本次专题补全。
- **E4** docs/question-block-contract.md 同步 A~D 行为变更（AGENTS 硬性要求）。

## 六、界面规范遵循

图标全 `svgIcon` 禁 emoji；新控件走 FormHtml 行样式与既有 `wengu-col-row` 类；
文案全 i18n，zh-CN/en 同步加键。

## 七、实施顺序与验证

1. E2（解析合一）→ A → B → C → D → E1/E3/E4（文档同步）
2. 每步过 `pnpm exec tsc --noEmit && eslint && prettier --write . && build`，
   单文件 ≤500 行红线
3. 真机清单：专题开刷→收卷→文档模式统计不受污染、专题轮次可见可续；材料组在专题
   分栏渲染；对话框移除单题/两击删除；创建即切换；补题小批量生成落专题

## 八、定夺记录（2026-08-25，均按建议项执行）

1. **A5 旧污染会话**：✅ 保留原样，不做自动甄别迁移，也不加清理入口。
2. **D3 补题量**：✅ 默认 5、单次上限 10（GEN_MAX_PER_RUN=10，串行 AI）。
3. **C1 展开列表**：✅ 平铺 + 尾注来源卷名（` · 卷名` 后缀）。
4. **C4 创建即切换**：✅ 创建/补题完成即销毁对话框并 onSelect 切换（与点行一致）。
