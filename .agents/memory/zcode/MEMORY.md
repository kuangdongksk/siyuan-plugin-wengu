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
