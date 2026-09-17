---
name: wengu-dispatch-20260915
description: 20260915调度轮：审并合并F0/F1整改PR#126(regen答案核查)与#128(SCSS迁组件试点)+部署两区；#129 AI面板对稿已派在跑
metadata:
  node_type: memory
  type: project
  originSessionId: sess_98362b44-947f-4ea8-9367-63c7e16ced87
---

2026-09-15 晚调度轮（接 [[wengu-dispatch-20260914]]）。

**上午会话（我记忆之外）发生的事**：审计 #110 产出整改单 F0/F1（Issue #123/#127）并召唤 NPC，两轮交付完毕待审；#119~#122、#125 已合并（拆超线文件/design-spec.md 落库/i18n 收口/AI 面板复制）。本地 dev 因此落后远端 46 条，本轮先 ff 同步。

**本轮审查合并（merge sha）**：
- **PR #126 → 2ce3ab7**（F0 重新生成无核查）：三条修法=① regen prompt 走 protocolSpec `order:"keep"`（只换 @@P opt 行，默认链逐字节不变）② `bank/gen/RegenVerify.reseatAnswer` 先校正后洗牌，失配走 verifyPrompt 自检、no 整题不落盘 ③ OptionShuffle 洗牌时按同一 order 映射改写解析里的独立裸字母词符（保护区：行内/围栏代码+$数学+\(\)\[\]+所有格）。⚠️ ③ 是**转换链全局行为变更**（解析字母随洗牌走），我实证了 `solution` 部件命名与 QuestionDraft 契约一致不会 no-op。真机验收=题卡重生成一笔修正案。
- **PR #128 → 4619236**（F1 SCSS 绑定新规试点）：startpanel.scss(106) 迁入 StartPanelApp.svelte `<style>`（webpack css:"injected" 首次激活，产物不落 dist/index.css）；english.scss(564) 拆三片；design-spec §十三 成样式绑定权威口径。复核轮揪出 3 处「类名没变肉眼无感」的选择器形态漂移，补了**选择器名录逐字平价闸**（后续每批迁片都要抄）。我本机独立 build+产物核对过（wengu-start 在 index.js 不在 index.css、gloss 样式仍在全局 css）。真机验收=开刷面板明暗+Neo 目视（静态面已被闸钉死）。

**部署**：pnpm build 后产物拷两区（工作/测试）插件目录**根级**（webpack dist 自带完整布局 index.js/kernel.js/i18n；⚠️ 别拷进插件内 dist/ 子目录——插件根才是加载点，本次误建已清）。

**分支清理**：feat/start-panel-design 已删——PR #104 squash 合并后的残留，补推的 01971cb（创建 startpanel.scss）内容其实已在 dev（#128 正是从 dev 删它迁进组件）。git cherry 的 `+` 是上下文漂移不是缺内容。

**已派 #129 → 已审并合并（当晚第二轮）**：AI 会话面板按差距清单对稿还原。PR #130 → **7ca84d6** 已并入 dev、两区已部署。主干=①撤 #96 收内滚档（`--fit` 档/`PanelFit.ts`/`fitHost` 整体退役，滚动归宿主 `.wengu-ws-main` 单滚动窗，稿形态「一卡两栏、卡随内容长」）②S5 落「间隙期形态」（未选中叶行出 `MM-DD HH:MM · 类别` 弱注记，i18n 键 `aiRowMeta`；不真删时间戳防信息损失）③树头「N 组」改去重类别数 ④stbadge 自吃 auto 消 `.badge:last-child` 复发隐患。复核轮另补文档失真（design-spec §12 例外登记+「判据看稿不看条文」、AGENTS.md 只留指针、design-review §〇11 失效标注、ai.md #96 段标已退役）。回归锁=`src/ai/core/AiPanelGapRestore.test.ts`（源级锁+sass 真编译）。真机验收=AI 面板长清单单滚动窗+树头组数+叶行弱注记。

**⚠️ 合并方式教训（本轮踩坑）**：**必须走 CNB `merge-pull` API 合并 PR**（此前轮次即如此，committer=cnb@cnb.local）。本地 `git merge` + push dev 内容虽对，但平台 PR 永远停在 closed-unmerged，且事后无法补登记——closed 状态调 merge-pull 报 409「the pull has been closed」，重开也报 409「already merged into dev」。为 cosmetic 标记强推回退 dev 不值当，本轮留评论收场。下轮起合并一律 `cnb pulls merge-pull --merge-style merge --commit-title "合并 PR #N：… (Ref #M)"`。

**format:check 本机假红**：fresh worktree + `core.autocrlf=true` 检出 CRLF → prettier 全仓报红（551 文件=整个仓库）。辨法=看 CI 是否绿 + `git show HEAD:file | prettier --check --stdin-filepath` 复核 LF 原文。勿据假红打回 PR。

**待办/挂账**：真机验收三项（regen/开刷面板/AI 面板）待用户；#61 移动端视觉还原仍卡用户手机实拍；OpenDesign 细化稿流程（[[feedback-opendesign-for-visual-compare]]）已按新口径产出。

**当晚第三轮（用户验收发现问题→双单并行）**：用户重转「03-习思想-题解」时我直读 petal 存储实锤**转换链活着 #123 同款**：220 可核对 draft 中 32 条答案字母已错（AI 按「正确项最前」协议重排却抄原题字母，写库洗牌忠实传播，全链自洽地错；人工核实案例：党内政治生活 srcAns D→落盘 B 指干扰项）。**#123 根因 #126 只修了 regen 链**。用户拍板新架构（库死形态/洗牌是函数/解析无字母）+三决策：文本替换（非链接）、标记制〔opt:X〕全角（防英语裸 A 误伤，用户提议）、做题洗预览不洗；存量零迁移删题集重转。已派两单并行：**#131 青简实施**（keep 序条件规则/撤四处写库洗牌 ConvertSegment:172+ConvertIncrement:171+GenQuestion:105+RegenDialog/落库前〔opt:X〕→「选项文本」替换/quiz 渲染层新展示洗牌纯函数+答案重映射/OptionShuffle③保留到存量清零）、**#132 复核全量 prompt 只读审计**（10 文件+2 散落点，四类问题：自相矛盾/契约缺口/跨链漂移/硬规则缺口）。插件存储实测在 `data/storage/petal/siyuan-plugin-wengu/`（saveData 十二店实盘）；ai-sessions 的 turn 角色是 `user`/`ai`；bank 记录 kramdown 首部件带 `{{{row` 前缀要剥。⚠️ 召唤评论手滑写错仓库路径（si-yuan-plugin-wengu 多连字符）静默不触发，已发修正版并注明前条作废——召唤后必须核评论上的 pipeline_id。
