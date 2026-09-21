---
name: jev-typesafe-integration
description:
    Jev 接入——推荐档六单全合并；20260921 用户推翻「不登记 AI 会话」决策，
    #201 会话可见性在飞；下一步真机冒烟
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
回归锁收口）。**#186 切片预筛**：首版 PR #200 合并 `355ac3b`，但**那笔合并只含原始实现 `85964c6`
——复核轮的修复提交（14:38）晚于合并动作（14:17），没进 dev**；NPC 复核轮已揪出两处
真缺陷（预筛结论按 key 归并致「空白片与真跳过交叉错配」、无 key 时 A3 反而删旧题+重转），
**补修 PR #203（分支 `fix/jev-screen-order`）**。⚠️ 教训：**NPC 的自查复核修复若与合并
动作并发，可能整批落在合并之后**——审查方合并前应确认 PR head 是否已含最后一次推送
（比对 `head.sha`），别只看首次 CI 绿。三处口径
偏离均为事实修正随合并采纳：A3 输入用旧题代表旧内容（旧源文未留存只存指纹，
补存=动冻结面）、A3 阈值方向刻意保守（不确定=实质=多转，Issue 需求 2 原文）、
整卷链按窗口问（窗口集合事前不存在，合纪律 5）。
**20260921 用户确认维持两口径**：A3 拿不准（低置信/缺值/失败）一律重出（错误代价
不对称——误重出只费钱、误保留污染题库，勿再翻案）；A2 三条同时满足才跳、拿不准照常
出题（漏出题只是少题不出错题）。
⚠️ **与 #203 补修的分界线**（别混）：A3 的「无 key / 总开关关」闸按**能力**判（挂
`refine` 前问 `isJevEnabled`），**不按判定结果判**——`key 已配但调用失败/缺值` 仍当实质
重出（上条已确认口径）。见 `.agents/memory/convert.md` 同名小节。**下一步＝真机冒烟**：装 key
逐一过 转换质检/复盘判档/填空判同/同义词/切片预筛 五落点（传输契约修后才真正
可用）；可试档 C1-C5 等冒烟反馈再议。验收硬口径全程守住：无 key 零行为变化 + mock 单测 + 冻结清单原样。
**调度教训**：直推 .md/任何入仓内容先过 `pnpm exec prettier --write`（09dfe20 迁记忆
4 文件未过 → dev 门禁红 #194）；NPC 会自己协调同批分支的格式折行防冲突。CI 预检 key
仍未启用（预检仅供参考不挡合并）；**真机冒烟**：装 key 后转换质检/复盘判档/填空判同/
同义词四落点逐一过一遍（传输契约修后才真正可用）。
③ **AI 会话可见性（20260921 用户点名，推翻 #183「不登记 AI 会话面板」决策）**：
Issue #201 已开单召唤（feat/jev-session-track）——六落点 `judgeJev` 按登记簿
begin/succeed/fail 落 `jev` 类别记录（KIND_KEYS 加 `aiKindJev`；
`SessionDetail.retryable` 必须排除 jev——重试走 agentChatContinued 是生成式
专属；**在途闸红线不动**；登记簿 schema 零新增）；`client.ts` 头注红线第一条
随 PR 改写。冒烟时面板可见性一并验收。
④ **跨域口径（用户问过，已核实）**：渲染进程直连外部域不可靠，插件内一律走
内核 `/api/network/forwardProxy`（payload 只收 string、响应在 data.body，
3.8.2 修过 responseEncoding #18978；kernel-pitfalls.md「外部 API」节）。
可试档 C1-C5（易混推荐/remap 仲裁/stats 证据挑选/学伴台词/PR 逐条声明）
等前六单见过真判定再议。

**Why:** 用户点名「AI 转换、复习天数加 jev 检验 + jevkey 设置」，收窄为
「先装上评审 PR 可信度，再规划板块」两步交付。

**How to apply:** 实跑校准或派单时按上面状态续；无 key 一切 Jev 功能必须
静默降级（这是规划里的硬验收）。参见 [[timer-switch-three-line-handoff]]、
[[plain-language-for-plans]]。
