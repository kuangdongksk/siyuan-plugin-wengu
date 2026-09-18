---
name: wengu-dispatch-20260914
description: 20260914调度轮：审并合并PR#84(阅读面结构判据)与#86(流级横幅对稿)；dev 4deab77仍未装机，攒账三屏+五条真机验收
metadata:
    node_type: memory
    type: project
    originSessionId: sess_7d7ff9d5-1179-4f64-a078-840c06e65317
---

**20260914 调度轮（接 [[wengu-batch-convert-resume-issue62]] 之后）**：审查并合并了两个他人派的 NPC PR：

- **PR #84 → `056f4a8`（Ref #83，已关）**：纠 #81/#82 修错方向——阅读面判据改**材料组结构**（`isReadingUnit = kind==="group"`，零学科依赖）；标生词收窄为唯一语言闸（`BankSet.subject?` optional 只加，转换首批 `SUBJECT:` 行零额外 AI 报学科，`isEnglishScope` 两级=有学科以学科为准/无学科回退题型并集）。审查要点全落实：`parseSubject` 冒号后 `[ \t]*` 防跨行吃 @@Q（GlossEntry MARK_RE 同源坑）、`normalizeSubject` 占位先判原串再拆词（N/A 坑）不做模糊匹配、openSet 只填不改、补正腿学科必须 await 题集之后再 peek（有反证测试）。`wrapPlanOf` 跨题集段断链+独立题零装饰+标题行留包装外；PreviewFlow 查卡改后代选择器（否则段包装里整段漏过滤）。
- **PR #86 → `4deab77`（Ref #85，已关）**：流级横幅按已验收设计稿还原（#79 停摆的美化）。FlowRegistry 结构化通用载荷（`AiFlowItemState` 六态含 skipped——与 #62 对齐、零 convert 类型泄漏、progressAiFlow 只覆盖传入键、stopKey 范围词登记侧给）；ConvertFlow 折算（停止屏四段=aborted 快照不带 progress 须从 stopped item+pending 取数、队列累计≠当前篇 count）；FlowBannerUi 纯逻辑 303 行单测锁两轮对稿修正（段序 done→skip→fail→run/stop→cancel→queued 与 chips 序不同、两屏各 6 chip 停止共用格）。

**已装机（20260914 用户令，dev `4deab77`）**：主仓 tsc+vitest 1210 绿后构建，dist+i18n 拷两区（md5 一致），测试区 60606 setPetalEnabled 重载成功、工作区思源未开只拷文件。真机验收清单：

- #84 五条：语文卷材料组挂阅读面/纯阅读英语卷挂/工科独立题不挂/聚合混合刷分段各判/标生词语文不出英语出（subject 存量回退）
- #86 三屏：跑动（seg+stats+counts+分篇清单）/停止抉择/单流（bar+stats）——NPC 自述无实机截图，**视觉必对**
- #62 验收 1~6（批量转换中断续跑）

仓库常态：dev=`4deab77`，开放 Issue/PR 已清零（本轮关 #83/#85，之前关 #62）。关联 [[wengu-dispatch-20260913]]。

## 追加（同日晚：用户两条真机反馈修完，dev 到 `fcc19b3` 已装机工作区）

- **#87 阅读面材料内滚**（PR #89→`3a834af`，Issue #87 已关）：溢出才限高（`MaterialScroll.materialScrollCap` 纯函数+EPS 1px）、限高走 CSS 变量 52vh（JS 不算像素）、渐隐 `fadeVisible` 滚到底即隐、折叠/resize 重量算、NumRail.chaseScrollIntoView 加 scrollHostOf 适配内滚容器。真机 DOM 实测过：cap=1 / maxHeight 520px / 滚到底 fade 属性移除、回顶恢复。
- **#88 AI 会话面板对稿**（PR #90→`fcc19b3`，Issue #88 已关）：AiSessions.retitle（只改 title/不设状态闸/同值零动作）+ 转换批落库 retitle「生成第 N 批 · M 题」（逐片批号，sid 经 makeCall onSid 回传）+ SessionTree.leafViewOf 纯函数（dot/badge/spin）+ tg2 组合行 + aipanel.scss 独立分片（rail.scss 的 .wengu-ai-* 迁出）。真机已见：组数徽标/状态点/tg2 组合/kind 徽标/轮次日志标签；叶子行名存量回退「转换」，新批落库后 retitle。
- 教训：IAB 截图管道会卡（screenshot 超时后等 8s+ 才恢复）；Svelte 属性翻转要 await 120ms+ 再读（dispatchEvent 同步读是旧值）；用户真机在用时别反复操作面板读数。内核 3.8.3 端口重启会变（60606→65219），PowerShell CIM 查 `SiYuan-Kernel.exe` 命令行最可靠。

## 追加二（同日更深夜：用户再批「对比太粗糙、差距很大」→ 改派 OpenDesign 逐元素对比）

- **用户批评**：我对 #90 实现与设计稿的对比太粗糙（差距那么大只看出那么点），指示**丢给 OpenDesign 让它对比并给出该怎么改**（见 [[feedback-opendesign-for-visual-compare]]）。已建项目 `wengu-aipanel-redesign-fc7d` 派 run `85bd2a28-4219-4ebf-b65b-8de7d910029b`（agent=claude 本机跑），任务=差距清单（稿值/现状值/修法三列，gap-list.md）+ 细化稿（aipanel-spec.html：施工规格表+存量回退形态示意）。喂料法=prompt 里直接给本机文件路径与本地 http 服务（design/ 起了 node 静态服务 18923），**不让大文件经手传参**。
- **差距根因（我已从稿 CSS 提取确认）**：实现只抄结构没抄数值——稿的 `.ai-panel` 是 **grid 一体卡**（`grid-template-areas:"banner banner""tree detail"`、左树 292px 固定、横幅横跨卡内顶部），树行**三级缩进 14/27/42px**、badge 19px 高/11px mono/圆角 4px 各态配色、dot 8px（run 带 3px 光晕）、log 行 66px+1fr grid/时间戳 mono 11.5px、own-note 虚线边框卡；aipanel.scss 全是自由发挥的近似值。
- **移动端核实（用户问「怎么感觉没开始做」）**：#61 功能腿已合并（`src/mobile/` 域 ~2700 行：HomeScreen/DrillScreen/QuestionBody/NumDrawer/ReportScreen+测试），**照稿视觉还原一行没动**——观感「没开始」。设计稿 `design/wengu-mobile-drill.html`（PR#58）与 OpenDesign 项目原件 **101 区块逐一对齐**（AppData 副本无需迁移）。移动端视觉还原建议走同一 OpenDesign 对比流程，最好先要用户手机实拍（首页/答题/报告）。
- **21 小时盘点补充**：此间其他会话已合并 #61(移动端功能腿)/#68/#71/#73/#75/#78/#79/#80/#82 等一批；测试数 976→1265。

## 追加三（同日深夜：OpenDesign 对比完成、产出入仓、#92 已派）

- **run `85bd2a28` 完成**（全程仅此一个 run，用户明确「不要派发多个 OpenDesign」）：产出 `gap-list.md`（S/A/B/C 四级差距，每项三列稿值/现状值/修法；§0 oklch→`var(--b3-*)` 唯一令牌映射表；**S1「横幅与面板不是一张卡」=整体不像的第一根因**，S2 grid 一体卡 292px 两栏/S3-S9 树宽·凹槽底·行尾·轮次行·详情头·滚动窗/树头取舍）+ `aipanel-spec.html`（原稿全文+追加「06 施工规格」节：6.1 令牌映射/6.2 全元素 CSS 规格总表逐值照抄/6.3 存量回退形态/6.4 轮次日志可施工与稿 mock 专属分界）。run 状态长时间挂 running 只是收尾写总结——**完成判据看 events.jsonl 的 TodoWrite 全勾+产物落盘，别当中断**。
- **产物入仓坑**：aipanel-spec.html 里 agent 写的三处正文 `<style>` 字面量（注释+行文）被 prettier HTML 解析器当真标签 → 未闭合 → `SyntaxError: Unexpected character "EOF"`（报在文件尾，极具迷惑性）→ CI 格式门 error。修法=字面量改写（如「style 块」）；栈式配平器定位未闭合标签。已修（`8909a4e`，CI success）。产物入仓两文件：`design/aipanel-gap-list.md` + `design/convert-stop-redesign-spec.html`。
- **[Issue #92 已开+召唤](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/92)**：面板照 gap-list 精修，S 级九条全部落地、A/B 逐条不得选择性忽略（有异议 PR 列理由）、S9 树头合并维持现状已拍板；TreeList 共享组件不动本体。流水线已触发（20260914 深夜），PR 出来我独立审后合并装机。
- **装机终态**：dev=`8909a4e`（含设计稿文档），插件产物装机到 `fcc19b3`（两区 dist+i18n，工作区 65219 已重载、测试区拷贝待下次开思源生效）。用户 21:03 在真机跑转换验证 #62/#90。真机验收账：#84 五条/#86 三屏/#62 六条 + #89 材料内滚 + #90 面板形态。
