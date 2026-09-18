---
name: prompts-centralization-type-scoped-gen
description: 20260910 prompt 集中收口 src/ai/prompts/ 八件套 + 生题 prompt 题型化（检测 TYPES
    行顺带报题型、按题型裁剪规则）；两笔 8debc7d/d676148 已装机
metadata:
    node_type: memory
    type: project
    originSessionId: sess_4c1ae6bc-9d29-4e79-8e65-c8da8a68daca
---

用户需求「专门一个地方管 prompt」+「生题先判断有哪些题型再给 prompt」，20260910 落地。计划期 AskUserQuestion 三问未获答，按推荐执行（代码内集中 / AI 检测自动裁剪 / 26 处一步搬迁）。两笔提交已装机（md5 对账 + petal 重载），检查链全绿 503 测试。

**第一笔 8debc7d —— 纯搬迁零行为变化**

- 全仓 26 处 prompt 构建点（原散在 convert 4 文件/bank 3/quiz 2/word/stats/companion 共 10 文件）搬进新建 `src/ai/prompts/`（无 index.ts 沿 ai/ 惯例），八文件按场景：
    - common：CAUSE_LIST 错因枚举、SINGLE_Q_NOTE 单题输出约束句（逐字共用）
    - protocol：protocolSpec 自 convert/service/QuestionDraft 迁入（**bank→convert 跨域 import 层级倒挂顺带消解**）
    - convert：buildPrompt+STEPS_EXAMPLE+detectWindowPrompt+buildOutlinePrompt（自 ConvertService/ConvertDetect/KnowOutline）
    - route：章/小节 × 单批/批量四联 + knowRule/knowListBlock 插槽；**路由上限常量 MAX_HIT_CHAPTERS/MAX_SECTIONS 随 prompt 落此，KnowledgeLink 反向引用**（原深层 import 消除）
    - gen：concept/variant/verify/Regen/freeTag 五件（自 GenQuestion/RegenDialog/TagDialog，verify 拆成 verifyPrompt(kd)）
    - judge：AiJudge 七件 + wrongCausesPrompt + 轮报分析 + **byBaseQid 自 RoundReport 迁入**（RoundReportApp.svelte 改直连 prompts/judge；RoundReport 删两函数、恢复 baseQid import）
    - misc：wordReviewPrompt+buildStatsPrompt（自 WordAi/StatsService）
    - companion：companion/rules/Prompt.ts 整体迁入（含 SessionProfile/UserProfile/ChatTurn/ExplainCtx 类型、plainOf/clampText/parseExprReply），测试随迁 companion.test.ts，ChatStore/CompanionCtl/companion/index 改 import，旧目录删除
- 文本逐字照搬（git diff 对账 buildPrompt/protocolSpec 逐字节）；编排逻辑（分块/路由/genFromVerify/收卷）原地；ConvertService 剩为 内核原语+判定解析
- bank domain 迁移 33 处消耗零行为：gen/Regen 的 protocolSpec import 改走 prompts

**第二笔 d676148 —— 生题 prompt 题型化**

- 检测窗口 prompt（ai/prompts/convert.detectWindowPrompt）加 `TYPES: 中文题型逗号分隔` 行；ConvertDetect.parseTypes（normalizeType 中英别名容错、空白去重、分段并集）；DetectResult 增 `types?`
- 题型注册表（protocol.ts）：`protocolSpec(types?)` / `typeRulesFor(types?)` / `materialRulesFor(types?)`——**types=undefined 全量兜底输出与改造前逐字节一致**（回退语义=旧行为）；给定题型时 ans 约定/step/slot 部件/英语四类约定/材料示例缩写
- buildPrompt 规则 1/7（英语约定段）按在场题型拼装；**主观题恒含 brief**（漏检 NEIGHBOR 降级兜底）；「填空转选择→single」「大题拆多步→steps」开关产出题型恒在不受检测影响
- `BankSets.setTypeUnion(setId)` 题集既有记录题型并集（normalizeType(record.type)，零 AI）；续跑（ConvertBatch resume 分支）跳过检测用题集先验、增量（ConvertIncrement）直接吃题集先验；检测失败/先验空 → undefined 全量兜底
- 单题场景钉死：concept 恒 [single,judge]；variant 传原题 record.type（知识变式）或 kramdown 里 容器 type 属性（generateVariantOf）；RegenDialog 传 q.type（WenguQuestion.type=QuestionType）
- 完成消息多行「题型：单选、填空…」（convertTypeList i18n 键 zh/en 新增；ConvertBatch 本地 TYPE_I18N 映射枚举→i18n 键）
- 测试：ConvertDetect.test 加 parseTypes（中英混用/去重/无行=空）；ConvertService.test 加 3 条题型裁剪（数学卷无英语约定+材料组示例收成「阅读文章等共用语篇」、英语在场带 slot/范文、开关追加类型次序 single/fill/brief/steps）

装机：扁平布局拷 dist/index.js|css+i18n 到插件目录（md5 对账一致），setPetalEnabled 重载成功，bundle grep「TYPES: 」/convertTypeList 特征在；minify 会把中文转 \uXXXX（用 ASCII 特征 grep）。

相关：[[convert-return-protocol-plan]]（行协议来源，本改造未动协议本体）、[[review-cleanup-20260909]]（上一轮全仓审查收口，本轮在其后执行）。
