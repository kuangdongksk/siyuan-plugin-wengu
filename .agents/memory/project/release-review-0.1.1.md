---
name: release-review-0.1.1
description: 0.1.1 发布前全仓审查+0901 UI 走查收口（ade9cd0 三修+结束本次修复+单词头两行）——检查链全绿；遗留版本号拍板与 release-note 事项
metadata:
    node_type: memory
    type: project
    originSessionId: sess_a15dd7ae-4be3-459f-a7a4-3d499ad411f5
---

20260901 用户要「审核所有逻辑看能否发 0.0.1」（实为 0.1.1 首公开发布）。检查链全绿（tsc 0 错/svelte-check 0 错/eslint 干净/355 单测全过/build 成功）后，三并行 Explore 子代理深审数据持久化/AI 管线/生命周期，结论**可发布**。

**提交链（dev 分支，全部只 add 自己文件、不碰并行会话的改动，见 [[parallel-session-worktree-build]]）：**

- `775995d` 发布前 6 修：①右键菜单 eventBus.on 匿名箭头无法退订→命名方法 onOpenMenuContent + onunload 配对 off；②onunload 补 `void this.bankStore?.flush()`（2s 防抖窗口丢作答尾笔）；③顶栏 `editor?.protyle?.block?.rootID` 全可选链（移动端 protyle 可能缺）；④dock init 重入先 `wordUnmount?.()` 卸旧实例（WordTimer 泄漏）；⑤ensureMigratedFor 互斥闸 try/finally 复位；⑥物料：i18n 删孤儿键 wordImportDone、版本兜底 0.1.0→0.1.1、重写 README 中英。
- `459f071` 删纯存量迁移码（用户明言「现在就我一个人用，之前的数据迁移都不需要」）：ensureMigratedFor 删 backfillV2 全量回灌段+BankData.backfillV2 字段、WeaknessStore.migrateKnKeys、WordStore v2 告警读取。**保留**：ensureMigrated 首扫骨架（老题集首次入题库靠它，删了题集不进题库/专题/知识树）、refreshDocFor 的 seedStats/stripRuntimeAttrs（读现有块属性统计兼容，零风险）。
- `e7e2ba7` B：转换批级空产出告警——原 runFlushPrefix 只在 qs.length>0 推进，AI 某批空/不可解析时源段静默跳过仍报成功；worker 统计 emptyBatches，done 消息附 convertBatchEmpty「N 批无产出」警告，原位/另存两模式。
- `deb6e55` C：模型失效回落浮层告知——resolveModelId 原静默降级默认模型，长转换强模型被偷换无从归因；client.ts 闸口改 resolveAndNotify，notifyInfo 提示，同 id 60s 冷却防转换池连发。**依赖对方会话提交的 src/ui/Notify.ts（b84aab4 已进版本库）**。
- `1597f8a` prompt 内容筛选——用户反馈转习题带出无关内容：讲义夹的**例题及其解答、章节开头引言/导读/学习目标、章末小结/重点回顾/知识框架**三类一律跳过不转，例题整段不转。在 buildPrompt 规则 9 后插**独立「内容筛选」段**（不占格式编号 8/9/10/13、不动交叉引用），判断依据=内容性质非标题字面。**prompt 层引导非 100% 杜绝**，漏网再看解析层 extractBatchQuestions 确定性过滤。

**Why:** 生命周期审查项是思源插件发版通用暗雷面；删迁移码时 ensureMigrated 名不符实（兼首扫入库）易误删，B/C/prompt 修法都是可复用模式；避免下个会话重新发现一遍。

**How to apply:** 发版审查单：①eventBus.on 一律命名函数 onunload 配对 off；②onunload flush 所有防抖 store（本仓 QuestionBank/AiSessions 有防抖）；③getActiveEditor 全可选链；④dock/页签 init 重入先卸旧实例；⑤互斥闸 Promise 必 try/finally；⑥i18n 键对齐+版本号跟随 plugin.json+README 对齐现状。删「迁移」代码前先分清：一次性存量迁移（可删）vs 首扫入库/fresh-install 兜底（不能删）。svelte-check 与 webpack 并行跑出假阳性（竞争），串行单跑才可信。混工作区提交：git hash-object -w + update-index --cacheinfo 可只暂存同文件内自己的 hunk 剥离他人改动。相关 [[post-feature-review-checklist]] [[parallel-session-worktree-build]]。

**遗留（release note/后续版本）**：词库 v2→v3 迁移码已删，release note 需写明「0.1.x 前内测版单词进度不继承」；plugin.json 声明 mobile 全端但移动端无背单词入口；agent session 落盘文件无启动清扫；AI 失败文案是内核 msg 直拼不够友好；整卷续跑 offset 断点源文档编辑后漂移（架构债，增量哈希二期指纹分类是正解）。

**20260901 走查收口（本会话）**：浏览器 desktop 入口全面板走查（rail 五钮/刷题全链/知识/专题/AI 会话两栏/学伴/单词 dock/设置/统计）→ 提交 `ade9cd0` 走查收口三修（①解析行中 `$$…$$` 公式漏出——kramdown 段中块公式是双美元，MdRender mathInline 兼容行中双美元；②AI 会话行删除钮 visibility 仍占位截断标题→display:none+左栏 320px；③单词面板头部挤压）——rail 那处修复被并行会话 b84aab4 顺带提交。另修「结束本次无反应」（报告宿主移卷首+endRound 重写+空轮 notifyInfo）与单词头**两行定稿**（用户反馈），均已 ade9cd0 之前并入该提交。词头音标自带 ECDICT 已装机回验**未提交**（见 [[word-phonetics-ecdict]]）。**版本号拍板仍悬**：用户口称 0.0.1 但 plugin.json/CHANGELOG 已是 0.1.1（git 里 v0.x tag 是上游模板的），按 0.1.1 发需用户点头。

**20260901 追加（ade9cd0 之后，均未提交）**：「查相关题」弹窗大放大镜修复——svgIcon 输出无宽高、裸插 `.wengu-muted` 按替换元素默认尺寸铺满弹窗；panels.scss 中央图标尺寸表补三漏网（.wengu-muted/.wengu-meta/.wengu-annobar-btn），design-review §〇 第 3 条立规矩（新容器加规则统一进中央表），用户点名「约束文档要防住这类低级错误」（详见 [[ui-consistency-feedback]] 第十五条）。**当前未提交集 = 音标自带（9 文件+3 新增）+ 图标修复（panels.scss/§〇/AGENTS/CHANGELOG）**，用户逐批「提交吧」节奏、未发话不提交。
