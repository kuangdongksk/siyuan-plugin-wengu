---
name: wengu-word-flow-redesign
description: 2026-08-26 背单词改版 wave——回想三档流已提交(3a9ef28)、大底条+四步梯地基已提交(8719834,未接线)；docs/wordbook-redesign.md(发音/四步梯/标题温故单词/多词书)待用户逐条过 6 决策点，审核前不实施
metadata:
    node_type: memory
    type: project
    originSessionId: sess_c3ca88ad-09c1-4779-9820-8fdaef587db6
---

2026-08-26 晚背单词交互改版（仿「不背单词」参考流，用户贴 4 张截图逐条点）：

**已提交（3a9ef28，含当日多波部署的批量大提交）**：

- 回想题正面直接三档（认识/模糊/忘记，1/2/3 键）选完翻面；结果页「下一个+记错了」；记错了=强制按不认识+弹「认成了」自述框（选「忘记」也直接带出）；客观题答错同样下一个+记错了；空翻兜底三档。
- 熟按钮归位到卡片右上角星标旁（wengu-word-tools 角标工具组，答错/翻面才出现）。

**在途部分已提交（8719834，2026-08-27）**：

- 大底条 `wengu-word-grades`（三档/收尾钮整宽均分 56px）+ 修复「未翻面藏操作区」存量 bug。
- WordQuiz.ts 的 `listen`（听音选义）/`readalong`（听音跟读）题型定义、`NEW_LADDER` 四步梯函数、`AnsweredState.peek`（看答案）——**仍未接线**（WordView/QuizCard/WordBind 未用），类型干净，是后续接线地基。

**待用户审核后实施：docs/wordbook-redesign.md**（用户明确「先落实成文档」）：

- 发音=speechSynthesis（词库只有 w/m **无音标数据**，音标列做不了；真音标要 MinerU 重跑 OCR 挂账）。
- 新词四步梯：①choiceEn 学习(+看答案翻底按不认识计) ②recallEn 回想 ③listen 听音 ④readalong 跟读；know 才前进，模糊/忘记原步重出；复习词不走梯。
- 标题改「温故单词」（现读生成物 wordbook-meta 硬编码），书名挪副位。
- 多词书：对齐 [[wengu-wordbook-multi-model]] 方向，第一版单层书切换；存储 data/wengu/wordbooks/*.json；核心风险=存量进度下标→归一化词头迁移。
- 文末 6 个决策点待用户逐条表态（三档vs两钮/前进规则/书名副位/单层切换/导入格式/TTS 先行）。

**Why:** 用户备考可能多考试，多词书是刚需；参考流四步梯+发音是新词学习体验的核心诉求；改版大所以用户要求文档先行逐条过。

**How to apply:** 下次继续时：①先问用户 wordbook-redesign.md 6 决策点的表态，过了才接线四步梯/发音/改名/多词书（顺序见文档 §五）；②WordQuiz 的 listen/readalong/NEW_LADDER/peek 地基已提交（8719834）直接接线即可；③此前「tsc 全仓红=并行 deleteDoc 半成品」已随 [[variant-and-doctree-impl]] 一期提交解决，不再存在。

**2026-08-27 晚更新（并行会话+本会话合力，§六决策已过、梯已接线）：**

- 并行会话推 ca0503a..37ad240（19 提交）：四步梯接线（ca0503a，梯序定稿
  ①choiceEn②choiceZh③listen④recallEn，**readalong 出局**；仅「认识」进
  一步、错一次整梯归零 d2ec340）、pipelineLadder 流水线（组宽≤4 轮转
  出镜）、src/ 全域子目录分层（word/{comp,core,flow,service,data}）、
  src/ai/ 基建域、三栏格局+学伴看板娘 companion 域（多套配置/AI 台词/
  聊天讲题）、WordSpeak TTS。
- 本会话修复接线回归 cfd7193：头部「剩」被流水线按步×4 虚增（2744 词
  显示剩 10976，进度条同稀释）——`remainingWordCount(queue,pos)` 去重
  计数 + `ui.remainWords` 镜像（enterPrompt/会话收尾两处同步），复习/
  星标队列与老语义等价；WordLadder.test 补 4 例。
- 学伴名动态化（{name} 模板化）**已完成部署、未提交**（2026-08-27 晚；
  另一会话记忆所记「在途」即此工作，勿重复做）：聊天「想一想/输入占位/
  回话失败」三条 + AI prompt 角色行/历史轮标签随当前学伴名（i18n `{name}`
  占位 + 调用点 replace 沿 slotNO 惯例，Prompt 三 builder 加 name 首参）；
  设置「启用/AI 台词」描述「团子」改中性「看板娘」；默认名仍团子
  （companionDefaultName）。全链绿（116 测试）+已部署机器A+petal 重载；
  7 文件未提交（companion×4 含 Prompt.test/i18n×2/CHANGELOG），提交时只挑
  这些。验收=切自定义学伴（如语文老师）看聊天占位/思考/失败与 AI 口吻随名走。
- 「剩」用户真机仍见 10963=重载前旧包残留（部署 bundle 已含 cfd7193 修复，
  重建 md5 字节级一致 720051f）——重开单词面板即正常。**待用户拍板**：
  「剩」现为书级语义（buildQueue 开刷队列不限量装全书未学词，词书共
  ~5790 词），会话级/每日额度级「剩」已向用户提出、表态前不动。
- 用户实际在用多学伴配置（自定义学伴「新学伴3」+自定义人设，非默认
  团子）——学伴文案/占位/默认值勿假设团子名，{name} 模板化正是由此而来。
- 知识文档面板树化三轮（0994260→85b6870→d52dacb,20260827 本会话）：
  终版=KnowPicker 同款交互模式（openPaths 状态集+paintTree 整树重绘+
  .wengu-cp-list 容器委托+isConnected 异步守卫），分支默认全展开、
  小节默认收起。三条教训进骨：①「可展开」判定必须含小节等附属层
  （首版 toggleSlot 只看树 children ⇒ 有知识点的文档行无箭头=用户报障
  根因）；②工作区面板 async 装载必加 isConnected 守卫（refreshSide
  全量重绘会换根，旧绑定写进 detached 节点）；③面板交互抄 KnowPicker
  的状态重渲染，别做逐行 addEventListener+DOM 手术。IAB 自动化验证连番
  失败属记忆已录的 guest 怪癖（多点后失效+截图 capture failed for
  guest），别再烧轮次跟它搏斗，交用户手测。

**2026-08-27 深夜更新（滚动四步梯设计定稿 + 复习算法体检，待写入文档过审）：**

- 用户口述的新学调度=主流背单词 app 标准算法（用户明示「网上能查到」，
  已查证墨墨 MM/WDR、不背单词三题型流、Qlango 日引 7~10 新词等）：用
  **动态滚动窗口**替代 pipelineLadder 静态预排——开局连教 4 张①（英选中·
  先测后学），之后窗口内在学词错峰推进+渐进补新词；同一词两次出镜隔≥3 张
  （REINSERT_GAP 思想保留）；走完④毕业出窗。天然根治「队列=词×4 位」的
  计数/规模问题（10963 的根）。
- □1~□5 已全部锁定（用户 2026-08-27 表态）：窗口上限**可配置**（默认建议
  ~5）；交替=**自然流动**（谁隔够 3 张谁先走、窗口有空位才进新词，细节用户
  授权按查证资料定）；答错=**该词所有进度清零重来**；新学/复习会话**分开**
  不混；毕业=**按会话表现直进复习排期**。
- 复习算法体检（用户问「艾宾浩斯是不是没实现」）：现状=固定 Leitner 阶梯
  INTERVAL_DAYS=[1,2,4,8,16,32] 天（WordStore.ts:77），无逐词难度自适应；
  **最实质问题=新学梯每步判档走 applyGrade 推长期档位**（十分钟走完①~④
  即档4=8天后见，与隔周连对四次同待遇——会话内短期循环污染跨天长期调度）；
  另封顶 32 天无月级间隔。
- 修法分级先呈 A（毕业起点修正）/B（SM-2 ease）/C（FSRS）并劝退 C；**用户
  质疑「FSRS 不是标准的吗」→查证纠偏**：ts-fsrs（open-spaced-repetition
  官方 TS 实现，FSRS 6，MIT）调度核轻可直用；「重」在个性化优化（默认参数
  ≠回归参数，Anki 经验 ~400 条流水起步，且现存储无逐词流水）。用户拍板：
  **直接上 FSRS 默认参数 + 顺手记逐词复习流水，优化器无限期挂账**，A 并入
  （毕业初始化即 A）。目标记忆率 0.9 起步；认识/模糊/忘记→Good/Hard/Again；
  新学梯步进与长期排期解耦（修「虚高」根因）。
- **docs/wordbook-redesign.md 已按定稿重写（20260828，待用户过目后实施）**：
  §二=滚动窗口调度（动机/窗口可配置默认5(3~10)/冷启动连教/自然流动三规则
  a就绪推进-b空位进新词-c垫场兜底/毕业出窗/「剩」=书级剩余未学、每日上限
  挂账）；§三=FSRS（新，含 schema v2：`{d,s,due}`+reviews 流水+存量迁移
  规则）；后续章节顺延（标题→四、多词书→五、顺序→六、决策点→七，决策点
  含 □A/□B 定稿区+原 6 条待表态）。实施顺序：发音+四步梯→滚动窗口→
  FSRS 迁移→标题→多词书。

**20260828 晚：滚动窗口+FSRS 已提交 76657fb 并部署机器A，待用户真机验收。**

- 用户过目后拍板开工（含补充定稿：滚动序列**单批连续流**不分批不切块、
  AI 组复盘与队列解耦改「每毕业 groupSize 词」触发；**梯进度跨批保存**——
  ladder 记 [step,errs] 落盘，中途退出重进原样恢复不回①）。
- 实施落点：flow/WindowSched.ts（pickFreshCard 纯函数，b 优先「窗口未满
  先进新词」——注意与文档 §二.3 写的 a 优先不同，按口述「攒够 5 个再轮转
  」语义实现，冷启动连教 cap 张）+flow/FreshFlow.ts（建窗/选卡/收尾/镜像
  ladder）+core/WordFsrs.ts（ts-fsrs 5.4.1 封装：request_retention 0.9 +
  enable_short_term=false 出纯天级——探针实测毕业三档 Again/Hard/Good≈
  0.2/1.3/2.3 天首复）+WordStore v2（words:{d,s,due}/ladder/reviews/
  windowCap，migrateV1：S=旧阶梯天数 D=5(误认≥2→6.5)）。
- 行为变化要点：今日新学计数改**按毕业一次**（原每步一计虚增）；redoHard/
  星标在学词按 review 轨跑；AnnoFlow 加词本走 seedWord；WordView 拆
  LookupOps/PageOps 压 499 行。141 测全绿（WindowSched 7+WordFsrs 8 新例）。
- bundle 2.45MB(+ts-fsrs)；新 warning 3 条来自并行会话的 CompanionPanelApp
  （dirEl/nameEl/promptEl 非$state），非本次引入。
- 验收要点：开刷新词=开局连出 5 张①(英选中)→轮转②③④→毕业补新词；中途
  回首页再进=从断点续；复习到期词 FSRS 排期；旧 words.json 首次加载自动
  迁 v2（fire-and-forget 存盘）。
- 提交形态（76657fb）：word 域 23 文件+AnnoFlow+package/pnpm-lock+docs/wordbook-redesign.md；i18n 经 hunk 手术只摘 wordWindowCap 两键入提交。**学伴名动态化({name})已部署但未提交**：ChatPanel/Prompt/Prompt.test 纯净，但 CompanionCtl(94/28) 与并行会话 ChatStore 重构混改、i18n companion 区与小书童纠缠、CHANGELOG 单大 hunk 拆不动——对方 wave 落盘后须单独补提交（勿忘）。工作区 ~100 文件为 CRLF 行尾幻影（git diff 空），勿 checkout 清理（会误伤并行真实改动）。

**20260828 深夜终局：redesign 全部落地并推送（e254118，附三修）。**

- §四/§五 实施：进度 key 词头化 schema **v3**（cursor 废除；新词=全书扫
  第一个无进度词，太简单/熟不再当新词——与「剩」统一）；词书文件化
  data/wengu/wordbooks/{id}.json+manifest（service/WordLib，内置书首启动
  落盘同权；IO 走新 siyuan/files.ts 内核特殊通道）；v2→v3 一次性迁移
  core/WordMigrate（按内置书换算，待用户确认落盘后移除）；头部「温故单词」
    - 书名副位=切书选择器；起点面板词书组（导入 json/csv 入库即切当前/
      设当前/删除不删进度）；切书会话复位、队列统计当前书口径、他书 ladder
      保留；易混组 ids 即词头跨书有效；WordView 拆 BookOps 压 498 行。
      决策点 3/4/5/6 随实施闭环（redesign §七 已更新）。
- **随附修出 76657bf 两个静默回归**：①HomeScreen 仍读 queues.fresh
  （buildQueue 已改 {review,freshLeft}）→ undefined.length **首页一开即崩**
  （svelte-check 三红即此，非 companion 批引入）；②FSRS 重写丢了「答错
  记误认本」（旧 reviewWord 内联 count++/lastTs/清旧辨析未搬）→ 恢复
  WordStore.markMistake 双入口（reviewWord+settleFreshFor），模糊不记。
- companion 前批（{name} 模板化/ChatStore/小书童/AI 密度）**已随 e254118
  一并落提交推送**——「未提交 7 文件」旧账清零；全局悬浮层收尾=onload
  mountCompanionGlobal 挂 body、onunload 卸、quiz 旧 API 清退、WordApp
  内嵌摘除。
- 部署：dist+i18n 已拷机器A插件目录（md5 一致）；思源当时未运行没做 petal
  热重载，**下次启动思源自动加载**。验收要点：旧 words.json 首次加载自动
  v3 迁移（词头 key）、头部书名可点切书、起点面板导入 csv/json、首页不再
  崩、答错词重新进误认本（AI 待分析数>0）。
