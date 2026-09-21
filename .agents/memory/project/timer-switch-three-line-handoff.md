---
name: timer-switch-three-line-handoff
description: 20260921 三线合并闭环（#178→941eb71/#179→69068f7/#181→a39d2b7）；线 C＝#182 全量实现
  已交 PR #189 并合并（c81e211，六件套双绿，快审无红线）；v6 生长式流光=14c6f55；
  旁支单/清理单待点头；用户侧存量重转
metadata:
    node_type: memory
    type: project
    originSessionId: sess_f004f2ab-7497-44df-9f19-ac310348994e
---

20260920 续作（接 .agents/plan/20260920-timer-switch-three-line-dispatch.md，方案锚点
全在那份交接件，勿重 derive）。已拍板不可改：点击即切+非焦点降亮度（悬停 3 秒已否
决）；提交即结算、结算后冻结、brief 在 await AI 前结算；mock 库不引入。

- **设计稿演进**：v5=`798aca6`（0.22 暗度体系/题卡复刻现状/边框流光 60s/圈）；用户对
  流光拍板「引线是**长出来的**不是烧完的」→ v6=**生长式**（`dasharray [s, L−s]` +
  `offset 0`，亮线从计时起点画到头部、已过段尾端锚死，一圈满框进圈重长，圈数 chip
  照旧；彗星滑段/`--stream-tail`/104px 取值表全退役），Chrome 实测 3s 长 119px＝
  60s/圈精确，**v6=`14c6f55` 已推 dev**。
- **线 A / #178**：已合并 `941eb71`，#176 已关（存量重转为用户侧遗留接受态），分支已删。
- **线 B / #179**：已合并 `69068f7`，#177 已关（收口评论记录 7 处域外旁支待另派），分支已删。
- **chore #180 / PR #181**：已合并 `a39d2b7`，#180 已关，分支已删。
- **线 C / #182 → PR #189 已交付并合并（20260921 调度轮，merge=`c81e211`）**：
  阶段一红测试（`0a8923b` 钉 R1-R8，先红后实现）+ 阶段二实现（`cba2a94`：
  QuizTimer.ts 142 行 / AnswerGate 63「提交即结算冻结」/ QTimingOwner 56 /
  FocusStream 生长式流光 242 / focus-timer.scss 147，含移动端 MobileDrill/
  MobileAnswering 逐题计时），再 merge 远端红测试 glob 口径修正（`6150790`）。
  **六件套本地+CI 双绿（2212 用例，含 pnpm build）**；`docs/question-block-contract.md`
  已同步。调度轮快审无红线：HistoryStore 仅加「结算后 sec 冻结」守卫（`if (sec > 0
&& !(hit.sec ?? 0))`，无存储格式变更）；`.cnb.yml` 仅 gate 策略注释（红测试阶段
  门禁口径成文）。#182 已关（收口评论带 sha）、分支已删。**#187（填空判分，同
  quiz 域）就此解锁，但仍闸在 #183（Jev 基建）合并后**（同域防 quiz/index.ts 撞车）。
- dev 上历次合并 CI 全绿；本地 dev 落后时用 `git merge --ff-only cnb/dev` 同步
  （工作区有未提交的设计稿改动时先问用户）。
- **复核后遗留的另派项（均未派，等用户点头）**：① 域外旁支单——`mmss(elapsedSec)`
  同缺陷类 7 处（mobile ReportScreen/DrillScreen、SwitchConfirm、stats 两处、
  ai/prompts/misc.ts、CompanionCtl），复核建议派序 mobile→SwitchConfirm→stats→
  misc→companion；② 清理单——OptGroups.sortGroups/optionPartsOfGroup 零调用孤儿 +
  OptionShuffle 整体闲置模块 + LetterRefs 出口注释计数一行订正。
- **TypeSafe 标定**（见 [[typesafe-ai-pr-claim-triage]]）：Jev 叙事声明初筛 7/7。
- **洗牌「存 id vs 派生」问答（20260921，未决策）**：用户听完洗牌机制后问「为何不多
  一个 id 字段」。已答权衡：派生 `(会话id,题id)` 用 ~20 行买断零存储/零迁移/丢字段
  窗口/多处一致四问题。更深的治本方向已摆给用户：**给选项发稳定 id、答案/解析引用
  记 id 而非字母**——可连根拔掉字母=位置耦合，但属数据契约级演进（冻结清单口径、
  双写双查、全存量迁移），须单独立项。**用户尚未决定是否立项，跟进点。**
- **OD MCP 坑已修**：~/.zcode/cli/config.json 的 open-design `args` 曾被按空格截断
  成 4 段（报 Cannot find module '/Users/sasa/Library/Application'），已改回单元素
  完整路径 + "mcp"（备份 config.json.bak-20260920），**重启 ZCode 生效**。本机无
  `zcode` CLI，MCP 配置直改 config.json。OD REST：直启 daemon-cli 绑 7456（交接件
  §四），projectId ff9b3f04-7bdf-4714-991c-637dc11ebe68，POST /api/runs
  {projectId, prompt}；prompt 要写明「覆盖产物、禁改 README、题卡复刻参照稿」，
  否则 OD 会自创样式或漏改。
- ccw 工作流 `od-ui-draft` 已建（.ccw/workflows/ + 索引，37debb0）。

**Why:** 三线全部闭环（20260921）；剩两个另派项（等点头）、用户侧存量重转、
真机手感走查（如不适另开单）。

**How to apply:** 用户点头旁支单/清理单就开 Issue 派单（内容与派序在收口评论与本
记忆里）；#187 等 #183 合并后再召唤。参见 [[jev-typesafe-integration]]、
[[plain-language-for-plans]]、[[remote-naming-per-machine]]。
