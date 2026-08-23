# 任务书：背单词作答计时 + AI 重排复习间隔

> 写给实施本功能的会话。设计已与用户逐条确认（见「已拍板决策」），
> 勿重新讨论；实施中遇到与本文冲突的事实，停下问用户。

## 背景与现状

* 单词复习现为纯本地 Leitner：`WordStore.applyGrade` + 
  `INTERVAL_DAYS = [1,2,4,8,16,32]`，档位只由「对错/自评档」驱动，
  **作答耗时信号被完全丢弃**——秒答对与犹豫十秒后答对拿到同一档位。
* `WordAi.ts` 已有误认词批量 AI 分析管线可复用/扩展：
  `enqueue` 串行队列（内核 `/api/ai/agent/chat` 全局互斥，见 AGENTS.md）、
  `BATCH_SIZE = 20` 多批顺序、W/T/D 三行回复协议、
  `applyAiPlan` 落盘覆盖到期时间（现 clamp 1-30 天）。
* 答题交互全部经 `WordBind.ts` 的 `WordBindHost` 回调
  （option/grade/reveal/submitSpell/continueObjective），
  host 实现在 `WordView.ts`——**该文件 479 行，逼近 500 行硬上限**。

## 已拍板决策（用户确认，勿改）

1. 停留时长是熟悉度信号：秒答对 vs 犹豫后答对，后者不应升档。
2. 计时只累计**可见**时间：`visibilitychange`/窗口隐藏时暂停累计
   （切应用、最小化不冤枉——技术上检测得到）；可见状态下的超时
   （走神，无法与深度思考区分）**按「忘记」处理**。用户原话的自愈
   逻辑：真忘了，下次记得就会直接点，档位很快回来；假装记得的
   （没看词乱点），被打回重见，恰好被抓住。这是不对称错误设计：
   误伤成本一次重见，漏抓成本假熟词流进长间隔。
3. 刷卡**不等待 AI**：Leitner 照常即时出结果；AI 重排异步批量
   触发，**一步继续**——组完成直接刷下一组，AI 在背后跑，
   落盘后从下一组起生效（组边界用本地算法即时重建队列）。
4. AI 输出**锚定规则**，不凭空给天数：「秒答对→维持或升一档；
   犹豫但对→不升档；犹豫且错、或超时→回 1-2 天」，在 Leitner
   档位表内挪（`applyAiPlan` 的 clamp 从 1-30 天收紧为相邻档约束）。
5. 按题型归一化基线：spell/choice/learn/recall 的合理耗时不同
   （拼写题 15 秒正常，看词选义 15 秒即犹豫）；每词存最近 N 次
   （建议 5 次）作答记录 `{mode, ms, over}`，趋势进 prompt。
6. **每组单词数量**：新设置项（默认 10，范围 5~20，存插件数据）。
   组 = 刷卡流里连续 N 张卡（不区分词源）。组完成即后台触发
   一次 AI 批量分析（该组的对错/停留/自述混淆整体发送）；本地
   调度与组边界重建队列**不依赖 AI 结果**，AI 只修正后续复习
   时间——用户原话：算法及时算出该复习哪个词，AI 组后判断一次。
   AI 调用走既有 `enqueue` 串行队列：刷得快时前一组未返回，
   后一组完成直接排队即可（各组数据独立，不合并）；组大小超过
   WordAi 单批上限时自动分批（`BATCH_SIZE` 多批已支持）。

## 改动点

* **新文件 `src/wengu/WordTiming.ts`**：计时器（卡片进入 prompt 态
  启动、作答回调结算、可见性暂停、超时阈值判定）+ 题型基线表与
  归一化。`WordView.ts` 只做最少接线——它已 479 行，超限就再拆。
* `WordStore.ts`：`WenguWordProgress` 增计时段（如 
  `timing: Record<string, {mode, ms, over}[]>`）；`get()` 里按现有
  模式做旧数据回填（无字段补空对象）；批改路径与计时器对接
  （超时 → 等同 grade "no"）。
* `WordAi.ts`：主通道改为**组完成自动触发**（决策 6）：该组全部
  作答数据整体发送；误认词的辨析提示（T 行）并入同一调用；
  现有手动按钮保留作兜底（组外遗留误认词/失败重试）；
  `buildPrompt` 带停留时长/题型/答错历史；回复协议与
  `applyAiPlan` 按决策 4 改档位制。
* 组边界逻辑（建议放 `WordTiming.ts` 或独立小文件）：计数到组大小
  → 触发 AI（不弹窗不等待）→ 重建队列（`buildQueue` 本地毫秒级）
  → 下一组继续；设置项「每组单词数」放起点设置面板
  （`WordStart.ts`，注意 dev 已删掉「每日新词」行，别复用其键名）。
* i18n `src/i18n/{zh-CN,en}.json` 同步新文案（设置行、可选的
  「本组 n/N」轻量指示——不做重进度条，勿过度设计）。
* 单词功能不涉及文档块，`docs/question-block-contract.md` 不用动。

## 硬约束

* 仓库内单文件 ≤500 行；图标用 `FormHtml.svgIcon` 禁 emoji；
  表单统一 FormHtml 行样式（docs/design-review.md §〇）。
* 内核 agent/chat 并发互斥：所有 AI 调用必须过 `enqueue` 串行队列。
* `fetchSyncPost` 串行（AGENTS.md 内核坑）。

## 验证与部署

1. `npx tsc --noEmit && npx eslint src --ext .ts && npx dprint fmt && npm run build`
2. 部署按 AGENTS.md「通用调试流程」：dist/index.js + dist/index.css
   + i18n 拷 `D:/data/思源/工作/data/plugins/siyuan-plugin-wengu/`，
   setPetalEnabled 禁→启重载，让用户重开背单词页签验证。
3. ⚠️ 装机目录 2026-08-23 22:09 被 wengu/pdf-import 会话部署的旧版
   占据（含已废弃的 dailyNew 每日 20 上限 + MinerU 导入）。本分支
   部署会覆盖它——部署前先与用户确认 pdf-import 真机验证是否已停。

## 验收标准

* 秒答/犹豫/超时三条路径本地批改正确（超时按「忘记」档处理）；
* 思源窗口切走/最小化期间时间不累计；
* **组完成一步继续**：不弹等待、不打断，下一组立即可刷；
  AI 结果落盘后下一组起吃到重排；
* AI 批量重排落盘的天数受 Leitner 相邻档约束；
* 刷卡全程无 AI 等待（组触发的分析与现有 WordAi 手动按钮共用
  串行队列，互不吞响应）。
