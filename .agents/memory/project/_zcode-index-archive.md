# zcode 索引归档（2026-09-18 迁移留档）

以下两份内容索引原位于 zcode/ 子目录，文件按内容类型重分类后索引失效，特此留档（条目摘要以各文件 frontmatter 为准）。

## 中央库批次（原 zcode/MEMORY.central.md）

- [20260917 调度：移动端「继续上次」三缺口修复](scheduling-20260917-mobile-resume-fix.md) — 报障「每次都是新的开始」#167→PR#168 一次过并装机；探测只读（NPC 自修选卷劫持回归）、恢复卡自带会话禁二次探测、count 轮写 scopeIds、MobileDrill 490→468 行生命周期收口进 MobileRound；轮询 PR 勿 grep list-pulls 扁平字段；dev=5b8acc4
- [微信小程序政治刷题独立产品方向](wx-miniprogram-quiz-spinoff.md) — 20260917 定向：做题部分抽小程序只做考研政治选择、目标 2026-10 上线；关键路径=注册+ICP 备案立刻启动；前端原生+TS（Svelte 重写、纯 TS 数据层可搬）、后端微信云开发（~¥19.9/月）；个人主体不能开微信支付（变现仅流量主广告 1000UV）；版权定调=真题+AI 原创题替代机构书原题（公开分发侵权风险实质）
- [20260916 晚：移动端两报障全链修复](scheduling-20260916-evening-two-mobile-fixes.md) — #163 选项三字母（移动端 QuestionBody 少过 optionDisplayMd + 政治五套题双标签 2411 行，stripOptionLabel 循环剥层封顶3）→PR#165；#164 交卷静默吞已选（#105 两段式确认×#158 空轮静默关轮组合陷阱，isPickedUnconfirmed 唯一判据+MobileEndGuard 第二态弹层）→PR#166；同域串行两单、端到端装机验证过；dev=e833be0
- [移动端前端复现通道与装机坑](siyuan-web-mobile-entry-dock-repro.md) — /stage/build/mobile/ 入口+390×844 视口；dock 按钮在屏外须 evaluate 程序化派发点击（选择器 sidebar-<plugin><type>-tab）；装机 i18n 必须拷插件目录 i18n/ 子目录（拷根级=界面显示原始键名）
- [cnb git fetch「仓库不存在」解法](cnb-git-fetch-keychain-stale.md) — osxkeychain 旧凭证作祟（API 正常、仓库存在）；20260916 已根治=gitconfig 配 credential "https://cnb.cool" 空 helper 重置行 + !cnb git-credential（SSH 不可行：22 无路由/443 是 HTTPS）；旧 token 失效只需 cnb login 重授权一次 CLI 与 git 一起恢复
- [CNB 额度与 AI Credits 计费三本账](cnb-quota-billing.md) — 20260916 定：NPC 烧开发核时(3200/月)+AI Credits、quality-gate 烧构建核时(160/月，月耗一二十核时)，质量门不烧 credits；实测综合价 0.119~~0.188 元/MTok=缓存命中已 ~~95%、7166 credits≈176~~278 次召唤=30~~44 天；省法=闲时召唤半价(高峰仅工作日 9-12/14-18 北京时间)>退修走 PR 线程(issue 档贵 58%)>给全退修上下文；攒批召唤已否（牺牲审查粒度）；缓存机制=池按模型共享跨会话不隔离、命中靠前缀单元完整匹配（A+B/A+C 首对不命中第三轮起才命中）、~90% 命中来自会话内复读而跨会话只吃脚手架前缀、换模型=换池、输出永远全价；遗留=.cnb.yml:26「¥0.00/MTok」注释待回填实测口径
- [20260916 调度：全天七单收口+三单在途](scheduling-20260916-walkthrough-fixes.md) — 晨 #141/#133（种子洗牌定案）/#142 全并+整改G 派出；午后四单全并（#150 专题三钮+更多菜单 / #151 AI 滚动链恢复 --fit 白名单 / #144 prompt 九项 / #149 收卷链三合一含 NPC 自查三断链），#143/#145/#146/#147 全关；#131 真机核实生效（16 道政治题全对）；仓库转移 bianchao777/sasa（旧路径提及零触发已修，8233417）；傍晚审查轮 #152/#156/#157 全并（#157 退修：移动端仍引用 endRoundEmpty 须恢复键；NPC 自查补开轮即 upsert 须 removeSession 抹记录）；晚间续派 #158→PR #159 一次过、#153 背单词美化→PR #161 一次过（良性突破题面红线两处已核实）+NPC 笔记订正 #160，当日 Issue 全关清零；装机 dev@3f87f29；教训=#145 修错位置、#149 空轮闸方向反了、删分支后 fetch 带回未传播分支须补删
- [20260915 调度：AI 面板链收官](scheduling-20260915-aipanel-chain.md) — #91/#93/#94+#101/#103 全并，傍晚接管审查 #102（开刷面板同步设计稿屏①）关 #100，dev=5363e83 清零；教训=文案测试要成句级断言、判据落 core 才有回归锁、禁 document 级全选、cnb 评论带反引号必须 body-file
- [仓库系统性整改计划](repo-systematic-cleanup-plan.md) — 20260915 定：#105 已关、#104(d2ad524)/#106(de67a2a) 均并；AGENTS.md 已拆分（170415e，域笔记入 .agents/memory/ 十二模块+legacy 归档）；六审计单 #107-#112 并行只读审查在途（SCSS 新规=非通用样式写入组件文件），报告齐后开整改单
- [派 NPC 不直改、不浏览器循环调试](npc-first-no-browser-loop.md) — 20260915 用户两条纠正：业务修复即使本地已实现也要还原走 Issue 派 NPC（#105 实录：诊断结论写成改动清单+验收标准+禁区）；诊断靠读代码，MCP 浏览器只做一次性抽查
- [移动端刷题 UI 单在途 #105](mobile-drill-uifix-issue-105.md) — 作答两段式确认（防误触）+滚动 touch-action 加固+主 CTA 实心（b3-button--main 移动端样式表没有）+三图标移动端精灵图缺失（iconGrid/Flag/Doc→List/Bookmark/File）+optionInline 单项列表剥壳（桌面同病）；工作区已还原干净 dev 并回部署
- [做题交互收口进度 12/13/14/21/10](quiz-interaction-issues-12-13.md) — 20260911 全部关单（PR15/16/17/24/25/11 均并）；#25 修 steps 收口快照与反悔账；#11 移动端已并待真机；ZCode 接管调度清尽在途 PR
- [20260914 接管：#61 退修与 #53 链](zcode-takeover-pr61-issue53-chain.md) — 当日全部收官：#64/#61/#65/#66/#67/#68 六 PR 全并、#59/#53/#56/#57 全关、远端零残留；教训=并行判定要算消费方 import 交集 + 审查查合并态行数 + 轮询基线 sha 必须全串
- [多 AI 并发落盘审计：死锁不可能](ai-concurrency-write-audit.md) — 20260914 全仓落盘通道定论（并行只在 AI 调用层、各店串行链、单飞闸+内核原子写）；QuestionBank 无链小丢窗口已获用户授权直修并落地（08a31f3 推双远端+装机）
- [线索颜色全透明=令牌裸名 bug](clue-color-token-names-bug.md) — 20260914 全收官：#71/#73 后，下午三 PR 全并（#78 在途闸 af430cb 关#76、#79 流级横幅 86200d7 关#77、#75 段表哈希 567a33f 关#74 退修一轮）；75e8132 阅读间距误入已摘存 feat/reading-spacing 分支待实现单认领；新坑三条=出稿 HTML 必跑 prettier（否则挂全部 PR 质量门）、CNB PR CI 用 merge-sha（head≠CI sha 非异常）、update-issue 关单必须带 --state-reason
- [Open Design MCP 出设计稿](open-design-mcp-design-comps.md) — 三稿在库（阅读组题/转换停止/双端背单词，后者 20260916 出稿+换 Neo+ 深暖令牌 4da21d5，实现单待派）；OD 出稿 prompt 应直接要求按 theme-tokens-neo.md 落色省返工；socket 换批自愈=lsof 找活 sock、轮询用常驻连接、macOS 无 timeout
- [滑选标注与英文卷面保真](quiz-annobar-select-clue-redesign.md) — 20260911 定诊：页签拖选被宿主 .layout-tab-container user-select:none 禁用（浮条全废）、MdRender div.p 零段距、线索只限材料组+无视觉锚+词条被转换剥光；Issue#26 修复单已派 NPC，第二单（跨题型+持久高亮+词条保真）待 #26 并后开
- [CNB NPC 云端开发全流程首跑](cnb-npc-full-workflow-first-run.md) — 20260910 Issue#7→NPC 23 分钟出 PR#9→审查合并闭环；CLI 命令口径（close 不认 --repo 用 update-issue、PR 描述要 -v、Ref 不自动关 Issue）；worktree 审查坑（pnpm verify-deps 崩→直调 node_modules/.bin、svelte-check 5 条 node_modules 假错）；NPC 基线竞态=dev 落后 1-2 提交无冲突即放行；合并后收尾三步=验并入→删远端分支→fetch --prune（用户定规）；模型=青简 deepseek-v4.1-flash/复核 glm-5.3-flash（audit 实证，glm 从未召唤）、NPC 会自行复审补漏多轮出 PR（退修轮询盯 head sha）
- [AI 会话管理面板落地](ai-session-manager-panel.md) — 20260831 rail 第五钮+agentChatOnce track 登记+agentChatContinued 回放续聊；登记簿=ai-sessions 文件无后缀 {items,turns{role,text}}；20260903 左栏树改种类优先两级（转换→文档→调用，跨次运行同文档合并，渲染不再按运行组）；0903 三批已提交(b8d6966/14abfa1/5d40e27)且已随预览修复装机；「绘画」=「会话」同音笔误
- [存储架构：题库即唯一真相（两级演进）](storage-arch-ial-vs-bank.md) — 20260831 运行时数据自托管进题库；20260903 彻底 pivot：转换零落盘、题集=库内实体（BankSets 推导存量零迁移）、AI 知识树不落文档（KnowTrees，节点 id 铸内核块形态保 kpRefs 往返）、DriftWatch/文档管线全退役、源删不级联；引擎否决记录（IndexedDB/SQLite/CSV 全毙）
- [全部习题聚合合刷](aggregate-drill-all-exercises.md) — 20260903 86dbf33 已装机待真机验证：虚拟专题 "all" 不落 collections（轮次 col:all）；顺序冻结=题集插入序×集内 qids 序零重排；题号栏 hover 标题用原生 title（滚动容器裁行内浮层）；顺修专题模式 hasDoc 回归；已随 16f88d4 提交推送
- [并行会话污染构建的处置](parallel-session-worktree-build.md) — 主仓混入另一会话半成品时用临时 worktree 只带自己改动干净构建；zsh for 不词切分用管道 while read；自己未提交改动会被对方提交顺带收编（不重做、核对在库）；0902 新坑：自己编辑过的文件也会混入对方 hunks——提交前逐 hunk 核对归属，污染了用 base 重放+换入换出拆 fix-commit；0903 晚新形态：对方会有计划代提交（提交说明预告「代码随下一提交落地」），动手拆分前先重查 git log/status，自己的活已在 HEAD 就核对即止，「提交推送」可能已被对方整个做完；0908 定型细节：checkout 后须重 Read 才能 Edit、重放 old_string 按 HEAD 重写、恢复后 md5 对账、提交独立性=worktree+软链 node_modules 跑 tsc（对方中途提交无需干预）、eslint 挂了会 && 短路 prettier
- [机器 B 工具链坑与根治](machine-b-env-pitfalls.md) — pnpm「Cannot set property message」崩已根治（全局对齐 packageManager 锁定版 11.4.0；bump 版本须同步升全局）；webpack 零 CPU 卡死=清 node_modules/.cache；外置卷瞬时 EIO=内核原子写孤儿 {name}{随机}.tmp（主文件 mtime 仍在前进即一次性，复发才查盘；内核侧写失败对插件不可见）；装机校验探针用属性名（minify 改写函数名）；关机态部署冷启动自动加载
- [思源 v3.8.2/3.8.3 插件 API 升级评估](siyuan-382-plugin-api-upgrade.md) — 3.8.2 十四条已核实；20260907 机器 B 内核实测 3.8.3（customBlockRenders/addToolbarItem/onDataChanged/getBlockKramdown tag 分隔符）；npm 类型包 1.2.7 已带新 API、仓库锁 1.2.4；机器 A 仍 3.8.1
- [增量哈希省 AI 成本方案](hash-incremental-convert-proposal.md) — 一期路由缓存（4345eac）+二期增量重转换（8cb837b）落地，三期评估后搁置（c170721 定论+KnowRef 拆分收口）；真机验证待跑（思源两轮未运行）
- [AI 路由机制与返回可见性](ai-route-two-level-mechanism.md) — routeKnowledgeDiag 两级漏斗（章→小节）+parseNums 数字提取容错；四调用点；20260909 三弹窗改按批 15 题/批（routeKnowledgeBatchDiag/routeKnowledgeBatchCached，逐题指纹缓存保留，批量小节编号=并集清单下标）；已实现未提交未装机；用户想展示每次 AI 返回原文（onReply 回调方案待拍板）
- [AI 转换方向](pivot-to-ai-block-conversion.md) — 输入后移，先定题目块契约；UI 弃 dock 改顶栏自定义页签；最新(40dc7c7)：块优先契约(超级块容器+part子块)已落地，页签用 Lute+ProtyleMethod 渲染整文档题目；2026-08-25：全分支合流并入 dev(d6712d5)且机器 B 已同步装机
- [思源数据目录](siyuan-data-location.md) — 工作目录位置、插件部署目标（扁平布局无 dist/ 拷到根；根级 i18n 副本 0903 已消失只拷 i18n/）、.sy 加密不可离线读；setPetalEnabled 参数=packageName 非 id，换脚本必须 disable→enable 循环
- [UI 一致性反馈](ui-consistency-feedback.md) — 用户贴 DOM 说丑；输入必挂 b3-text-field、图标钮统一幽灵风格、单图标禁全宽 outline、弹窗挂 wengu-dialog、薄信息行合并、主操作居中、长表单 details 折叠、转换中页签只读渐进预览+页内转换条（弹窗即开即关）、文档 id 字段一律选择器+标题回显（有选择器即删输入框/提示、无关模式收起）、长任务状态住页面不锁弹窗、动态回显直接放行 hint（b3-label__text 挂 echoAct：选中替换提示、清空还原 dataset.orig；禁 config-items 插裸 div、也不另造平行槽）、词卡作答后=详情视图且词条贴顶下排（垂直居中方案作废）、查词列表行=文档树 ghost 风、hint 文案禁开发理由/迁移备注/黑话要简洁易懂（0903 全量清扫 ~28 处双语+「串行并发都可选模型」纠错三键，已随预览修复装机并提交推送(66c8f36/16f88d4)、0903 第十七条：预览卡头「查看原块」钮只对存量题渲染（gen- bank-only 无块可跳）、卡头 auto margin 只许 title 一处（两 auto 并存把中间簇挤居中）
- [转换管线待定](convert-pipeline-pending.md) — 实测参数（5000字/批空行切、检测窗 12000 字 N+）；0903 一题一答硬保证（答案节并入父题块 369→189）+重导入检测摘要弹窗（省费模式不再静默直跑）已装机已提交(66c8f36)待验证；0903 用户提议让 AI 切块已三理由否决（指纹确定性/成本/静默错误，待用户回应）；单题绑定异常=整页加载失败（先查选择器拼写）
- [产品决策](product-decisions.md) — 6 条已定决策，不再重新讨论
- [Svelte 渐进迁移路线](svelte-migration-roadmap.md) — 六批练手优先序（companion面板✅→bank→review→stats→convert→quiz）；施工手册=仓库 docs/svelte-migration.md（四件套+暗雷清单，开工必读）；check:svelte 用 tsconfig.svelte.json
- [UI 渲染选型](ui-rendering-strings-not-vue.md) — 2026-08-27 方向定为 Svelte 5 渐进迁移（取代「不上框架」旧结论）；字符串模板维护铁律（重绘丢监听/快照重放）在未迁区域仍有效
- [工作规则](work-rules-siyuan-plugin.md) — 真实思源验证 / tsc 零错误 / 先查 .d.ts / 参考插件
- [sy-lively 兄弟插件](sy-lively-sibling-repo.md) — 同父目录同作者插件；内核 API 工厂与目录组织借鉴源（已迁入 src/siyuan），用户常指路「看 sy-lively 的方式」
- [思源 API 模式](siyuan-api-patterns.md) — attributes 表与 SQL 聚合、attr API、Protyle 取文档 id、AI 接口单向（插件不能直接调用内置 AI）、Lute.New+Md2BlockDOM 渲染公式要点、弹窗容器无 max-height（长内容须自封顶）、exportMdContent 丢自定义 IAL、有序列表序号是 protyle-action 文本（ABCD 化用 counter 覆盖）
- [git 远端与推送](git-remote-push.md) — 无 gh CLI 用 git+SSH 推 origin；20260910 起开发全走 CNB issue+NPC（本地只调度、业务代码不直接改/推 dev，唯一例外=.cnb/ 调度基础设施，细节以 AGENTS.md 为权威）；两机并行史与 rebase --skip 结论；20260914 用户点名例外=小修本地直改+直推 dev 双远端（8affba9 已 cnb+origin 双推）；20260915 收窄=仅限用户当次点名「你来改」，报障修复一律还原工作区走 Issue 派 NPC（见 npc-first-no-browser-loop）
- [MinerU 素材](mineru-material-location.md) — 题册目录与 markdown 结构注意点（解析器输入）
- [用户碎片式报障风格](user-terse-reports.md) — 无标点长句混症状与方案指令；整句拆解+根因排查后自主实现，误报文案常指状态机泄漏
- [Svelte 迁移孤儿选择器](svelte-migration-dead-selectors.md) — 单词域样式神秘失效先查旧渲染器 data-act 属性选择器失配（查词行已踩坑）
- [思源 Web 端 UI 调试](siyuan-web-ui-debug.md) — control-browser 开 127.0.0.1:6806 实测插件；锁屏密码=conf.json accessAuthCode；dock 定位与只读布局测量技法
- [思源 Web 端必须用 desktop 入口](siyuan-web-desktop-url.md) — URL 用 /stage/build/desktop/ 不是 /stage/build/app/，用户已多次纠正
- [思源 Web 端授权流程](siyuan-web-auth.md) — 解锁页 /check-auth、API 端点 /api/system/loginAuth{authCode}；内核重启后前端卡「点击刷新」先查 auth；petal 重载曾伴发内核退出
- [单词四步梯定稿](word-ladder-final.md) — 英选中→中选英→听音选义→英文回想（口述版，readalong 挂账）；仅认识前进；pipelineLadder 四词错峰；三档全阶段 认识(1)/模糊(2)/不认识(3)；词尾四点梯进度（listen 步隐藏）；0901 听音卡/英选面/详情三处接音标
- [词头音标自带 ECDICT](word-phonetics-ecdict.md) — 20260901 听音选义展示音标：gen-phonetics.mjs 从 ECDICT 提取 4.7 万条自带、WordPhonetics 惰性按 wordKey 查、三处展示（中选英/回想面不展示防泄底）；词典 API 本机不通故离线；装机回验过未提交
- [单词卡冒泡翻面坑](word-card-bubble-flip.md) — 推进按钮点完换卡后同一次点击冒泡到卡根把新卡误翻面；容器级 onclick 必挡 button/input
- [看板娘与公式速记计划](mascot-and-latex-input-plan.md) — 20260827 新功能意向：陪伴看板娘（硬信号规则+软语境内核AI 两级）与思路→LaTeX；插件内 AI 只有 chatGPT 端点一条路，顺序①规则版看板娘②公式速记③语境表情
- [伴学看板娘已落地](companion-mascot-plan-deferred.md) — 20260827 三轮迭代装机（dev 链 3ec8a71 三栏+看板娘 / a5889ff AI 并发 / 7a73abb rail 漏拼修复 / cfd8db2 formRow 撑满父宽）：src/companion/ 架构速查 + 两踩坑（每条新渲染路径都得拼 renderRailHtml；formRow 不在 .config__items 父容器里需 width:100%）；IAB 真机看思源 Web 端裸奔，下次 UI 异常让用户直接贴 DOM 片段
- [知识文档关联现状](knowledge-doc-association-status.md) — 关联三路齐全（2026-08-28）：转换路由/事后「匹配」MatchDialog/「转习题」预填；导入递归展开、层级 h1~h6；面板两死交互（树 key 不一致/按钮 docId 空值布尔）
- [知识标签三套系统割裂](knowledge-tag-three-systems-split.md) — 20260831 定诊：knowledge 文本/kpRefs/专题互不归一，AI 裸写无约束致「洛必达≠洛必达法则」裂键；kpRefs 主界面不可见；三点改造方向待拍板
- [看板娘悬浮层方向感知](companion-overlay-direction-aware.md) — 定位坑链定稿（8dd7c9b 团子恒锚）：锚随朝向换轴+分轴钳位；「只钳团子」WIP 已废弃
- [功能后审查清单](post-feature-review-checklist.md) — 提交前文档三件套（契约/AGENTS 域描述/CHANGELOG）；全仓审查项；停止键别 disabled
- [dataset 空属性坑](dataset-empty-attribute-pitfall.md) — 空值 data-* 布尔标记 dataset 得 "" 非 undefined，?? 链短路吞分支；标记判存在、业务 id 从所在行取
- [0.1.1 发布审查](release-review-0.1.1.md) — 检查链全绿可发布；五提交收口（775995d 六修 / 459f071 删纯迁移码·用户拍板单一用户 / e7e2ba7 批空产出告警 / deb6e55 模型回落提示 / 1597f8a prompt 内容筛选例题引言小结不转）；发版审查单+删迁移码边界（ensureMigrated 兼首扫入库勿删）可复用
- [Tauri 独立应用平迁方案](tauri-migration-plan.md) — 20260907 晨判废弃当晚用户重新打开（温故 UI 自绘度高平移成本低；自主性差距未被 3.8.3 抹平）——与三期存储块化互斥且三期是单向门，方向待拍板；M0~M6+耦合点/直搬资产清单仍有效
- [3.8.3 自定义块深化路线](custom-block-question-pivot-proposal.md) — 20260907 定盘思源深化（Tauri 废弃同日）；一期视图层已装机真机验证（;;;wengu/question content=qid 只读渲染+面包屑插入入口，存储零变更）；二期块内作答/三期存储块化待拍板（三雷：undo 回滚/高频写窄通道/用户可碰数据）；createDocWithMd 三参分离坑已回填 AGENTS
- [转换返回格式协议化方案](convert-return-protocol-plan.md) — 20260902 定诊纯标题段空批（9/159 空 AI 调用，修=发批前跳过）+ AI 返回 kramdown→行定界协议改造（否决 JSON 与 YAML——数学 LaTeX+中文踩满缩进/冒号/井号雷，安全性 行协议>JSON>YAML，标记加 @@ 前缀防碰撞；渲染器复刻落盘形态零存量影响）；等拍板- [知识面板小节树乱序根因](knowledge-heading-order-sql-pitfall.md) — MinerU 语料块 sort/created 全退化、ORDER BY sort 任意序（23/23 文档中雷）；文档序唯一可靠=getBlockKramdown 解析；四处同雷；kpRefs 全空=设计内零命中
- [索引树章节名回声剔除](knowledge-tree-chapter-echo.md) — AI 首个 h1 回显章节名成双层嵌套；stripChapterEcho 去编号归一+头部连续 level-1 剔；生成/重索引对齐/展示三侧接入，存量树读时免迁移(7162351)
- [全仓审查修复 20260909](review-cleanup-20260909.md) — Armed/debounce/openWenguDialog/mintTsId/kramdown 五底座收口+死代码根除，已拆两笔提交(c8bc916/1c62857)已装机；type*/clue/status 动态拼接是活的勿删
- [prompt 集中收口+生题题型化](prompts-centralization-type-scoped-gen.md) — 20260910 src/ai/prompts/ 八件套收编 26 处（纯搬迁 8debc7d 逐字一致）；d676148 题型化：检测 TYPES 行顺带报题型→buildPrompt 先 size=types 裁剪（undefined 全量兜底逐字节），setTypeUnion 零 AI 题集先验、brief 恒含兜底、开关产出题型恒在；已装机验证
- [报障偏好=直接修而非逐卡](structure-repair-prefer-direct.md) — 20260910 体检结构损坏改弹窗内批量 AI 重生成（RepairDialog 勾选+regenRecords 复用 runRegen quiet）；原则：能确定性修就勾选零 AI、需补内容就后台批量 AI，别再逐卡 push
- [AGENTS.md 膨胀已整治（20260915 拆分）](agentsmd-bloat-consolidation-pending.md) — 20260910 用户嫌 AGENTS.md 太长（576行/44KB，项目速览占半）；诊断=append-only 考古层；同日已拍板=分条改列表（重排可读、内容一字未删、尾段 diff 校验），内容缩减方案未采纳；真精简另议
- [文档用分条列表不用长段散文](doc-prefer-structured-lists.md) — 20260910 AGENTS.md 项目速览重排成每域小标题+逐条列表；写文档默认分域分条、一事实一条，保留硬约束与日期备注只是拆句不删意

- [回复必须带 PR/issue 链接](reply-with-pr-issue-links.md) — 用户明示；CNB 链接 = 仓库路径 + /-/issues/{n} 或 /-/pulls/{n}，仓库私有匿名 404 属正常
- [阅读面=材料组结构、不是英语判别](reading-face-is-structural-not-subject.md) — 20260914 用户拍板纠正 #83：材料组（一题多问）全学科通用（英/语/政/史/工科），阅读面无条件美化（固定组件 GroupUnitApp 自判有 material 即挂）；题型≠学科（并集代理必双向错：纯阅读英语卷假阴、语文卷假阳）；学科只服务标生词等语言专属功能（subject? 字段+SUBJECT 判定行，存量回退题型并集）；混合刷按题集分组各判各段
- [滑选/排版/词条批次 26-33](reading-select-gloss-batch-26-33.md) — 20260911 全合并含复审修复 #34/#35 并装机：chips 静默早退、坐标同源、数学豁免、倒序落格；坑=NPC force-push 后 CI 挂旧 sha 本地必补跑；待真机走查
- [浮条查词/长选段/批量转换 36-37](annobar-wordlookup-batch-convert-36-37.md) — 20260911 排查定案：查词弹层冒泡自关实锤（同步注册 document 关闭监听被同事件吃掉）+用户定夺做题禁查词、120 字符浮条闸、跨节点高亮缺失、桌面端点击未复现走防御修复；#36 已派 #37 待派
- [CNB 额度与 AI Credits 实测口径](cnb-quota-credits-cache.md) — 构建/开发两本核时账互不侵占（NPC 走开发账不碰构建 160 核时）；credits 综合价 0.119~0.188 元/MTok 已含缓存命中；挪闲时（工作日 9-12/14-18 之外全半价）是第一省钱杠杆
- [ZCode 记忆槽位哈希方案](zcode-memory-slug-hash-scheme.md) — 槽位名=仓库名+sha256(工作区路径)前16位，可离线预建/反查任意仓库的记忆目录

## 仓库批次（原 zcode/MEMORY.md）

- [20260915调度轮](wengu-dispatch-20260915.md) — PR#126/#128/#130 全合并部署；**实锤转换链#123同款答案错位(32/220)**→用户拍板「库死形态+〔opt:X〕标记替换+展示洗牌」#131青简实施+#132复核prompt全量审计并行在跑；合并必须走merge-pull API；插件存储在data/storage/petal/；召唤后必核pipeline_id
- [桌面刷题界面对稿重设计](wengu-drill-redesign-20260915.md) — 用户点名题号栏/头部/考点chips/自评星/错题本为基准+**硬约束桌面保持多题长卷**；OD项目=root仓库design文件夹(import/folder API)产物直落；sidebar-gap-list.md+wengu-sidebar-redesign.html已入仓待过审→拆Issue；分隔条按antd Splitter语义+切题集二次确认
- [视觉对比丢给OpenDesign](feedback-opendesign-for-visual-compare.md) — 20260914用户批评我对比太粗糙：实现vs稿差距分析必须派OpenDesign逐元素对比(稿值/现状值/修法三列)+细化稿到照抄精度，别自己人眼粗看下结论
- [OpenDesign MCP实操](wengu-opendesign-mcp.md) — 喂料法=prompt给本机路径/本地服务URL不传参；running+mtime静态≠挂禁cancel；tail events.jsonl看进度；5-30分钟/单
- [20260914调度轮](wengu-dispatch-20260914.md) — 审并合并PR#84(阅读面材料组判据+subject两级)与#86(横幅对稿)；#87/#89材料内滚+#88/#90面板对稿已合并装机(fcc19b3)；用户批对比太粗→OpenDesign对比run跑着(差距根因=实现只抄结构没抄数值:grid一体卡/292px树/三级缩进14-27-42)；移动端#61功能腿已并视觉还原未做
- [批量转换中断续跑#62](wengu-batch-convert-resume-issue62.md) — 已合并PR#63→dev 109f5a8未装机；三块机制+P3边缘(进行中丢弃进度)挂账，真机验收待用户

# MEMORY.md

- [重叠线索丢mark+主题多色](wengu-clue-overlap-multicolor.md) — #56并集合并(长覆盖短)；#57改版=用户选色制(标线索二级竖排色板/独立ui/ColorMenu组件/clueColors平行字段-1默认黄)body已更新；队列#52→#53→#56→#57

- [线索锚点改造已开Issue](wengu-clue-anchor-redesign.md) — **#52已合并(PR#60→d95bc6f)部署工作区**：ClueCanon权威坐标系+MaterialDecorate单出口+clueRanges；审查战果=我审3缺陷与NPC自审5缺陷互证(CanonMap缓存别名错位实锤/选项行丢失)；#53三期吃#60产物待派；真机待验线索嵌套+iOS sup
- [英语标线索不高亮#51](wengu-english-clue-highlight-issue51.md) — **已合并(PR#54→5f56c90+收尾#55→2846d81,我审)**：真根因=SKIP_SELECTOR含gloss-link排除匹配文本源(「占两遍」REJECT假说被推翻,SHOW_TEXT下REJECT≡SKIP)；残留=GlossDom头注旧互不嵌套文案待顺带修；真机验证待用户(选段跨联动词出mark、上标不包)
- [移动端刷题需求](wengu-mobile-drill.md) — **#61功能腿已合并(src/mobile ~2700行)但照稿视觉还原未做**(101区块稿vs六组件骨架=用户「感觉没开始」根因)；设计稿design/wengu-mobile-drill.html与OD原版101区块一致无需迁；下一步=OpenDesign对比流程(最好先要用户手机实拍)；桌面定夺不改版；坑=召唤提及顶格+daemon无头启动+断流重试+截断从.file-versions恢复+Chrome无头截图保底路
- [20260913调度轮](wengu-dispatch-20260913.md) — 三连已执行：并行约定推dev(1b9eab0)+PR#60双轮审查合并(d95bc6f)部署+#59并行召唤(顶格重发才触发)；#53/#56/#57线索域串行待派；#44/#45/#46/#51议题未关待清
- [NPC并行按改动面交集](feedback-npc-parallel-by-overlap.md) — 同域串行/异域可并行已落AGENTS.md条文；**召唤提及必须顶格**（引用块不触发流水线零报错），发完必查build-logs确认issue.comment@npc真起了
- [合并后清理闭环](feedback-merge-cleanup-closure.md) — 用户定：PR合并即关关联Issue(收口评论带sha,update-issue --state closed --state-reason completed)+删远端分支，只留dev；在办不动；调度轮收尾必做
- [标记错题功能#46](wengu-badmark-issue46.md) — **已合并(PR#50→fc2c203)**：badMark?:"1"字段(srcStale同款)+regenRecords现成通道+成功自动清标记；语义=题目本身有错≠错题本作答错误
- [浮条两bug已修](wengu-annobar-bugs-issue45.md) — 随PR#49合并(97eb02c)：模式闸只quiz放行+标生词卷级判定；坑=组题材料面板不在卡里按组内可见卡反查
- [相关题弹窗联动设计稿](wengu-related-dialog-upgrade.md) — 20260913已过审落地Issue#44(见上)；坑=collectQids口径≠questionsRelatedToDoc(源文档命中漏检)不能复用col-kp-{id}活视图、slice(0,50)截断要移除
- [20260912调度轮](wengu-dispatch-20260912.md) — PR#38/#40/#41全合并(浮条标注+know-index+批量转换)dev@eade976两区已部署；#37验收=肖秀荣题解版5子文档队列；定时自动化每30分钟跑(不召唤NPC)；思源已升3.8.3、wmic已废；晚:Issue#42空壳判定回归→PR#43已合并(ebd3929)已验收;教训=CI绿≠本机绿(localeCompare漂移)+壳文档判「有无正文」非「有无块」
- [know-index改造已合并](wengu-know-index-issue39.md) — Issue#39随PR#40并入dev(3bfe86f)已部署两区；真机验收=测试区张宇概率六章(噪音不出树+块级跳源)；计划B题目srcBlockId已解堵，开Issue前先出设计稿过审
- [两块改动分开做计划](feedback-plan-scope-split.md) — 一个计划/Issue只做一件事，相关事另开并排队；20260912用户否决混合计划
- [一律用官方工具](feedback-official-tools-first.md) — 平台操作先想官方CLI(CNB→cnb-cli/GitHub→gh/包→pnpm)，禁内嵌token/裸curl旁路；20260912用户定夺
- [cnb-cli凭证链路](wengu-cnb-cli-credential.md) — cnb login(OAuth2设备流)+git credential helper已接(机器A)，内嵌token remote已废弃；fetch报「仓库不存在」先cnb status辨凭证；API取token走cnb git-credential get；调度只读查询=list-issues/list-pulls/list-pull-files/list-pull-commit-statuses(输出缩进列表grep提取)
- [查存储先读代码](feedback-storage-layout-from-code.md) — 「数据存哪」先grep saveData读代码(键名/数据源分叉：持久店vs实时查内核vs treeHeads并流)；SQL参数是stmt；20260912三连纠正
- [输出必须带链接+项目记忆位置](feedback-output-with-links.md) — 汇报对象首次提及即附可点链接(CNB Issue/PR/构建/本地文件)；持久协作偏好写仓库根 .zcode/MEMORY.md(用户指定,gitignore已收录)
- [弹窗去阻塞wave](wengu-dialog-deblocking.md) — 20260905七AI弹窗点击即关窗+launchAiFlow单飞闸+面板停止钮(abortAiSession/onSid)已提交推送(bd03097)部署两区；转换流有意不接面板停止；新AI弹窗照抄该口径
- [选项挤行修复](wengu-option-packed-repair.md) — 20260905拆行修复(OptionShuffle.unpack+BankRepair+题库体检入口)已提交推送(bd03097)部署两区；21条待用户点体检执行(习题614多选走重生成)；答案按首行=正确项重写，判分错先怀疑此假设
- [computer-use先核receipt](feedback-computer-use-verify-receipt.md) — 点后必看resolved_app_ref是否目标应用；用户实时用机(全屏游戏)时放弃UI自驾留手点路径；曾误点进游戏
- [410生命周期噪音收口](wengu-410-lifecycle-noise.md) — 20260904已修完推送部署两区：flush撞isLifecycleGone不弹不重排、void save()链尾.catch；再遇410辨来源——toast格式化文案=已捕获/控制台裸JSON=漏.catch；mock Notify断言前须mockClear(调用累计跨用例)

- [Tauri平迁方案已废弃](wengu-tauri-migration-plan.md) — 20260908 ce2d4bd转思源深化(3.8.3自定义块/标为线索)，自定义块一期revert到feat/custom-block-clue分支；docs/tauri-migration.md仅历史文档，D1-D5台账备查勿再引用为待开工

- [MiniMax 2013图片附件修复](wengu-minimax-image-detail-fix.md) — PromptHygiene占位符往返消毒已部署两区+探针双验证、已提交推送(2db456a)待真机重转验收；新AI通道必须过消毒、prompt示例路径勿以assets/开头

- [20260903 全内部化审查](wengu-audit-20260903.md) — P1×3断链+P2×6+P3速胜已全部修复(20260904)部署两区、已提交推送(2db456a)待验收；SrcChunk ~n失配未证实挂账

- [GitHub 直连/代理顺序](github-push-via-proxy-7897.md) — 先试直连(时通时不通)，败则探 7897 端口在不在(代理进程未必常开)：在→一次性 -c http.proxy，不在→报告用户；勿写全局配置
- [转换固定另存+PDF导入移除](wengu-convert-newdoc-only.md) — 20260901用户定夺:原文档绝不动、writeMode双模式与MinerU管线全删(fflate/ForwardProxy/mineruToken连带)；已提交推送(b48839d)部署两区待验收；机器A思源已升3.8.2(端口49241)

- [知识树方案四块全落地](wengu-knowledge-redesign-audit.md) — □1~□3机制不变(col-kp-{块id}活专题等)；□4 rail四钮次日被b84aab4推翻拆回五钮+专题独立工作区(CollectionPanelApp)，现行为准
- [渲染自包含化](wengu-md-selfcontained.md) — markdown-it替Lute+内嵌Protyle退役(9a53a63)已提交推送部署测试区待视觉验收；markdown-it必须14.1+@types14.2组合+类型反推(两套tsconfig解析)；$桥=tokenizer产思源占位喂mathRender；块引用=查看原文span
- [TreeList树组件收拢](wengu-treelist-unification.md) — 三树已并(知识面板/选择器/刷题侧栏20260830)+ColTreeLevel有意保留(官方树视觉)；已部署测试区待验收未提交；vitest .svelte stub别名须整串匹配；TreeListNode在TreeListTypes.ts
- [进度导入TSV改版](wengu-import-tsv-redesign.md) — 定稿:删PDF,三列Tab,天数列仅复习中,错峰窗口随量自适应clamp(N/100,7,60),复习完成仍进FSRS循环;复制模板按钮+b3-form__upload换装;已部署两区待验收未提交
- [测试工作区](wengu-test-workspace.md) — D:\data\思源\测试 验证部署用；内核端口不固定(wmic读--port最直接,本会话52036,39099回版本JSON但是假李逵)；token在conf/conf.json(ycfl…)；插件目录i18n在根级i18n/非src/i18n/
- [Svelte批次2~5](wengu-svelte-batch2-bank.md) — bank面板(7869fad)+review主区(49bb908)+stats面板(4d5bbad)+convert两弹窗(267b98b)已提交推送部署测试区待验收；Dialog壳/onClose props模式；仅剩批次6 quiz；git add -A会卷并行会话文件须点名
- [AI会话统一](wengu-ai-session-unification.md) — 唯一通道agentChatOnce(278a2a2)队列全退役；20260905追问退役→失败重试(retrying原地翻案)已部署测试区未提交；落盘缺口审计待用户定
- [题集右键两改](wengu-reimport-remove-set.md) — 重新导入+删除此题集落地；20260830修半截脏数据(b03a3e2已部署机器A)：渐进文档=题集常态删前漏读回是根因、双兜底+ConvertBatch断点总闸；机器A内核端口动态(6806过时)；push断连待补推
- [检测总数修复](wengu-detect-count-fix.md) — 分段并行计数求和(b205197)已部署待验收；chunkKramdown挪ConvertService；N+仅分段失败时出现
- [col-folder 已并dev](wengu-col-folder-branch.md) — 新建文件夹+官方文档树已并dev(d95aad7)已部署待验收；prettier会把~规范成~~；并发窗口禁行号编辑
- [opt-compact 分支](wengu-opt-compact-branch.md) — 短选项一行2/4个(Lute剥壳+估宽分档)已实现部署机器A待验收；Md2BlockDOM段落真机形态(contenteditable壳+protyle-attr尾)；□4文档模式ol多列二期
- [quiz UI四修20260829](wengu-quiz-ui-fixes-20260829.md) — 题号栏实测封顶(四轮定稿)/思路描边/内嵌Protyle只读双属性配方/失效modelId总闸(resolveModelId)，均部署；push积压已补推清空
- [间距由布局表达](feedback-spacing-from-layout.md) — JS只测量不决定、拒绝魔法数；「差几像素」类反馈先换实测值——题号栏四轮迭代的教训
- [单词域审查20260829](wengu-word-audit-20260829.md) — P1组边界+空会话已修(760fcf2)+迁移退役(3ae85fd)均部署；P2×2(wordResumeCard缺key/读失败覆写)+P3×7挂账；WordImport 291行退役候选待表态；机器B先同步再开单词面板
- [全仓审查两波修复](wengu-full-audit-20260828.md) — 9P1+10P2已并dev已部署(72b6e8f/60aee73)；③波挂账清单在CHANGELOG；第二轮8P1待点单(quiz恢复编排5+convert链3)

- [用户备战考研，文档为模拟卷集](user-kaoyan-exam-prep.md) — 肖四肖八/李林六套/自动控制原理/英语（一or二未定）；MinerU 导入（文件名≠标题、图在 assets）
- [「你来决定」= 自主决策授权](feedback-delegate-decisions.md) — 分级结论后直接执行，不再逐项确认
- [讨论先给分析然后等用户说](feedback-discussion-style.md) — 「等我说完」：选项别抢在用户表达前；设计先出审核文档逐条过再实施；「先拉取」类口令立即暂停做同步
- [多会话并行操作本仓库](project-parallel-sessions.md) — worktree 隔离+部署先行+对方停下再合并（脏文件原样落盘成独立提交）；GitHub 时通时不通(循环重试有效)；对方半成品窗口会让 tsc/vitest 凭空红，先 git status 辨归属
- [内核补充坑（AGENTS.md 未记）](wengu-kernel-extra-traps.md) — putFile 不吃 JSON、moveDocs 不可用、conf.json 在 conf/ 子目录、getHPathByID 定位父级
- [单词本词表管线](wengu-wordbook-pipeline.md) — wengu-ocr 目录再生成,词表不走思源块
- [steps 题设计意图与待办](wengu-steps-design-intent.md) — 四选项=心算验证（勿当 bug）；申诉/brief 三态已落地；待确认：分类审核预览、检测输入放大 12k
- [PDF导入+原位替换分支](wengu-pdf-import-branch.md) — 已并入dev(03d9075)；规则重编号8~13；仅剩 mineruToken 真机端到端验证待用户
- [word-timing 分支](wengu-word-timing-branch.md) — 全并dev+worktree已清理；题型分流定稿勿回退；addDock同名type坑+存量回填坑+易混组设计债备查
- [词书多考试模型](wengu-wordbook-multi-model.md) — 已实施(e254118)：进度词头化v3+词书房wordbooks/*.json+导入切换UI；考试显式分层未做(单层书定稿)
- [ai-gen 分支](wengu-ai-gen-branch.md) — 题库①~⑥全并dev(a485a5b)；与english手工调和记录(ConvertHost materials透传等)；全链路验收等首次真转换
- [Neo 主题坑](wengu-neo-theme-traps.md) — 用户用 Neo 第三方主题；config__side 被改 overflow:auto → 弹窗横向滚动条；调 UI 须 Neo 下复现验证
- [wengu/english 分支](wengu-english-branch.md) — E0-E4 已并dev(1de759d)；待用户UI验收+挂账优化项清单在记忆
- [math-render 分支](wengu-math-render-branch.md) — 公式裸$根因=siyuan模块无Lute须用window.Lute；已并dev(5b48335)清理完毕；机器A思源已升3.8.1
- [review-mode 分支](wengu-review-mode-branch.md) — D1~D6全落地已并dev(9d2ca69)；enterReviewMode三路统一入口/ConvertAccess拆分模式/错因分布横向条备查
- [2026-08-25 全合流](project-20260825-merge-wave.md) — math/review-mode/topic 三分支并dev+worktree清理；「结束本次做题」+选项洗牌(OptionShuffle)已部署待用户验收
- [数据源从简反馈](feedback-data-source-simplicity.md) — 文档块属性为唯一事实源、只存ID不搬镜像；bank当主源被用户否决
- [思源内置图标 sprite](siyuan-builtin-icon-sprite.md) — 真身 conf/appearance/icons/litheness/icon.js；dock 图标 uiLayout 存量赢→插件图标须稳定 id 注册；包图标≠核心 sprite
- [dock-icon 分支](wengu-dock-icon-branch.md) — 图标稳定id+官方path/选择器下拉化/UI标准§〇4-9 已并dev(8779c6d)已部署，worktree已清；§〇4图标钮wengu-iconbtn(Neo下b3-button--icon带框,6个word组件已换)；图标id勿改只换path；svg巨幅坑20260905根修(3d33baa)——svgIcon自带width/height=14,旧「须进panels.scss 14px清单」规矩退役,新容器裸插即安全
- [背单词改版 wave](wengu-word-flow-redesign.md) — 四步梯已接线(梯序choiceEn→choiceZh→listen→recallEn,readalong出局)+companion学伴域；「剩」×4虚增已修(cfd7193)；团子{name}模板化已部署未提交(7文件)；滚动四步梯设计□全锁(窗口可配/自然流动/答错清零/学复分开/毕业直进复习)+复习算法体检(固定Leitner无自适应、新学梯污染长期档,修法A/B分级)——待用户定A还是A+B再写wordbook-redesign文档过审
- [word-svelte 分支](wengu-word-svelte-branch.md) — Svelte 5 化已并dev(01e3b8f)已推送，worktree与分支已清；svelte构建链坑备查(勿设conditionNames)；§〇 UI标准见dock-icon记忆
- [思源网页版 UI 调试](siyuan-web-ui-debug.md) — 6806 的 /stage/build/desktop/ 免认证直进真实界面（app 构建有认证窗）；截图须 analyze_image 看；CSS 溯源=枚举 styleSheets 命中规则(matches 要 catch)；插件 css 是内联 style 注入，部署生效要查 style 标签内容而非 md5
- [变式重练+侧栏树化一期二期](variant-and-doctree-impl.md) — 全部完成已提交推送(b5cba82/9218a66,20260827)已部署机器A待验收；乱序选项独立小项仍未做
- [预览模式+长卷性能](wengu-preview-mode.md) — 预览/快捷复制/删头部切换器已提交(76496f7)；长卷性能修复(批量装载+>50题静态渲染)已部署未提交；挂账:复习退路、错题回顾完整版意向
- [侧栏源卷专题重复](wengu-source-col-sidebar-dup.md) — 已修(2026-08-26树化S3侧栏过滤doc:行,弹窗仍可见)
- [变式重练+树形化设计](variant-and-doctree-design.md) — docs/variant-and-doctree.md 待用户过□1~□7再实施；变式按题生成核/侧栏hPath树一期、KnowPicker树二期；乱序选项独立小项方案已对齐
- [侧栏右键删除+iconList修复](wengu-delete-doc-feature.md) — 右键「删除文档」(回收站+清库清历史)+专题行图标14px——已随一期提交(b5cba82)推送部署待验收
- [刷题头部吸顶+计时暂停](wengu-quiz-head-timer-fix.md) — 已提交(721d088)；20260830补修头部z-index盖官方弹窗(官方浮层皆z-auto靠body末序,插件根isolation:isolate收口)已部署待验收未提交；push断连ahead待补推
- [团子AI感知密度](wengu-companion-ai-density.md) — 做题侧自适应节流：每题候选/慢节奏≥60s每题发/快节奏150s/批次必触发；已随e254118提交推送；调密度只动rules/Enrich.ts三常数
