# AGENTS.md — 温故插件开发与调试备忘

给 AI 编码代理的项目说明。**调试环境按机器区分**，两台机器各自一节，
在别的机器上先确认本节路径/端口/token 再动手，并回填缺失信息。

## 工作流（2026-09-10 起）：云端开发，本地只调度 —— 最高优先级约定

**本项目所有业务代码改动一律在 CNB 上由 NPC 完成，本地不再直接改代码。**

| 角色                    | 在哪       | 职责                                                                 |
| ----------------------- | ---------- | -------------------------------------------------------------------- |
| 飒飒 + 本地青简         | 本地       | 审查代码与 PR、出方案 / 设计稿、开 Issue、召唤 NPC、跟踪流水线、合并 |
| 云端 NPC（青简 / 复核） | CNB 流水线 | 拉 `dev` 分支实现、写测试、跑自检、开 PR                             |

标准流转：

```
本地出方案 → 开 Issue（附文件路径 + 可验证的验收标准）
          → 评论召唤 NPC（必须勾「替我上班」）
          → NPC 基于 dev 拉分支实现、开 PR（base 必须是 dev）
          → 本地审查（拉分支到独立目录独立验证，不信自述）
          → 合并进 dev
```

- **NPC 并行口径：同域串行、异域可并行**（20260913 修订，替代原「一次只跑
  一个」）：并发数不设硬上限，按**改动面交集**定 —— 要动同一片代码、或要在
  本文件同一段落追加笔记的任务排队串行（后合并者冲突时在 PR 评论召唤 NPC
  rebase）；改动面不相交的任务可同时召唤并行跑（git 按区域合并，不同段落
  各自追加能自动合并）。判断依据是文件的交集，不是 NPC 的数量。
- **例外（仍属「调度」范畴，本地可直接改并推送 `dev`）**：`.cnb/`、`.cnb.yml`、
  本文件的协作约定段 —— 它们是 NPC 运行所依赖的**调度基础设施**。
  **业务代码（`src/`、`tests/`、`docs/` 正式文档）没有例外，一律走云端。**
- **CI 已替你做机械检查**（20260910 落地）：`.cnb.yml` 的 `$` 节点下配了
  `quality-gate`，`push` 与 `pull_request` 都自动跑「格式 → eslint →
  svelte-check → 测试」四件套（由快到慢，尽早失败）。审查 PR 时**先看 CI 结论**；
  只有要复现失败、或怀疑它动了四件套覆盖不到的地方，才在独立目录重跑。
  ⚠️ 四件套**不含 webpack 打包** —— 动了入口 / 依赖 / `webpack*.js` 时本地补一次
  `pnpm build`。
- **审查 NPC 的 PR 时不要只信它的自述**：要重跑就拉分支到独立目录（如
  `git worktree add /tmp/wengu-review <branch>`），跑 `pnpm test`、
  `pnpm check:svelte`、`pnpm format:check`，eslint 一律用
  **`pnpm exec eslint .`（不带 `--fix`）** 对齐 CI 口径。
  ⚠️ 本地 `pnpm lint` 是 `eslint . --fix`，**会就地改文件** —— 别在正在开发的
  工作区跑。CI 里刻意不用它：`--fix` 会把违规直接改掉再退出 0，门禁形同虚设。
- 只读操作（看代码、查内核 API、跑只读 SQL）不受此限，随时可做。

## 分支与协作（CNB + NPC）——动代码前先读

双远端：`origin` = GitHub（历史存档），`cnb` = CNB（云原生构建，NPC 开发在这边跑）。
CNB 仓库：<https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu>

- **`dev` 是长期开发分支，`main` 只作稳定发布分支。拉分支、提 PR、合并，
  三处都必须是 `dev`。**
- **CNB 仓库的默认分支必须始终保持为 `dev`。** NPC 事件
  （`issue.comment@npc`）的流水线固定跑在「仓库默认分支」下——默认分支一旦
  是 main，NPC 就会拿 main 当基线写代码。
- **建仓时的正确姿势（20260910 实测）**：CNB 建仓库时**不要勾选任何初始化**
  （README / .gitignore 都不建），得到一个空仓库；首个推送的 `dev` 会自动
  成为默认分支，`get-head` 直接返回 `dev`，无需手改。反之，若建仓时初始化过，
  默认分支会固定为 `main`，而 **CNB OpenAPI 不提供修改默认分支的接口**
  （`PATCH /{repo}` 只能改简介/站点/许可证，git 模块只有 `get-head`），
  只能去网页改（仓库页 → 设置 → 默认分支）。
- 开工基线：`git fetch cnb && git checkout -b <type>/<slug> cnb/dev`，
  分支名用 `feat/` `fix/` `refactor/` `docs/` `chore/` 前缀。
- PR 的 base 一律 `dev`，描述里带 `Ref: #<Issue 编号>`。
- **合并后清理闭环**（20260913 用户定）：PR 合并即**关关联 Issue**（先留一句
  收口评论带 merge sha）、**删远端功能分支**——仓库常态只留 `dev` 与在办分支。
  调度轮收尾必做，别攒账；在办（NPC 正在跑）的 Issue 不动。
- 禁止直接向 `dev` / `main` 推送，一切改动走 PR。**唯一例外**：本地改「调度
  基础设施」（`.cnb/`、`.cnb.yml`、本节协作约定）时可直接推 `dev`，见上一节。
- NPC 角色与硬约束写在 `.cnb/settings.yml`；Issue 模板在
  `.cnb/ISSUE_TEMPLATE/`（两者都从**默认分支**读取）。
- **模型与推理档位**在仓库根 `.cnb.yml` 的 `npc:go.options` 里配（`settings.yml`
  没有 model 字段）：`$` 兜底 `deepseek-v4.1-flash`，「复核」角色覆盖为
  `glm-5.3-flash`。改完要实跑一次，用
  `cnb build get-build-ai-audit --sn <sn> --pipelineId <sn>-001` 核对
  `models{}` 里的 key 是不是写对的那个 —— ID 写错会让流水线直接失败。
- **`.cnb.yml` 里严禁新增 `dev:` 顶层节点**（20260910 查文档确认）：分支匹配是
  「**分支级独占**」而非「事件级回落」—— 系统先做 glob 匹配，**只有未命中 glob 的
  分支才走 `$` 兜底**。两个 NPC 事件都挂在 `$` 下且都跑在 dev 上
  （`issue.comment@npc` 用默认分支、`pull_request.comment@npc` 用 PR 目标分支），
  一旦加了 `dev:`，dev 就不再走 `$` → **召唤 NPC 毫无反应且不报任何错**，极难排查。
  所以 `quality-gate` 也配在 `$` 下与 NPC 事件共存。顶层另两个合法语义：分支 glob
  （按触发分支匹配）、角色名（与 `.cnb/settings.yml` 的 `npc.roles[].name` 逐字一致
  时才加载，与 `$` 合并、同名事件覆盖）。
- **召唤青简必须写完整路径且顶格**：`@sasa1107/open-source/si-yuan/siyuan-plugin-wengu(青简)`。
  裸 `@青简` 不会触发任何流水线（20260910 实测），系统内置的才写 `@CodeBuddy`；
  提及**必须顶格**——放在引用块（行首 `> `）里的提及同样不触发（20260913 实测：
  #59 首召落在引用块，零流水线零报错；顶格重发 1 秒内触发）。
- 要让它真的写代码，评论时必须开 **「替我上班」**（API：`post-issue-comment --work-mode`）。
  不开只有读权限，`npc.work_mode` 会是 `false`。

## 项目速览

- SiYuan 插件「温故（wengu）」：笔记文档 → AI 转习题 → 页签刷题。
- 源码 `src/` **按功能分域**（2026-08-26 重构，组织方式借鉴 sy-lively）。
- **各域 `index.ts` 必须是该域的入口编排代码，禁止纯 re-export barrel**；
  共享类型在 `src/types.ts`，样式 `src/scss/` 分片。
- **域笔记在 `.agents/memory/`（20260915 起，按模块拆分）**：改哪个域先读
  对应模块文件，口径与本文档同权威——
  `quiz`（做题主流程）/ `mobile`（移动端刷题）/ `convert`（AI 转换）/
  `bank`（题库与知识文档）/ `ai`（AI 基础设施与会话面板）/ `word` / `siyuan`
  （内核工厂）/ `companion` / `ui` / `stats`；环境与机器坑在 `env-debugging`，
  内核坑在 `kernel-pitfalls`，早期 agent 记忆归档在 `legacy/`（仅考古勿作依据）。
  索引见 `.agents/memory/README.md`。

### 通用横切约束

- **Svelte 渐进迁移**（2026-08-27 起，全仓 UI 分六批迁 Svelte 5）：模式样板/暗雷清单/
  路线图见 `docs/svelte-migration.md`（各域开工前必读）。已迁：word 域、companion
  看板娘+管理面板、bank 工作区面板（专题/知识文档）、review 错题本主区、stats 统计面板、
  convert 两弹窗、quiz 6-1~6-3（开刷面板/轮次报告/rail/题号栏）、6-4a 题卡渲染层
  （三类题卡+材料组壳逐单元 mount）、6-4b 作答态收敛（三写统一进卡内 CardUi 响应态）、
  6-5 侧栏/头部壳（SidePanelApp/QuizHeadApp，2026-08-31，quiz 域收官）。
  **样式绑定自 20260915 改规（整改 F1 #127）**：组件独占、无 TS 拼串触达、
  不跨组件复用的样式 → **写进组件 `<style>`**（`css:"injected"` 运行时注入，
  不落 `dist/index.css`）；TS 渲染层产物 / 跨组件共享 / 移动基座 → **留共享片
  并登记**。**权威口径＝`docs/design-spec.md` §十三**（含绑定登记表 + 试点
  结论 + `:global()` 四条硬约束），旧口径「组件零 `<style>`」已作废。
  类名与迁移前逐字一致（DOM 零变化）；新域挂载一律用 `ui/mountApp.ts`。
- **界面规范唯一权威落点＝`docs/design-spec.md`**（整改 E #120 收口成文，20260915；
  令牌全名白名单 / 按钮层级 / 字号·间距·圆角阶梯 / 表单构件 / 弹窗浮层 / 图标
  （含 sprite 合法 id 清单）/ 移动端专属 / 文案与 i18n / 例外登记表 / 与主题对抗 /
  结构红线 / 整页不滚动 / 样式绑定（§十三，整改 F1 #127 起））。
  **改任何 UI 前先读它**；`docs/design-review.md §〇`
  保留作历史审查清单（条款已上收 design-spec，不删）。两条最常犯的：图标一律
  `FormHtml.svgIcon`（禁 emoji 字符，排版符号 `→ · 「」` 豁免）；表单统一 FormHtml
  行样式。
- **硬性约束：仓库内单文件 ≤500 行**（src/quiz/index.ts 基线豁免 574 行——20260826
  预览改版至 20260903 聚合/组链修复持续增长，访问器表+编排职责外移破坏内聚，改动它
  前后注意别再净增；见迁移文档 6-5 节与 20260903 审查。豁免＝上限，越线照算违规；
  生成数据文件 `src/word/data/**` 豁免）。
- **整页不滚动**（Issue #96，2026-09-15 起硬性规范，见 `docs/design-spec.md` §12
  / `docs/design-review.md` §〇 第 11 条）：面板高度一律适配宿主视口，长列表/详情收**面板内部的滚动窗**，
  工作区主区不出页面级滚动条。**技术要点与「谁是例外」见 `docs/design-spec.md`
  §12（唯一权威落点，本条不再复述，免得两处口径漂移）。**
  ⚠️ **AI 会话面板是例外**（Issue #129，20260915）：该面板的**设计稿形态**是
  「一卡两栏、卡随内容长」（gap-list S4：卡内两列都不设滚动窗/max-height），
  与「两列各自内滚」正相反，故它退回**单滚动窗**（滚动归外层面板壳
  `.wengu-ws-main` 的 `overflow-y:auto`），`--fit` 档与 `ai/core/PanelFit.ts`
  已整体退役。**判据看稿不看规范条文**：被设计稿明确约束的面板，按稿落形态，
  并在 `docs/design-spec.md` §12 登记例外。**其余管理面板（专题/知识/统计/
  学伴）的迁移不在本规范当前的改造范围内**（规范是总则，存量面板自行排期）。
- **CSS 特异性与思源主题**（20260827 踩坑）：formRow 行容器
  `class="fn__flex b3-label config__item wengu-formrow"`——思源运行时主题注入的
  `.b3-label` 单类选择器同特异性后定义会覆盖我们的 `.wengu-formrow { display:flex;
width:100% }`。修复：复合选择器 `.b3-label.wengu-formrow { ... !important }`
  把特异性抬到 0,2,0。工作区面板（`.wengu-ws-page`）没有 `.config__items` 父容器作
  兜底，所有 formRow 都需要这条复合规则。
- **移动端适配约定**（Issue #10，20260910；移动端**刷题**见
  `src/mobile/` 一节，Issue #59）：
    - **openTab 在移动端是空桩**（思源 `app/src/plugin/API.ts` 的
      `/// #if MOBILE` 分支 `openTab = () => { /* TODO: Mobile */ }`），
      自定义页签打不开——顶栏入口必须分流（现走 `notifyInfo` 提示，
      见 `src/index.ts` addTopBar 回调首段）。
    - **dock 是插件面板唯一的移动通道**：`addDock` 在移动端被包装成
      `mobileModel`（`app/src/mobile/dock/MobileCustom.ts`，构造签名与桌面
      Custom 同款），init/destroy 生命周期同构 ⇒ 挂载链零改动即兼容；
      无程序化打开 dock 的公开 API，别造私有通道。
    - **环境探测一律 `ui/shared.isMobileUi()`**（`window.siyuan.mobile !==
undefined`；types 1.2.4 有该字段，`getFrontend` 反而没有类型）。
    - **触屏样式走根元素标记类分流**：挂载层 `markMobileUi` 给单词面板
      根元素（+ `document.body`）打 `.wengu-mobile`，触屏规则全部写成
      它的后代选择器（`src/scss/words-mobile.scss`；挂 body 的浮层适配在
      `src/scss/mobile-english.scss`——整改 F1 #127 自 `english.scss` 尾段拆出）。
      **禁用 media query**——桌面浏览器窄窗口会误伤，
      触屏适配只按环境分流；无标记时样式逐字节不变（桌面零回归）。
    - **iOS speechSynthesis 首播要在手势栈内**（20260910 定论）：`$effect`
      是微任务，脱离手势的首次播放会被系统静默丢弃。故**自动播报落点按环境
      分流**——移动端在控制器 `enterPrompt` 的同步栈里播（换卡动作的 click
      链路，天生在手势内），桌面仍走组件 `$effect`（与改造前逐字同行为），
      两侧互斥不双播。落点判定收口在 `word/core/TapSpeech.ts`
      （`autoSpeakSite`/`mayAutoSpeak`，带单测）。
- 改行为必须同步 `docs/question-block-contract.md`。

## 数据演进守则（20260901 存储前瞻审查定稿）

存量用户数据兼容是最高约束——插件目录与 data/storage 随思源同步在两台
机器间流转，任何格式变更都同时面对「升级」与「版本错位」两个方向。全部
持久化存储（saveData 十二店 + 词书工作区文件 `data/wengu/` + 题目块 IAL；
20260910 起加 `know-synonyms` 同义表——**纯派生可重建**，读异常归空表、
丢=少数词对重问一次 AI，按纯缓存口径处置不设版本闩；20260912 起加
`know-index` 标题树快照——**纯派生可重建**（丢=下次装载懒捕获重扫），
按缓存口径处再加一层版本闩：装载遇未来 version 归空表 + 拒写）
一律遵守：

- **字段只加不改名不删**：新字段一律 optional + 装载 backfill
  （QuestionBank/WordStore.backfill 同款）；`version` 字段只作标记，
  **不参与装载判据、加字段不 bump**——装载只认业务字段存在性，
  改名等于静默清库（读成空起步、下次落盘覆写）。
- **版本闩**（words/bank/history/weakness 四店 20260901 已装）：
  装载遇 `version` **大于**本版已知 → 内存按空起步 + **拒绝一切
  落盘**（save/markDirty/flush 全闸）+ notifyStoreForeign 浮层告知
  升级——堵死「未来 bump 版本」与「机器 B 新版写盘、机器 A 旧版
  读到即覆写」两类清库通道。新持久化存储上线即配同款闩。
- **冻结清单**（输出已嵌进落盘数据，改了就孤儿化存量或全量假漂移；
  确需演进一律新旧并存双写双查，禁原地替换）：
    - `BankParse.questionHash` 及其归一化（剥 id/updated、剥运行时
      属性、空白折叠）——指纹已渗透 bank.hashed/record.hash/
      record.srcHash/know-hash/route-cache indexGen（20260903 起存量
      文档题块 IAL src-hash 同值共存，读侧不再碰）；
    - `WordBook.wordKey` 归一化（words.json 九个 Record 与音标表、
      易混组、confKey 的共同 key）；
    - `attrs.ts` 属性名（`custom-plugin-wengu-*`）与题块 kramdown
      结构（容器超级块 + part 子块）——kramdown 是题库记录的内部
      契约格式（20260903 起不再落用户文档，但全部存量记录与解析器
      都长这样，改名=重写全库）；
    - `SrcChunk.structuralChunks` 的 srcKey 键格式（`H:链/P0/#k/~n`）
      与切块确定性；
    - `KnowledgeNorm.knKey`（聚合键裂开=薄弱画像/知识点索引分裂，
      有 remapKey 对账兜底但别依赖它）。
- **往记录 kramdown 写任何新的非内容属性，必须同步加进 BankParse 的
  RUNTIME_ATTR_HASH_RE 剥除名单**——否则作答即变指纹，增量重转换
  全量误报「变更」（当前已停写块属性，此条防复发）。
- **规模预警**：bank.json / history.json 单文件整写、无上限增长
  （words 的 reviews 流水同理，设计如此）；到万级题/数 MB 拆分时走
  「**新存储键 + 读时 fallback 老键**」（如 bank2→bank），老文件
  原样只读保留，禁原地改格式。

## 环境与内核坑（已拆分）

两台机器的调试流程、Shell 坑与思源内核实测坑原在本文档，20260915 起
拆至 `.agents/memory/env-debugging.md` 与 `.agents/memory/kernel-pitfalls.md`，
内容未删只搬家；跨机器干活前先读这两份。
