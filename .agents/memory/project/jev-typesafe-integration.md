---
name: jev-typesafe-integration
description: Jev 接入——预检落地（925e2c3）；#183 基建已交 PR #190 但评审揪出线上格式
  与实证不符（按名对象非按位数组），已召 NPC 修；#184-188 仍闸在 #183 合并后
metadata:
  node_type: memory
  type: project
  originSessionId: sess_6df0a370-a88f-401c-991a-21db9262948c
---

「Jev」= TypeSafe 平台旗舰 System One **判定模型**（不是生成式）：只回类型化判定
——noul（是/否+概率，**无置信度字段**）、choice（选项+分布+confidence）、score
（加权分+legend+confidence）。REST：`POST https://api.typesafe.ai/v1/systemone`，
Bearer key，`model: "jev-latest"`；429/529 退避、401/403=key 问题（实测无 key 返回
403 而非文档写的 401）。skill 已装 `~/.agents/skills/typesafe-ai`（ZCode 已
symlink），文档源在 docs.typesafe.ai/llms.txt。

**已落地（调度基础设施，20260921 推 dev `925e2c3`，CI 绿）**：
`.cnb/scripts/jev-pr-review.mjs`——PR 可信度预检，一次批量 7 问（总评 choice +
描述一致/夹带/存量数据红线/隐藏高危面/测试弱化 noul×5 + 工程 score），评论由
脚本按政策组装（低置信 choice<0.5 强制回落人工；CI 失败绝不红流水线）。CI 走
OpenAPI（CNB_TOKEN/CNB_PULL_REQUEST_IID 内置环境），本地走 cnb CLI（`-v` 出
`{status,data}` 包装；get-pull 分支在 `head.ref`/`base.ref` 且带 `refs/heads/`
前缀；author 是对象含 is_npc）。key：环境变量 `TYPESAFE_API_KEY`（别名
`JEV_KEY`），CI 从私有仓库 imports 注入（.cnb.yml 有注释行待用户开启），
**key 未配时 CI 静默跳过**。AGENTS.md 审查段已补用法。

**待办**：① 用户配 key（本地 export TYPESAFE_KEY；CI 私有仓库 envs.yml + 开
imports 注释行）→ 实跑校准——并行会话已做声明级标定
（[[typesafe-ai-pr-claim-triage]]：叙事声明 7/7，技术声明仍以机械复跑为锚）。
② **推荐档派单进度（20260921 两轮调度终态）**：基建 #183/PR #190 合并 `4c1bd25`；
传输契约修正 PR #197 合并 `040c2ea`（真机 403 揪出 **forwardProxy headers 只认数组**，
四条契约已沉淀 [[kernel-pitfalls]]「外部 API」节与 transport.ts 头注）。**六单全部
交付并合并**：#184 转换质检 `bb459c3`（PR #196）、#185 word 复盘 `5a79b6d`（PR #192）、
#187 填空判分 `6a4537f`（PR #193）、#188 同义词 `1980c74`（PR #191）——四单 NPC 都跑
了自查复核轮并自纠真缺陷（#187 揪出「单测全绿但真链路不通」6 处接线缺陷，端到端
回归锁收口）。**#186 切片预筛已召唤在跑**（feat/jev-chunk-screen，11:47 进队），它是
推荐档最后一单。验收硬口径全程守住：无 key 零行为变化 + mock 单测 + 冻结清单原样。
**调度教训**：直推 .md/任何入仓内容先过 `pnpm exec prettier --write`（09dfe20 迁记忆
4 文件未过 → dev 门禁红 #194）；NPC 会自己协调同批分支的格式折行防冲突。CI 预检 key
仍未启用（预检仅供参考不挡合并）；**真机冒烟**：装 key 后转换质检/复盘判档/填空判同/
同义词四落点逐一过一遍（传输契约修后才真正可用）。
③ **跨域口径（用户问过，已核实）**：渲染进程直连外部域不可靠，插件内一律走
内核 `/api/network/forwardProxy`（payload 只收 string、响应在 data.body，
3.8.2 修过 responseEncoding #18978；kernel-pitfalls.md「外部 API」节）。
可试档 C1-C5（易混推荐/remap 仲裁/stats 证据挑选/学伴台词/PR 逐条声明）
等前六单见过真判定再议。

**Why:** 用户点名「AI 转换、复习天数加 jev 检验 + jevkey 设置」，收窄为
「先装上评审 PR 可信度，再规划板块」两步交付。

**How to apply:** 实跑校准或派单时按上面状态续；无 key 一切 Jev 功能必须
静默降级（这是规划里的硬验收）。参见 [[timer-switch-three-line-handoff]]、
[[plain-language-for-plans]]。
