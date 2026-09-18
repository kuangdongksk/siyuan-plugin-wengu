---
name: scheduling-20260916-walkthrough-fixes
description: 20260916 调度日全天：晨三 PR 并（#141/#133/#142）+整改G；午后四报障→PR #150/#151/#144/#149 全并、Issue #143/#145/#146/#147 全关，dev=e3f2fcf 已装机；#145 修错位置（用户指侧栏钮）→#154 派；#149 空轮闸方向反了→#155 改静默关闭+用时图分组；在途 #148/#154/#155
metadata:
    node_type: memory
    type: project
    originSessionId: sess_99c12707-9dfc-4261-8fe6-976a6de9e43e
---

20260916 调度日全记录。晨间拍板盘点（用户「12 按你说的走」）：①#132 审计报告 P2×3+P3×6 开一单全修、排 #133 合并后派；②#133 冲突召唤 NPC rebase、**种子洗牌方案用户认可保持**；③#141 先 #142 后审查合并。

**三 PR 全部收口**：

- **PR #141**（阅读组分隔条，↔#138）：审查通过并 `d78442b`。NPC 自检翻出 5 处静默失效（上限取自材料区自身=棘轮、比值分母同源=持久化永不落、双击复位不清库、键盘起点折算 0、手柄闸只认 cap=拖大卸载死锁）全修；规格断言走 sass.compile+svelte compiler 真编译（MaterialSplitterDesign.test.ts）。quiz/index.ts 行数压线靠 prefsSnapshotOf 外移（豁免额度 574→此后 #142 再压到 567）。
- **PR #133**（选项指古断根，↔#131）：与 dev 冲突（#135 对稿还原先并）→ PR 评论召唤 NPC rebase → AnswerFlow import 冲突并集解、顺带把 MobileDrill.test.ts 588>520 拆三片撤豁免 → 独立验证 1748 测试+两条 webpack build 全绿 → 并 `018ac596` 关 #131。**种子洗牌口径定案**：按 (会话 id, 题 id) FNV-1a+mulberry32 确定性洗牌——排列不落盘可复算、同轮恒定（恢复自洽）、换轮换序（消剧透）、重开页签复原；多选 remapAnswer 后 sort 修判分。真机验收项（删题集重转→答案指原文→同题换轮换序→预览原序）挂账。
- **PR #142**（切卷二次确认，↔#137）：审查通过但 i18n 尾部与 #141 撞键（后合并者 rebase 约定）→ NPC rebase 合尾（matSplitTitle 后接 switchConfirm 四键、JSON.parse 校验）→ 并 `0999568` 关 #137。两处 P0（NPC 复审自查）：闸装配链断裂（出口写成空函数壳侧没接 switchGuard）、行 id 误当上下文 id（ctxId=docIdOf 口径带 col: 前缀，rowId 裸 id，两字段分口径）。

**整改 G = #143 已派**（prompt 审计 #132 报告的 P2×3：convert.ts:119 三行/四行矛盾、gen.ts 备注重复拼两遍、variantPrompt 插图占位零说明；P3×6：路由扁平数组被永久缓存、judge 竖线、synonyms/companion 限长漂移、detectWindowPrompt 死代码、\( \) 记法）→ #132 关单留档。

**真机走查四报障（用户碎片四连，全部已诊已派）**：

1. 专题管理按钮文本太长 → **#145**（bank 域）：CollectionPanelApp.svelte:44-57 三 outline 钮挤标题行，「按知识点收集…」8 字元凶；修=文案收短或低频钮收菜单。
2. AI 会话又现全屏滚动条 → **#146**（ai 域）：实锤 **#129（5e4ff73）删了整页不滚动链**（grid minmax(0,1fr)、flex min-height:0），注释自认「长卡照常把主区撑出可滚高度」——对稿还原与 #96 规范冲突；修=恢复高度链+内滚窗落列，#129 视觉逐值保留。
3. 没做答也可结束本次 → **#147**（quiz 域）：**收卷双入口闸只盖一个**——endRound 有 endRoundEmpty 通知闸、finishNow 无闸直接收卷（唯一触发=TimerBinder.ts:128 倒计时归零时间条「结束本轮」）；修=闸下沉唯一出口；注意「停止键别 disabled」是既定决策故用通知不 disable；quiz/index.ts:165 `currentSession = session ?? finished` 中 finished 是 WenguSession 类型非 boolean（不是 bug，已标勿动防误诊）；567 额度只许减。
4. 转换「题目分开了」→ **#148 排队待 #143**（同改 src/ai/prompts/convert.ts 必须串行）：2020 Text1 聚合文档实录——第一批（文章正文）AI 按讲义口径自造 8 题**没落材料块**，第二批真题 21-25 全带 group=prev **引用悬空**；根因=规则 4「一题对一题 vs 讲义出题」按单批片段判定，AI 不知文章是后批真题的材料；修=prompt 补「真题语篇（Text N/逐题细解）即使本批无题也一律落 @@Q material=1 材料块不得自造」+真题优先去重+group 悬空兜底核验。

**二轮走查报障（附截图+转换实录，三条全并入在途单不另开）**：

1. 「本轮总结应该直接关掉题目吧，而且总结有超长」→ 并进 #147 扩围（出总结=题卷收起总结独占；报告高度随数据自适应，1 轮历史大片空白是布局问题）。
2. 「作答了点击结束本次没有反应」→ 定性：报告已出态再点「结束本次」走 `if (this.finished) showRoundReportNow` = **detach+重挂同一份报告，视觉零变化** ⇒ 观感「没反应」；并进 #147 扩围=改为总结视图开关（每态必有可见反馈、绝不重挂、不禁用）。
3. 「生成的答案像是没问题了你再核实」→ 逐题比对核实 **#131 断根真机生效**（16 道政治真题答案全对、选项原序、25/30 无解析题老实写「原题未附解析」没编造；英语题截图交叉验证洗牌/替换/判分自洽）。顺带发现新观感问题：**长选项（英语整句 60+ 字符）替换进解析后行超长** → 并进 #148（OptionRefReplace 对超长选项改截断+字母提示）。

**午后四单全部收口**（每单独立 worktree 全套复跑，不信自述）：

- **PR #150**（↔#145 专题按钮）并 `922d1521`：标题行收编「新建/刷新/更多」三钮，低频动作（按知识点收集/题库体检）进内核 Menu（icon 走 sprite 字段），colNewFolder→「新建」、repairEntry→「体检」，`.wengu-ws-titlebtns` 加 nowrap+flex:none 堵折行。
- **PR #151**（↔#146 AI 滚动）并 `2f150305`：逐条恢复 #129 删掉的高度链（`minmax(0,1fr)`/卡 `flex:1 min-height:0`/`.wengu-aipage` flex 列），内滚窗落 `.wengu-aipanel-pane`（scrollbar-gutter:stable）；宿主 `--fit` 档**按工作区白名单开（当前仅 ai，判定收口 PanelFit.ts 纯函数）**+挂载/卸载配对+禁 document 级全选（只碰本面板那一份骨架）；折单列树列 0 高顺修。#129 视觉逐值保留。
- **PR #144**（↔#143 prompt 整改）并 `c545fb32`：九项全修全带测试（四行判定/备注重重删拼接/变式插图占位/批量路由扁平数组 prompt 警示+RouteCache 拒缓存/judge 竖线/TAG_MAX_CHARS 等常量收口互指/detectWindowPrompt 删除至字面零命中/\(\) 记法禁令）。
- **PR #149**（↔#147 收卷链）i18n 尾部撞 #150 的 colMore → NPC rebase **静默 push 不评论**（mergeable_state 翻 mergeable 但零新评论，fetch 才见 force update+两个自查提交）→ 并 `e3f2fcf`。实现：空轮闸下沉 `finishRoundGuarded` 唯一出口（endRound/finishNow 共用，contract 测试锁唯一定义点）；总结独占走**主区状态类** `.wengu-summary-view`（不拆 Svelte 挂载物，摘类即逐字节回原状）；头部按钮三态语义（返回题卷/查看总结/结束本次）；NPC 自查追修三处断链（hidden 与类必须成对操作否则 CSS 特异性压过 UA hidden、报告滚动窗桩节点致劈屏+滚顶失效）。

**仓库转移 + 装机**：CNB 仓库已转移至 **`bianchao777/sasa/siyuan-plugin-wengu`**（见 [[git-remote-push]]）。dev=`e3f2fcf` 已装机（探针 wengu-summary-view/wengu-report-pulse/colMore/reportBackToQuiz 全中+disable/enable 循环）。**#148 转移前 NPC 已干完=PR #152 挂出 CI 绿待审**（验证=2020 Text1 删题集重转）。

**转移坑收口**：#154/#155 首召用旧 `@sasa1107/...` 路径零触发（提及不跟 API 重定向），换新路径重发 1 秒双触发；模板/AGENTS.md 旧路径全量换新直推 dev（8233417+0649b45），细节见 [[cnb-npc-full-workflow-first-run]] 20260916 条。

**晚间续派三单全收口（dev=3f87f29 已装机）**：#158 派出→PR #159 一次过并（47361cb：移动端空轮静默关、收卷生命周期拆 MobileRound、删 endRoundEmpty 键、契约测试剥注释判引用）；NPC 自查笔记订正 PR #160 直并（06043d1）；#153 背单词双端 UI 美化→PR #161 一次过并（3f87f29）。**#161 审查要点**：题面两红线被良性突破已核实收货（i18n +wordHomeUnit=行卡数字单位所需；word/core+flow 各加只读辅助 speakWordAt/statusKindOf=稿内喇叭与查词四态标签必需件）；规格测试=编译产物断言（零裸 hex/scoped 零 unused/移动端规则全挂 .wengu-mobile）值得复用；思源 sprite 无 `<symbol>` 静态可抓（运行时注入），移动端图标可用性靠「mobile 构建引用计数+域内现状对照」判定。⚠️ 删分支后 fetch 会把未传播的分支带回来，`ls-remote` 核对后补删一次即净。验收挂账：背单词双端逐屏对照设计稿走查、移动端空轮真机、#148 的 2020 Text1 重转。

**傍晚审查轮三单全并**：#152（语篇材料块，c880fd7，长选项「只截断不补字母」采纳 NPC 偏离论证——洗牌会把手写字母洗成错误指代+撞解析无字母冻结口径）、#156（侧栏钮文案，c31d293，遗留一笔注释错位瑕疵已记录在关单评论）、#157（空轮静默关+用时图分组，708cea5，**退修一轮**：删 endRoundEmpty 键但移动端 MobileDrill.requestEnd 仍引用→弹裸键名，令恢复；NPC 复核自查补真缺陷=**StartPanel.startRound 开轮即 upsert 落盘**，光清内存删不掉 0 作答记录→补 HistoryStore.removeSession 经 enqueueSave 串行链抹记录）。#148/#154/#155 全关、分支全删；**#158 已开**（移动端空轮对齐桌面静默关+删键，等派）。dev=708cea5 已装机（md5 对账+petal 循环）。验收挂账：#148=2020 Text1 删题集重转、#155=243 题卷分组展开+空轮静默关+统计不虚计。相关 [[scheduling-20260915-aipanel-chain]]、[[npc-first-no-browser-loop]]。
