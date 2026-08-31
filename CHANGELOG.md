# Changelog

## v0.1.1 unreleased

- 树渲染三处修复（20260831，8b9db76 复审收尾）：① TreeList 行壳的
  `b3-list-item--hide-action` 恢复按节点 hideAction 条件挂——上一版
  改成无条件后，多选文档选择器的勾位被思源原生规则 hover 才显，
  已选文档看不见勾；② TreeList 递归处删掉冗余外层 `<ul>`（组件根
  本身就是 ul，此前产出 `<ul><ul>` 双层无效嵌套）；③ 知识文档面板
  toRows 对无文档路径分支硬编码 `children:[]`，嵌套路径的知识文档
  整棵子树不渲染（abb6a4a 收拢 TreeList 时引入），恢复递归——装载
  时分支本就全开，嵌套文档即见。

- 增量重转换（20260831，增量哈希二期，docs/incremental-hash-plan.md）：
  转换切块从「空行偏移切块」换成**结构切块**——标题边界 + 边界键
  （标题链）+ 内容指纹（questionHash 同款），生成时随题目/材料容器
  IAL 落 `src-key`/`src-hash`。「重新导入」对带指纹的整卷完成态题集
  不再删旧全量重转：源文档重新切块后**两阶段三态分类**（先全局指纹
  匹配——子块序漂移/标题改名内容不动都零成本判同；再按键配对变更），
  相同块跳过零 AI 调用（原题与刷题统计原样保留）、新增块串行补生成
  追加到既有题集末尾、变更/消失块弹窗逐块选（重生成=删旧块统计作废
  / 保留=打 src-stale 标记），全部相同时直接收口「源未变化」。设置
  →AI 转换新增「增量重转省费模式」（变更/消失全保留、只补新增、
  跳过弹窗）。中止自愈：已追加块自带指纹，重跑分类即跳过，失败/
  中止路径同样题库幂等重扫（追加块入 records、删除块出 records）。
  有续跑记录（中断未完成）或无指纹的旧版题集照旧走断点续跑/整卷
  重转，升级零重复。新增 SrcChunk（纯函数 14 例单测）/
  ConvertIncrement（读分组 + 落盘执行）/ IncrementDialog（逐块选）/
  ConvertRun.startExclusiveConvertRun（独占运行槽），回填
  EApi.DeleteBlock + KernelBlock.remove。

- 路由结果按题指纹缓存（20260831，增量哈希一期，
  docs/incremental-hash-plan.md）：知识文档「匹配」/「批量关联」AI
  兜底/「生成标签」逐题路由三处共用的两级 AI 路由（每题两次调用）
  接上按题指纹的缓存——同一题在知识索引结构（全部章/小节 id+path
  指纹）与模型未变时重跑零 AI 调用；索引增删章/改小节/退册根或换
  模型即整表作废重建（宁漏勿错，不复用过期路由）；AI 明确判「零
  命中」的空结果同样缓存，但调用失败（超时/网络/模型失效）不缓存
  下次再试。存储 saveData("route-cache")，LRU 上限 2000 条，与题库
  同款 markDirty/flush 串行落盘。新增 bank/data/RouteCache（含
  routeKnowledgeCached 共用入口 + 模块级单例 initRouteCache/routeCache），
  三弹窗换调不动流程语义。

- 题卡渲染层组件化（20260831，Svelte 批次 6-4a）：三类题卡（普通/
  多步 steps/逐空 slots）与材料组壳的字符串渲染退役为组件
  （component/QuizCardApp + GroupUnitApp），静态分片管线逐单元以
  组件挂载替代 insertAdjacentHTML——DOM 契约逐字一致（类名/data-*/
  hidden 全保留），作答/判分/恢复/预览装饰各流程与全局样式零改动，
  行为无变化；为 6-4b「三流程作答态收敛进卡内响应态」铺挂载与卸载
  地基（detachCardApps 补进整壳重建 detach 块与视图 destroy）。
  退役字符串渲染函数七枚 + SlotHtml.ts，DrillUnits 只剩单元组装
  纯函数；StepsFlow 实时模式的步骤 DOM 追加轨（renderOneStepHtml/
  fillOneStep）暂留守，6-4b 随状态化并入组件。

- 题集右键两改（20260829，用户反馈「网络中断会导入一半停止」+「不要
  提供删除文档」）：①侧栏文档右键新增**「重新导入」**——配对源讲义
  （source-doc）仍存活才露出；先查该源的续跑进度记录，**有则接着
  断点续跑**（已生成部分不重复生成/不重复花费；保留的渐进文档删前
  读回内容转进 resume.kramdown，防静默丢失），完全没有记录才从头
  重转；删旧题集（回收站可找回）+ 清题库/会话历史 + 清续跑记录
  （防「全部完成」短路把待删文档当完成态），以上次转换设置另存一份
  新《源·习题》（源讲义不动）；失败自动记回续跑进度。转换事件接线
  抽 convertRunEventsFor/startConvertForView 与弹窗「开始转换」共用
  （页内转换条/停止/渐进呈现照旧）。原位替换终态生成的题集无配对源，
  不露该项（点入报「无源讲义」）。②**「删除文档」改为「删除此题
  集」**——不再删文档本体，只解除登记：文档内全部 wengu 属性置空
  剥离（内核 setBlockAttrs 空值＝删属性，真机探针验证）+ 清题库/
  会话历史，文档与内容原样保留；source-doc 一并剥离后，源讲义被删
  也不会被 OrphanCleaner 连带删除。纯逻辑面（属性分组/reimportCfg
  组装）配单测 DocOps.test.ts。

- 检测总数修复（20260829，用户反馈「检测共多少题远小于习题数量」）：
  前置检测旧实现只把源文档**前 12k 字符**发给 AI 数题，AI 只能数可见
  前缀，长卷（几万字符的模拟卷）检测数必然远小于实际题数（仅靠 N+
  加号提示下限）。改为**分段并行计数求和**——按空行边界以 12k 窗切段
  （复用 chunkKramdown 原语，已从 ConvertBatch 挪到 ConvertService
  供检测/生成分块共用），各段走 agentChatOnce 独立会话并发计数（池
  限 4），prompt 按题干起点归属本段（段首残题不计、段尾未完照计），
  各段之和=全文题数；N+ 仅在有分段计数失败时出现（成功段之和的下限）。
  首段照旧产出 CAN_CONVERT/REASON，首段失败=检测失败不阻断转换（原
  行为不变）。

- 题库静态渲染两修（20260829，用户反馈「还是可以编辑」+ 选项旁泄漏
  `updated=…` 属性文本）：①防误编辑——静态/降级渲染全链路（题干/选项/
  解析/材料/steps）的 Lute `Md2BlockDOM` 输出带 `contenteditable="true"`
  （编辑器 DOM 形态），在 luteToHtml 单点剥除，静态内容纯展示（文字仍
  可选中，「标为线索」不受影响）。②IAL 残渣清理——思源 kramdown 读回
  时列表项/块引用子块的 IAL 行内尾随或带缩进/引用前缀独立成行（题库
  落盘实测 `- {: id="…" updated="…"}A. …`），BankParse 只认无前缀整行
  part IAL，残渣混进选项 md 渲染成 `"updated=…"}A.` 字面文本；splitParts
  现按「整行属性行删行 + 行内尾随片段删片段」清理（key="value" 全形态
  约束不误伤公式），题库每次装载从落盘 kramdown 重新解析，存量数据
  重载即愈、无需迁移。

- 短选项紧凑排布 opt-compact（20260829，用户反馈数学短公式选项每个独占
  一行、右侧大片空白；docs/option-compact-layout.md 方案 C）：内容渲染
  保留 Lute，仅「剥壳」——`unwrapSingleBlock` 把 Md2BlockDOM 的单段落
  块取 innerHTML 成内联 HTML（公式 span 原样，KaTeX 惰性链零改动），
  多块/代码块/畸形选项不剥、整行独占（Lute 异常退 pre 同理）；估宽
  `estimateOptWidth`（公式段定值 8、全角 2、半角 1）分档 s≤10 一行
  4 个 / m≤24 一行 2 个，flex-basis 减 column-gap 份额 + wrap 兜底
  （估偏大只是提前换行，安全侧）。接线：静态/降级 `optionRowHtml`+
  `.wengu-opts` 容器、复习详情、steps 选项按钮（column→row wrap）、
  cloze 逐空选项、match 候选池；文档模式 ol 多列留二期（□4）。

- 设置行定宽控件窄屏守卫（20260829，用户截图「内容超出了」）：内核
  base.css 窄屏响应式 @media (max-width:750px) 把 .config__item 下的
  输入框/下拉/按钮拉成整行宽（width:100%;margin-top:8px，特异性
  0,2,0 盖过 .fn__size200）——窗口 ≤750 CSS px（半屏分栏/高 DPI
  缩放）时转换页的模型钮/下拉/输入框挤换行并超出面板右缘。复合
  选择器 .b3-label.wengu-formrow>.fn__size200 抬到 0,3,0 压回 200px
  （温故行是「标签+定宽控件」横排语义，不吃内核窄屏堆叠布局）；
  6806 网页版 700px 视口复现+修复验证（真机 1bb4ce1）。

- 三轮全仓审查五波修复（20260829，4 并行代理深读+逐 P1 亲核；A~E 五提交
  fe5bfde/f50b438/0dfd7d1/8056ffc/647673f，均已部署机器 A）：
  **A·quiz 渲染管线**（278e16a 壳分片化的回归）——题库/长卷静态路径材料组
  题卡漏绑作答事件（组分支只 bindOneGroupUnit，组内 .wengu-gqs 题全点
  不动）；纯独立题长卷进度胶囊恒「0/0」（nodesOf 只算组口径）；预览装饰
  无 stale 守卫（放弃批次补挂新壳/非幂等追加翻倍）。已答锁定改逐单元就地
  恢复（分片数秒窗口不再可重复提交）；收卷后在途分片不绑新卡+整卡上锁。
  **B·存储+infra**——WordStore/QuestionBank/WeaknessStore 读异常上抛不落
  空缓存（原一次落盘把全进度/全题库/全画像写没，HistoryStore 同坑补齐）；
  HistoryStore 补串行落盘链；MaterialService 裸 SQL 改 rowsAll（>64 行静默
  截断丢 group 材料）；ai/client 四处裸 fetch 补鉴权+已 abort signal 设防
  +SSE error 掐流；kernelRemoveFile 吞错改上抛；死代码清扫（KernelNotebook
  整类+9 工厂方法+6 路由）。**C·convert 续跑链 5 洞**——done 清进度记录
  （残留使「丢弃」删完成整卷/「继续」复制整卷）；resume 文档跑批前接管
  落盘目标（detect/首批期终止不再丢 docId）；落盘失败与 AI 失败同权重收口
  （kramdown 落进度可续跑，原上抛即丢）；转换完成接 refreshDocFor 增量入库
  （migratedDocs 只防重不刷新的洞）；replaceDocInPlace 先建备份再删旧。
  另：PDF 导入/匹配/重生成挡 convertRunActive 门后；MinerU 轮询容忍 3 连败；
  WeakDrill busy 锁；指纹 32→64 位；ws-main delete/move 防抖对账题库存活
  （树里删文档不再悬空）。**D·word/review/stats**——redoHardFor 不复位
  会话三件（重过撞组边界空尾吞词）；查词标熟当前卡双计 revCount；导入匹配
  O(n²) 冻结改索引；detailQ 陈旧复制错题；统计错题总数封 50 失真；挂账
  清偿：steps/slots 逐题秒数恒 0（#k 后缀查表恒空）、题号栏序数错位
  （改包含规则）、专题边界计时错账（switchTo 先结算再改选中）、统计 tab
  代际护栏、首页 derived 切书不刷、到期「今天稍后」算进明天、aiAnalyze
  完成踢回首页、wordResumeCard i18n 双缺。**E·红线+P3**——quiz/index.ts
  529→489、WordView 513→417（renderList/事件委托/收尾三兄弟迁出）；渲染
  yield 换 MessageChannel（后台页签不被钳到 1s）；惰性数学观察器按视图根
  分份（双页签不连坐）；看板娘 dozeTimer 卸载清理；KnowledgePanel 二击
  确认定时器挂错对象；QuestionBank flush 失败重排+addGenerated 去重；
  extractBlockId 透传消毒；PDF 插图替换防 $ 序列。未修遗留：书尾在学窗口
  搁浅（原始发现细节缺失，未能定位）、decoratePreview 全卷同步 Lute（预览
  大卷仍有一次冻结）、rows/rowsAll 吞错双口径（统一需逐调用点评审）。

- 失效 model id 总闸口校正（20260829，用户「已配置好却一用 AI 就报『请先
  参考用户指南 [人工智能] 章节进行配置』」）：真机排查——内核/默认模型
  探针全通，激活学伴档案存了已删模型的存量 id（3.8.1 模型 id 为内核
  时戳格式，删配置即永久失效），内核对未知 id 一律报该错。agentChat
  入口统一 `resolveModelId`：不在当前可用清单（被删/停用/旧格式）回落
  默认模型，默认也无效则省略 model 让内核自决——覆盖学伴/判分/转换/
  题库/单词全部调用点；models.test.ts 五条回落口径单测。

- 专题管理：新建文件夹 + 官方文档树样式（20260829，用户「专题管理需要
  支持新建文件夹，树形跟官方样式一模一样」）：①目录此前只由专题标题
  含 / 派生、无空目录——BankData 新增 folders 字段（手动文件夹路径，
  旧数据缺省补 []），增删改走新友元模块 BankFolders（QuestionBank 已
  贴 500 行红线）：新建（头部按钮/文件夹行 iconAdd 内联输入行，路径
  可 / 分级）、改名（行内编辑完整路径，严格前缀改写其下专题标题与
  子文件夹条目）、删除（两击确认，连同严格前缀下全部专题并联动清
  col: 会话；同名平铺专题不受牵连）；空文件夹并入 buildColTree 树。
  ②树形重写为官方文档树同款 DOM（ul.b3-list--background + li.b3-list-item
  --hide-action 行壳、b3-list-item__toggle/__arrow 箭头旋转折叠、
  __icon/__text、counter 计数徽标、hover 才显的 b3-list-item__action
  图标操作 + b3-tooltips；行内 --file-toggle-width/--file-action-offset
  与 stage 实测一致），行与子目录按名混排，统计移入悬浮 tooltip；
  专题行删除同样改图标两击确认。wengu-cp-row/-title/-ops 与
  wengu-col-group 旧样式清除，i18n 增 colNewFolder/colNewSub/
  colDelFolder/colFolderPh、退役 colGroupCount。

- 内嵌 Protyle 题卡选项锁只读（20260829，用户「选项不应该能编辑」）：
  3.8.1 前端源码核实——Wysiwyg 构造在桌面端无条件 contenteditable="true"，
  protyle.disable() 只置内部标志，选项块仍可被就地编辑。照搬思源自家只读面
  （agent chat body）配方：contenteditable="false" + data-readonly="true"，
  构造后与装载完成各刷一遍（覆盖 8s 等待期）；点击作答与文本选择不受影响。

- 题号栏占满可视高（20260829，用户反馈「题号没占满」→「又装不下只差几
  像素」两轮）：题号竖列封顶第一轮从固定 `100vh - 200px` 改
  `100vh - var(--wengu-head-h) - 40px`（头高用 NumRail 实测变量，留页签
  chrome 余量）；余量猜值在两台机器/主题间仍差几像素，第二轮改为 NumRail
  实测写入 `--wengu-nums-max`（滚动可视区 clientHeight − 吸顶头下缘 − 8px
  底衬，chrome 差异天然排除），CSS 以它为封顶、旧视口算式仅作绑定前兜底；
  窗口缩放随下一次滚动自愈（滚动帧内零开销重测，不加新监听）。第三轮
  （用户「那应该有padding和margin啊」）间距回归布局表达：底衬实读主区
  padding-bottom 不再 JS 硬编码，题号栏内衬 4→8px 与主区同律（首末按钮
  不贴栏框边缘），列间距仍由 .wengu-body gap 8px 表达——JS 只测量不决定。
  第四轮（用户「底部加padding」）：题号栏自身 `margin-bottom: 8px` 与主区
  padding-bottom 叠加=栏底留白 16px，NumRail 实读两项计入封顶。

- v2→v3 进度迁移代码退役（20260829）：真机确认工作区 words 存量已是
  v3（3243 词 FSRS/1532 熟/2 在学），删除 core/WordMigrate 及其测试、
  WordStore.get 的 migrateV2 分支；仅认 v3，再遇旧版本文件按空进度
  起步并 console.warn 告警（同 v1→v2 先例）。

- 单词组边界误触发修复 + AI 通道弃用空会话（20260829）：①组边界判定
  `finishCount % groupSize === 0` 在 fresh 轨失效——finishCount 只在
  毕业递增，开局 0 与两次毕业之间的整数倍上**每张卡**都命中，把单卡
  画像逐张交 AI 复盘（每次一个 agentChat 调用）；改为「本卡计入计数
  （fresh=毕业/队列轨=每卡）且恰在整数倍」才触发（groupBoundaryDue
  纯函数 + GroupFlow.test 回归锁）。②单词复盘 AI 从 enqueueAi+"" 共享
  会话改走 agentChatOnce 一次性独立会话（用户拍板「怎么能用空会话」）：
  独立 sessionID 天然并发，不再与判分/转换在 "" 锁上互堵；docs/
  word-timing.md 决策 6 已随修订。

- 题卡排版放宽（20260829，用户反馈「布局太紧凑」）：卡内边距 12→
  16px、卡间距 12→16px、卡头下缘 8→12px、题干区下缘 8→12px、选项
  行内边距 2→5px（数学分式选项行间几乎贴死是主诉）；c-v 估计高度
  随之 240→260 / 320→340px。

- 长卷「视口优先渲染」（20260829，①~④一次到位）：①题卡/组单元
  `content-visibility: auto`——屏外卡片跳过布局/绘制与分片填充引发的
  全卷重排（contain-intrinsic-size 记住已渲染尺寸，回滚不跳；数学卡
  偏高者滚动条会轻微修正，属预期）；②KaTeX 惰性——静态路径只注入
  Lute HTML，公式在卡片进入视口前 400px 才渲（renderMathWhenVisible
  IntersectionObserver，与思源 Protyle 编辑器同策略；观察锚点取卡/组
  而非 qprotyle——c-v 跳过渲染的卡片内部无布局盒 IO 不触发；整壳重建
  时 destroyAll 重置观察器防旧 DOM 树被 IO 强引用扣住泄漏）；③壳分片
  插入——静态路径壳先落（题卡列表空），单元逐片插入+绑定+Lute 填充
  同一 16ms 帧预算循环，消灭整壳一次性解析的同步冻结（~200 题几百
  毫秒）；已答锁定恢复/预览装饰改等题卡就绪（renderListInner 返回
  Promise），预览态不绑作答事件（守卫与 bindQuizFor 同口径）；
  ④装载分页 512→2048——整卷 ~~2000 行从 4~~5 次串行内核请求压到 1 次。
  胶囊计数随分片推进（逐单元累加）。

- 长卷静态渲染卡顿续修（20260828，197 题卡）：①Lute 单例复用——原
  每个 kramdown 片段都 Lute.New() 重初始化解析器，整卷上千次纯浪费；
  ②mountStatic 分片异步——16ms 帧预算逐卡填充后 yield，题卡「…」
  占位渐次成像，整壳重渲染（mountGen）放弃在途批次、材料组切换已挂
  真 Protyle 的节点跳过防覆写，组滚动位置改为填完再恢复；③题号栏
  滚动跟踪缓存化——可见卡列表 MutationObserver 失效重扫（滚动帧内
  不再全树 querySelectorAll）、active 差分更新只动前后两钮、当前题
  取 data-idx 修材料组卷错位。续（20260829 用户验收「快了很多但
  想要提示」）：分片成像期间头下挂「题目渲染中 n/m」进度胶囊
  （吸顶、转圈图标、tabular-nums 计数），mountStatic 增 onProgress
  逐卡回调，填完自动摘除；i18n 增 rendering 键（zh/en）。

- 静态渲染选项字母角标（20260828，用户反馈「ABCD 都没了」）：>50 题
  长卷与题库模式走 mountStatic、Protyle 挂载失败走降级——两路选项文本
  被 optionDisplayMd 剥掉文档里的字母标签后无人补画，选项成无字母裸
  行、与作答 chip 无从对应（steps/match/slot 均有角标，普通选择题漏）。
  修复：选项行统一走 optionRowHtml 按位补画 `.wengu-opt-letter` 角标
  （复习模式详情同款），与文档模式有序列表 CSS 计数器（1234→ABCD）
  显示一致；补 ProtyleHost 纯函数单测锁角标回归面。

- 知识文档×题库双向匹配（20260828）：知识面板文档行新增「匹配」「转
  习题」。匹配（MatchDialog）= 选已入库习题文档（存量/新建同权）→
  逐题走转换同款两级 AI 路由（过 enqueueAi 共享队列）→ strip+inject
  替换语义注入「相关知识点」块引用（默认跳过已关联题，进度+可停），
  题库 kramdown/kpRefs 主记录更新、源卷块尽力同步；转习题 = 转换弹窗
  预填源=知识点根=该文档，新建题库生成时即挂反链。面板配套四修：手动
  导入递归展开（expandKnowDocs 根+全部后代逐行；manual 标子树、
  registered 才可移除）、小节层级 h2~~h4→h1~~h6、文档行展开 key 不一致
  与行按钮 docId 误取空值布尔属性两处死交互。

- 多词书 + 标题「温故单词」（20260828 redesign §四/§五 定稿实施）：
  **进度 key 从书内下标换归一化词头**（小写、去空格/连字符/撇号，
  WordBook.wordKey——同词跨书共享进度），words.json **schema v3**：
  逐词映射（words/ladder/reviews/mistakes/simple/familiar/starred/
  timing/notes）与易混组 ids/confNotes 全部词头化，v2 的 cursor 废除
  （新词=全书扫第一个无进度词，太简单/熟的不再被当新词——与「剩」口径
  统一）；**存量 v2→v3 一次性迁移**（core/WordMigrate，索引按内置书换算，
  坏组员丢弃；待确认落盘后移除）。词书文件化 `data/wengu/wordbooks/
{id}.json`（紧凑数组）+ manifest index.json，IO 走 siyuan/files.ts 内核
  特殊通道（getFile 裸内容/putFile multipart/removeFile），内置书首次
  启动落盘与导入书同权。UI：头部主标题固定「温故单词」、书名副位=切书
  选择器（官方风格浮层）；起点面板「词书」组=导入（json/csv 双收、入库
  即切当前）/设为当前/删除（不删进度、最后一本不可删、删当前自动切）；
  切书会话复位回首页、队列统计全按当前书口径（他书词不串场）、他书
  在学词 ladder 保留。易混组跨书有效（ids 即词头，不在当前书的组员标注
  展示）；干扰项池导入书无单元时回落全书。WordView 拆 BookOps/
  ladderOf/setGroupSize 迁 WordStartCtl 压 500 行红线。

- 首页崩修复 + 误认本记账恢复（20260828）：76657bf 把 buildQueue 改成
  {review, freshLeft} 但 HomeScreen 仍读 queues.fresh（undefined.length
  首页即崩，svelte-check 三红一直可见）——本轮随 freshLeft 对齐修复；
  同一提交还丢了「答错记误认本」的写入（旧 Leitner reviewWord 内联，
  FSRS 重写未搬）——恢复 markMistake（复习轨 reviewWord 与新学梯
  settleFreshFor 双入口，重答错清旧 AI 辨析、模糊不记）。

- 二轮审查修复（20260828，quiz 恢复编排 5 P1 + convert 链 3 P1 + P2 六项）：
  开刷面板 unfinished 判定补 !endedAt（错题轮收卷后不再永远「继续上次」）；
  范围轮 scopeIds 快照落盘恢复（WenguSession 新字段，开轮冻结清单——原按
  该轮自身结果重算，wrong 丢原范围/wrongAll 轮内答对的被移出）；AI 实时
  steps 已答卡绕开 startRealtime（原清空重问+恢复扫不到+重复会话条目）；
  renderList 落幕统一恢复已答锁定（收起目录/设置变更/切工作区/继续上轮
  全走它，原只挂 2 处——已答题回未答外观可重复提交）；cloze 三修（换空
  清 optRow 锁定否则第二空起点不动、全答完 slots[cur] 越界、恢复补
  data-locked+cur 自愈重灌）。convert：OrphanCleaner 存活查询改 rowsMapAll
  抛错+alive 全空拒删护栏（查询失败/闭笔记本不再全判孤儿批量误删）；
  MinerU 终止三阶段接入 signal（轮询每轮检查点/上传 fetch/落盘循环——原
  waiting 最长 20 分钟终止按钮无效）；导入 busy 接管弹窗 X（先 abort 再
  关，原直接 destroy 变后台孤儿锁按钮）；onStatus 增 terminal 语义（终态
  条不再带死终止钮、replay 不复活）；PdfImportRow 文件输入复位；extractZip
  images 目录层兜底对齐 full.md；空文档点开始给提示。quiz P2：HistoryStore
  读异常上抛不落缓存（原归空库后 upsert 把整份历史写丢）+并发首载 in-flight
  备忘；after 模式 brief AI 失败露自评钮补账（原静默该题不进会话）；复习
  「重刷本文档」带 override 强制新轮（原被「继续上次」吞掉意图）。

- 全仓代码审查两波修复（20260828，四路并行深读+机械扫描，9 个 P1
  见上一提交）：②波 P2——word 跨书竞态（WordAiInput 带 key 构建时刻
  冻结，addPair/applyAiReview 改词头入参不吃活下标——AI 往返期间切书
  档位/易混对不再写串词）；学伴聊天归属（runChat 发起时捕获
  chatId+chatLog，回复到达落原学伴，不再串进切换后的新学伴历史）；
  WordStore.save 串行落盘链（同 ChatStore 模式，void save() 并发不再
  撞内核互吞）；6 处裸 agentChat 补 enqueueAi 共享队列（GenQuestion
  出题+自检/RegenDialog/ConvertDetect/KnowledgeLink 串行分支/
  agentPanel 降级）；markFamiliar 先 roll 再计数（隔夜首张不再清零
  计数伪造打卡）；backfill 补 ladder（坏 v3 文件不再白屏）；查词标熟
  同步逐出 freshWin（familiar+ladder 双态复活）；slots 部分作答恢复
  不再整卡锁死（与 steps 恢复对称）；steps/slots 整题收口补题库镜像
  bankMirror（专题错题重刷对这类题恢复生效）。挂账：NumRail 可见序数
  /steps 逐题秒数/统计 tab 代际/replaceDocInPlace 先删后建/MatchDialog
  取消中止在途/SSE 尾帧/signal 已 abort/kernelRemoveFile 吞错/首页
  derived 切书/到期口径/书尾搁浅/专题边界计时错账/aiAnalyze 踢回首页。

- 看板娘全局悬浮层收尾（20260828，前批半成品收口）：quiz 页签旧
  attachCompanion/detachCompanion API 清退、单词 WordApp 内嵌份摘除，
  全局层由插件 onload mountCompanionGlobal（mount→unmountSvelteApp 修
  类型）、onunload 显式卸（重载不叠影）。

- 悬浮层位置系统重写「团子恒锚」（20260828 用户报「还得修」）：四连
  修后仍两处系统性问题——①水平朝向条件写反（r 小=贴右半屏却加
  .wengu-comp-left 向右展开，fresh load 即命中：气泡一弹团子被推离
  锚角 ~208px、7s 后弹回）；②内联锚恒钉容器右/下缘而展开物朝锚反
  方向生长，只有默认朝向团子恰在锚缘不动，贴左/上时开聊即被顶走。
  重写为 orient(r,b) 按落点判贴边侧、内联锚随朝向换轴（贴右/下出
  right/bottom，贴左/上换算 left/top），四组合下团子恒落
  (视口-r-64, 视口-b-64)、展开物只向屏内生长，拖拽跨中点翻转朝向
  不再跳团子；钳位随朝向算轴。附带：落盘改读团子实际 rect（原读容
  器 rect，聊天开着拖落盘漂移一个展开宽）；视口尺寸经
  svelte:window bind 进响应链（原 resize 后朝向类不重算）；
  setFigurePos 最小钳上界改 视口-72（原 -8 允许团子大半出界）；朝向
  类 wengu-comp-up→comp-top 改名贴边侧语义、三处与行为相反的注释纠偏。

- 新学滚动窗口 + FSRS 复习排期（20260828 redesign §二/§三 定稿实施）：
  新学会话弃静态流水线（pipelineLadder 删）改**每张卡现场决策**的滚动
  窗口（flow/WindowSched 纯函数+7 例单测：窗口未满先进新词/满窗推进
  最久未出镜的就绪词(隔≥3张)/垫场兜底/④认识毕业腾位补新词）——开词
  即 ladder 落盘（[step,errs]，中途退出重进原样续背不回①），毕业按
  0错→Good、1错→Hard、≥2重来→Again 起步；容量 3~10 默认 5（起点面板
  可调）。复习排期换 **ts-fsrs**（默认参数、目标记忆率 0.9、
  enable_short_term=false 纯天级）：words.json v2 每词 {d,s,due} +
  reviews 逐词流水（将来参数优化留料，优化器挂账）+ 存量迁移（S=旧
  阶梯天数、误认≥2 次 D=6.5）；新学梯步进不再碰长期排期（根治「十分
  钟走完四步=8 天后再见」虚高）；AI 组复盘 fresh 改按毕业数触发、
  队列轨(review/star)不变；头部「剩」fresh=书级剩余未学（进度条同口
  径）；今日新学计数改按毕业一次计（原每步一计的虚增随流水线一并修
  正）；WordView 拆 LookupOps/PageOps 友元压 500 行红线

- 学伴编辑器加保存按钮 + 修复编辑不落盘（20260828 用户报障，网页版
  真机三轮定位）：曾把输入改 bind:value 到 ui 镜像里的 settings
  对象——违反迁移文档暗雷 §6/§9（settings 本体不进响应链），且
  mutateActive 经 ui 的 $state 代理元素写入不落 settings 底层（真机
  实证：点保存「已保存」亮起但存储文件纹丝不动）。修复：回退非受控
  value+onchange；mutateActive 改为按 activeId 直接在 settings 数组
  上找到条目写入（settings 直写是暗雷 §9 原文语义），保存按钮由组件
  从 DOM 收当前输入（未失焦的编辑也能存）调 saveNow(fields) 规整
  （trim/限长）后落盘，「已保存」反馈 1.5s；图片目录变化随保存重探
  形象。端到端验证：fill→保存→存储文件 mtime 即时更新、内容为新值

- 默认学伴改名「小书童」+物化为可删条目（20260828 用户定稿）：默认
  学伴不再是左列特殊卡（不可编辑/删除），改为 companionProfiles 里
  id=default 的正式条目（与聊天存储 DEFAULT_CHAT_KEY 同 id，历史
  无缝衔接）——名字/人设/图片/模型与自定义同权可编辑，也可删除；
  列表至少保留一个（仅剩一条时删除按钮禁用+控制器兜底拒绝，删当前
  条目后自动切到剩余第一条并清其聊天残留）；老数据挂载面板时自动
  迁移（无 default 条目则补、activeId 空/悬空则归位）。默认名
  companionDefaultName「团子」→「小书童」（en: Dango→Shutong），
  「默认团子」特殊卡与提示文案随死键清理，注释措辞同步

- 学伴聊天历史分学伴持久化（20260828 用户提出）：chatLog 从控制器
  单份内存改为按学伴 id 分份（内置团子=固定 default key，学伴 id 为
  时间戳36-随机段格式不冲突；老版本空串 key 首次加载自动迁移）落插件存储
  saveData("companion-chat")——新增 core/ChatStore（loadRaw/saveRaw
  注入同 HistoryStore 惯例，写走串行链防内核并发互吞，每份截 24 轮，
  坏数据按空处理），插件重载/思源重启后各学伴聊天上下文不再丢失；
  管理面板切换/新建/删除学伴即时换历史重灌聊天面板（面板
  onActiveChange/onProfileRemoved 回调穿透挂载编排到 ctl），删除学伴
  清其聊天残留；prompt 近期对话轮随分份天然按学伴隔离，UI 消息列表
  同步对齐 24 轮上限防超长会话 DOM 涨爆

- 学伴 AI 反应做题侧改自适应节流（20260828 用户提出）：原固定 45s 间隔
  且只在里程碑（连错 3/连对 5/轮完成）请求大模型，普通单题 AI 无感知；
  现每道答题事件都是候选触发点，间隔随答题节奏自适应——最近窗口平均
  ≥60s/题（做题慢）每题都触发，快节奏压到两分半一次（rules/Enrich.ts
  纯函数+单测，样本不足按快节奏保守）；一轮完成/单词收工的批次事件
  不设间隔仅互斥（「每批必点评」维持不变）；事件描述泛化到普通单题
  （带用时与连对/连错计数），prompt 结构不变

- 学伴名动态化（20260828 用户提出）：聊天的「想一想/输入占位/回话失败」
  三条文案与 AI prompt 的角色行、近期对话轮标签不再写死「团子」，改随
  当前学伴配置名——i18n 加 {name} 占位符、调用点 replace（同 slotNO
  惯例），Prompt 三 builder 首参加 name；设置里「启用/AI 台词」两条描述
  的「团子」改中性「看板娘」；默认名仍团子（companionDefaultName），
  「默认团子/回退内置团子」等指向默认形象的文案不动

- Svelte 渐进迁移首批落地（20260827，路线图见 docs/svelte-migration.md）：
  学伴管理工作区面板从字符串模板+逐控件绑定迁为 Svelte 四件套
  （CompanionPanelUi/Ctl + CompanionPanelApp.svelte，删旧
  core/CompanionPanel.ts -218 行）——改任意配置不再「全量重灌面板」，
  响应式就地更新；两击确认态不再因重灌丢失；改名后左列卡片名即时
  刷新（旧版要等下次重灌）。配套地基：共享挂载帮手 ui/mountApp.ts、
  表单行积木 ui/FormRow.svelte、ModelPicker 的 modelPickAction 桥 +
  modelPickLabel；svelte-check 接入（tsconfig.svelte.json bundler 解析，
  存量 14 组件零错误）；renderQuizShellFor 重灌前 detachCompanionPanel
  先卸（同 statsPanel 位）+ QuizView.destroy 兜底

- 梯进度点改竖排+错梯归零（20260828 用户定稿）：四点纵列贴词尾、
  总高与单词行同高（space-between+stretch，词行改 flex）；前进规则
  加严为「答错一次整梯重来」——归零词静态流水线后续位不足重走全梯
  时按缺口补插 REINSERT_GAP 邻域；redesign §二.2 同步

- 判分反馈用色规范化（20260828 用户提出，设计评审 §〇 新增第 10 条）：
  词域对错反馈行从「灰字+彩色小图标」改为文本/底色成对的思源语义
  色——答对 success、答错（含看答案按错计）error，12% color-mix 底
  与 base.wengu-status-ok/err 同公式；回想引导语等非判分行保持中性。
  浏览器实测 is-ok 行 color=oklch 绿 + 12% 底生效

- 词尾四点梯进度（仿不背单词，20260827 用户需求）：新词四步梯进行中
  在词尾渲染 4 个小圆点——已完成步 primary-lighter 实心、当前步
  主色放大、未到步 border-color 灰点；listen 步词面隐藏时随题面隐去；
  复习词/已出师词不显示。WordView.ladderOf 只读访问器 + QuizCard 三
  处挂点（英选中·回想大词尾/中选英释义行尾/详情词条行）

- 详情视图定稿（20260828）：词条释义紧跟头部自然下排，删除上一轮的
  垂直居中——居中会在单词与头部间留大块空白（用户反馈「单词和顶部
  有一块空白」）；剩余空间聚在 sticky 按钮行上方，横向溢出复测为零

- 客观题作答后直接切详情视图（20260827 用户反馈）：选择/听音/拼写
  答完后题面大字与禁用选项组不再滞留——只留反馈行（答对/答错/看了
  答案）+ 错选提示 + 词条详情（含朗读）+「下一个/记错了」，与回想
  翻面结果视图同构；正确答案本身就在详情里，选项高亮不再重复展示。
  详情态内容不满屏时信息块垂直居中（上下 auto margin 平分空隙），
  按钮仍贴底——不再中段一大块空白

- 新词四步梯接线（20260827 用户定稿）：口述版梯序 英选中→中选英→
  听音选义→英文回想（参考流草案作废，readalong 挂账未接线）+ §六
  决策 2「仅认识前进」——模糊/忘记/答错/看答案原步不动，靠流水线
  后位自然隔卡重现。新学建队改 pipelineLadder 四词错峰流水线（组宽
  ≤4 轮转出镜，相邻四张=四个不同词各占一梯；词少自动缩组），AI 组
  边界重排按剩余梯步折算出镜次数（rebuildTail 增 remainOf 入参）。
  配套：listen 题面大喇叭进卡自动播+空格重听、单词隐藏；选择/听音
  「看答案」小字钮（peek 按答错计）；详情区翻面后小喇叭朗读；
  speechSynthesis 发音小模块 WordSpeak（en-US·0.9x，离线系统 TTS，
  redesign §一落点）+ 自绘 iconVolume 符号；i18n 六键 zh/en；新增
  WordLadder.test 锁梯序与流水线轮转性质

- 查词结果行去原生按钮壳：列表行对齐思源文档树 ghost 风（无边框
  无灰底、悬停浅底、词左粗体释义右省略），结果列不再限宽 420

- 修查词列表横向滚动条+排版散架：结果行的「单词左/释义右省略」flex
  规则挂在旧渲染器的 `.wengu-word-opt[data-act="lookuppick"]` 上，
  Svelte 迁移后按钮无 data-act 整条失效——按钮退化 block、inline span
  上的 nowrap+ellipsis 双双无效，长释义把卡片内容撑到 ~800px 顶出横向
  滚动条（浏览器实测 scrollWidth 814/356）。行改挂专用类 wengu-word-lk，
  meaning 补 min-width:0 让省略号真正生效；布局复测 sw=cw、截图确认

- 刷卡右上角工具组常驻「回首页」按钮（列表图标，同头部入口）：中途
  退出不再依赖标题行小图标；goHome 语义不变（重进按到期/新学重构队）

- 回想三档按钮全阶段统一为 认识/模糊/忘记：空翻兜底结果页原本写反成
  忘记/模糊/认识（正面直选档是 认识(3)/模糊(2)/不认识(1)），两态按钮
  位置互换易误触——统一左起 认识(1)/模糊(2)/不认识(3)，键盘 1-3 映射
  与 i18n 快捷键编号（zh/en）同步重排

- 修回想卡「直接显示答案」：鼠标点「下一个」/档位按钮收尾后，同一次
  点击冒泡到卡根的翻面 onclick，把刚换上的新卡当场翻面（enterPrompt
  同步写 phase=prompt，冒泡晚于状态更新）——卡根翻面改为忽略来自
  button/input 的点击，键盘路径不受影响

- 测试兜底接入：vitest（node 环境，`siyuan` 别名到 tests/siyuan-stub，
  内核 IO 不进单测）+ GitHub Actions CI（tsc/eslint/prettier/test/build
  与 AGENTS.md 调试链同序）；首批 7 个测试文件 67 例锁纯逻辑回归面
  ——判分矩阵、选项洗牌不变量、分批切块确定性、AI 回复规整
  （extractBatchQuestions）、题库/文档双路 kramdown 装配、契约归一化

- 修小数选项误判（测试首跑挖出）：optionDisplayMd 的有序列表标记
  剥除改为「标记后须有空白」（与 splitOptionMd 同约定）——旧正则会把
  「0.5」「1.5」的 `1.` 当列表标记吃掉，数学题内容比对必错判

- 内核调用全量收拢进 src/siyuan 工厂（新增 KernelQuery，EApi 补
  agent/chat·chatGPT·forwardProxy；13 文件 33 处散落直调清零）；
  修 getBlockKramdown 把 `{id,kramdown}` 对象当串返回的 bug
  （真机探针实锤，题库 refreshDoc 静默失败根因）；ConvertBatch
  496→440 行；生成核/Flow DOM 件/hydrate 样板三处复制粘贴收敛
  （GenCore/FlowDom/fetchChildParts）

- 背单词 UI 层 Svelte 化：word 域渲染从 innerHTML 全量 paint 换成
  Svelte 5 组件（`word/comp/`，WordApp 根组件 + 各屏幕/卡片组件），
  控制器拆 `WordView.ts`（会话状态机与语义动作）、响应态形状
  `WordUi.ts`（$state 深代理，组件细粒度更新）；旧字符串渲染层
  （WordHome/WordStats/WordActs 与各 renderXxx）删除，WordBind 只留
  键盘分发；样式类名不变（仍走全局 scss）。构建链接入
  svelte-loader（Svelte 5 编译器原生支持组件内 TS，无需预处理），
  prettier 加 prettier-plugin-svelte、eslint ignore `*.svelte`；
  插件 Dock destroy 补卸载（旧版空置会泄漏监听）

- 图标定稿：手绘 SVG 换成思源官方图标集原始 path（温故=iconRiffCard
  卡牌堆、背单词=iconLanguage 地球），仍以自有稳定 id 经 addIcons 注册
  ——直接引用内置 sprite id 会被 uiLayout 持久化的旧 dock 图标引用
  打穿渲染空白（iconLanguage 也非核心图标，部分环境 sprite 未收录）

- UI 标准落地（design-review §〇 新增 6/7/8 条）：弹窗底部操作行按钮
  统一 8px 间距（原生 b3-dialog__action 无间距规则，多按钮贴死）；模型
  选择从原生 select（几百项不可搜）改为模仿官方 commonMenu 的带搜索
  浮层（`src/ui/ModelPicker.ts`，b3-menu__filter + b3-list，转换弹窗与
  设置页共用）

- 文档选择器（源文档/父文档/知识点「选择…」）从大 Dialog 改为官方
  风格可搜索下拉浮层（b3-menu__filter + b3-list，同 ModelPicker 交互）：
  单选点击即回填，多选行内勾选+底部「清空/确定」，Esc/点外部取消

- 「更多选项」折叠行：内置 iconRight 箭头随开合旋转、隐藏原生三角
  marker、悬停变色、间距入 8px 体系

- 删除页签头部「做题 | 复习」切换器（样式不达标且头部信息行拥挤；
  开刷面板三按钮「预览 | 开始刷题 | 错题回顾」为统一模式入口，另保留
  侧栏文档右键「错题复习」）；switchMode/会话恢复机制保留，契约见
  docs/review-mode.md §二 D1 v3

- 源码按功能分域重构（组织方式借鉴 sy-lively）：`src/siyuan`（内核 API
  工厂：EApi 路径枚举 + KernelBlock/KernelDoc/KernelNotebook，迁自
  sy-lively 构建工厂）+ quiz/convert/review/word/stats/bank/ui 六域，
  各域 `index.ts` 为入口编排（禁纯 re-export barrel），词库数据入
  `word/data/`

- 转换落盘改走 appendBlock 增量追加（sy-lively 同款通道，20260826
  八轮真机探针定论）：首批 createDocWithMd 建文档（IAL 整体解析），
  之后每题一次尾插——不再每批删旧重建，块 id 稳定、回收站无每批
  尸体；继续生成直接在旧渐进文档上续写

- 转换流程页面化：弹窗只收参数，点「开始转换」即关窗——批次循环交
  ConvertRun 单例运行器，温故页签内转换条展示进度并支持停止/保留
  进度/全部丢弃；原位替换也每批渐进落盘（原文档旁临时《·习题》，
  页签像做题一样逐批出题，终态替换原文档后删临时文档，转换期间
  原文档不动）；源文档/父文档/知识点改为选择器（可搜索）+ hint 槽
  回显路径，原位模式收起「生成位置」两行

- 错题复习模式（错题本）：入口=开刷面板「错题回顾」按钮 + 侧栏文档
  右键（原页签头部「做题|复习」切换器已删，2026-08-26 入口统一
  开刷面板三按钮）；全局错题清单（SQL 直查块属性）+ 单题回看（历次
  作答时间线 / AI 评语 / 错因 / 跳源块 / 复制题目）；组头「重刷本文档」
  以 scope=wrongAll 直落开轮；会话落 scope 字段（继续上次按范围恢复）；
  统计总览加错题概况 / 薄弱 Top8 / 错因分布三块（详见
  docs/review-mode.md）

- 插件题库/专题/知识点反链体系补记：bank 主记录 + 按知识点收集专题 +
  悬空对账 + 题卡重生成 + 右键「查相关题目」+ 薄弱针对性加练（详见
  docs/question-block-contract.md）

- 专题会话独立归档（`col:<id>`）：专题作答不再误记到无关文档的轮次
  统计里；专题轮次可读——「继续上次 / 只刷错题」在专题模式生效；
  重开页签恢复上次专题（prefs.colId）

- 专题模式材料并集装载：按题目来源文档合并材料、解析 group 占位，
  材料组在专题里分栏渲染（静态 Lute + KaTeX）

- 专题可编辑：管理对话框展开专题逐题移除、删除两击确认、创建后直接
  切换过去开刷

- 「收集并补题」：按勾选知识点收集已有题后，AI 生成（错题变式/概念
  辨析，逐题自检）按缺口补入专题（≤10 题/次；非反链键自动降级变式）

- 薄弱加练专题名走 i18n；知识点引用解析器合一（BankParse.parseKpRefs）

- 修复：AI 生成的选择题正确答案恒为 A——prompt 让模型先写正确项再补
  干扰项，输出天然正确项居首；转换/生成规整链尾部统一做选项均衡洗牌
  并同步改写答案字母（single/multiple/steps；「以上都对」类位置敏感
  措辞跳过，OptionShuffle）

- 新增「结束本次做题」：做题中头部一键提前收卷，报告/批改只含已答
  部分；薄弱画像按结果水位增量（同轮多次收卷不重不漏）；下次
  「继续上次」接着做（大卷 100~200 题分次刷的场景）

- 修复：批次超时等失败收口不清运行器单例——一次超时后「继续转换」
  永久被拒、弹窗误报「已有转换在进行中」（ConvertRun failed/catch
  路径 active 复位；待抉择期间也拒绝开新转换）

- 转换超时改判据：串行通道（agent/chat SSE）按**空闲**计——每收到
  一段流数据即续期，慢模型长批次只要在出字就不掐；并发直答通道
  （chatGPT 非流式）总时长放宽到 10 分钟（原 5 分钟总时长误杀）

- 新增转换管理面板（ConvertPanel）：转换弹窗被拒不再一句报错——
  直接转进面板单独管理；面板两区：进行中（进度/终止/终止后保留-
  丢弃抉择，订阅运行器实时刷新）+ 未完成进度记录（prefs 持久，逐条
  「继续生成」回弹窗预填源文档 /「丢弃进度」清记录并删保留的渐进
  文档）；弹窗打开时若有转换在跑，底部露出「查看进行中的转换」

- 新增预览模式：开刷面板三按钮「预览 | 开始刷题 | 错题回顾」统一
  模式入口（页签头部切换器已删）；预览复用做题壳渲染，题卡只读
  全揭示——作答位/提交/自评/思路摘除、正确项 chip 与 steps 选项
  描绿、题级答案/解析全展开、题号与徽标不透历史对错；工具行
  「模糊答案」（答案区打码+隐去描色，点答案区单卡揭示）与
  「退出预览」；QuizShell 自 QuizView 拆出（500 行红线）

- 快捷复制：预览每卡 + 错题本详情「复制题目」——题型/题干/选项/
  steps/slots/答案/解析拼 markdown 写剪贴板（含 clipboard 兜底与
  轻提示），供粘贴到思源 AI 对话

- 修复长卷卡死（193 题真机触发）：①装载改批量——整卷子块×part
  一条 JOIN SQL 显式分页拉全（QuestionBatch，~390 次串行请求 →
  ~4 次，fetchSyncPost 仍串行）；②渲染分流——题量 >50
  （PROTYLE_INLINE_MAX）与题库模式同走静态 Lute+KaTeX，不再逐卡
  挂内嵌 Protyle（N 实例 × 8s 等待为主源）；③题号栏 max-height
  视口近似封顶（原 100% 对自适应父级无效，题多时栏底不可达）

## v0.1.0 2026-08-22

First usable cut of Wengu (温故), the drill plugin:

- Quiz tab from the top bar: collapsible sidebar of generated exercise
  documents (question count / drilled / correct / total time per doc),
  question-number rail with a "show numbers" setting toggle

- "AI: make questions" turns any note into a sibling `Title·习题`
  exercise document via SiYuan's built-in AI (suitability verdict first,
  then kramdown question blocks per the block contract)

- Per-type answering widgets; auto-grading for single/multiple/judge/fill
  tolerant of real AI output (content answers, merged option blocks,
  `$…$` delimiters); self-assessment for brief questions

- Timing modes (count-up / countdown / none) with per-round session
  history and a persisted per-document `total-time` attribute

- Wrong answers sync into the "温故错题" flashcard deck (added on wrong,
  removed on correct)

## v0.5.1 2026

- [Add an editor breadcrumb button demo](https://github.com/siyuan-note/siyuan/issues/18856)

## v0.5.0 2026-08-13

- [Migrate the kernel plugin sample from MCP tools to Agent capabilities](https://github.com/siyuan-note/siyuan/issues/18638)

## v0.4.9 2026-8-4

- [Add documentation for the kernels field in plugin.json](https://github.com/siyuan-note/plugin-sample/issues/48)

## v0.4.8 2026-6-30

- [Upgrade devDependencies and implement kernel plugin demo](https://github.com/siyuan-note/plugin-sample/pull/42)

- [Enhance KernelPlugin with MCP tool registration and update ESLint](https://github.com/siyuan-note/plugin-sample/pull/47)

- Migrate i18n locale codes from legacy underscore form (`zh_CN`/`en_US`) to [BCP 47](https://tools.ietf.org/html/bcp47) (`zh-CN`/`en`)
    - Aligns with SiYuan kernel RFC 5646 / BCP 47 lang code refactor (see https://github.com/siyuan-note/siyuan/issues/7098)
    - `plugin.json` keys, i18n file names (`src/i18n/*.json`) and `README.zh-CN.md` filename updated accordingly
    - Bump `minAppVersion` to `3.7.0` (older SiYuan versions will fall back to `default` locale for this plugin)

## v0.4.7 2026-04-14

- [Improve the dock panel title and tooltips](https://github.com/siyuan-note/siyuan/issues/17366)

## v0.4.6 2026-03-11

- [Improve error handling and security for plugin data storage methods](https://github.com/siyuan-note/siyuan/pull/16717)

## v0.4.5 2025-12-27

- [Improve minimum version requirements for marketplace packages](https://github.com/siyuan-note/siyuan/issues/16688)

## v0.4.4 2025-12-23

- [Delete plugin data when uninstalling the plugin](https://github.com/siyuan-note/plugin-sample/pull/37)

## v0.4.3 2025-12-02

- [Add onDataChanged method to handle data changes in the plugin](https://github.com/siyuan-note/siyuan/pull/16244)

## v0.4.2 2025-08-26

- [Upgrade ESLint to 9.33.0](https://github.com/siyuan-note/plugin-sample/issues/30)

- [Adjust `addTopBar` and `addStatusBar` from `onload` lifecycle to `onLayoutReady`](https://github.com/siyuan-note/siyuan/issues/15455)

## v0.4.1 2025-07-22

- [Add plugin function `saveLayout`](https://github.com/siyuan-note/siyuan/issues/15308)

## v0.4.0 2025-04-08

- [Add plugin function `openAttributePanel`](https://github.com/siyuan-note/siyuan/issues/14276)

## v0.3.9 2025-03-04

- [Add parameter `nodeElement` to `protyleSlash.callback`](https://github.com/siyuan-note/siyuan/issues/14036)

## v0.3.8 2025-02-11

- [Add plugin util `openSetting`](https://github.com/siyuan-note/siyuan/pull/13761)

- [Add plugin method `updateProtyleToolbar`](https://github.com/siyuan-note/plugin-sample/issues/24)

## v0.3.7 2024-11-05

- [Add plugin util `platformUtils`](https://github.com/siyuan-note/siyuan/issues/12930)

- [Add plugin function `getAllEditor`](https://github.com/siyuan-note/siyuan/issues/12884)

- [Add plugin function `getModelByDockType`](https://github.com/siyuan-note/siyuan/issues/11782)

- [Replace `any` in IProtyle with the corresponding type](https://github.com/siyuan-note/petal/issues/34)

- [Add `data-id` attribute to menu button](https://github.com/siyuan-note/plugin-sample/pull/20)

## v0.3.6 2024-09-27

- [Add plugin event bus `opened-notebook` & `closed-notebook`](https://github.com/siyuan-note/siyuan/issues/11974)

- [⬆️ Bump braces from 3.0.2 to 3.0.3](https://github.com/siyuan-note/plugin-sample/pull/16)

## v0.3.5 2024-04-30

- [Add `direction` to plugin method `Setting.addItem`](https://github.com/siyuan-note/siyuan/issues/11183)

## v0.3.4 2024-02-20

- [Add plugin event bus `click-flashcard-action`](https://github.com/siyuan-note/siyuan/issues/10318)

## v0.3.3 2024-01-24

- Update dock icon class

## v0.3.2 2024-01-09

- [Add plugin `protyleOptions`](https://github.com/siyuan-note/siyuan/issues/10090)

- [Add plugin api `uninstall`](https://github.com/siyuan-note/siyuan/issues/10063)

- [Add plugin method `updateCards`](https://github.com/siyuan-note/siyuan/issues/10065)

- [Add plugin function `lockScreen`](https://github.com/siyuan-note/siyuan/issues/10063)

- [Add plugin event bus `lock-screen`](https://github.com/siyuan-note/siyuan/pull/9967)

- [Add plugin event bus `open-menu-inbox`](https://github.com/siyuan-note/siyuan/pull/9967)

## v0.3.1 2023-12-06

- [Support `Dock Plugin` and `Command Palette` on mobile](https://github.com/siyuan-note/siyuan/issues/9926)

## v0.3.0 2023-12-05

- Upgrade Siyuan to 0.9.0

- Support more platforms

## v0.2.9 2023-11-28

- [Add plugin method `openMobileFileById`](https://github.com/siyuan-note/siyuan/issues/9738)

## v0.2.8 2023-11-15

- [`resize` cannot be triggered after dragging to unpin the dock](https://github.com/siyuan-note/siyuan/issues/9640)

## v0.2.7 2023-10-31

- [Export `Constants` to plugin](https://github.com/siyuan-note/siyuan/issues/9555)

- [Add plugin `app.appId`](https://github.com/siyuan-note/siyuan/issues/9538)

- [Add plugin event bus `switch-protyle`](https://github.com/siyuan-note/siyuan/issues/9454)

## v0.2.6 2023-10-24

- [Deprecated `loaded-protyle` use `loaded-protyle-static` instead](https://github.com/siyuan-note/siyuan/issues/9468)

## v0.2.5 2023-10-10

- [Add plugin event bus `open-menu-doctree`](https://github.com/siyuan-note/siyuan/issues/9351)

## v0.2.4 2023-09-19

- Supports use in windows

- [Add plugin function `transaction`](https://github.com/siyuan-note/siyuan/issues/9172)

## v0.2.3 2023-09-05

- [Add plugin function `transaction`](https://github.com/siyuan-note/siyuan/issues/9172)

- [Plugin API add openWindow and command.globalCallback](https://github.com/siyuan-note/siyuan/issues/9032)

## v0.2.2 2023-08-29

- [Add plugin event bus `destroy-protyle`](https://github.com/siyuan-note/siyuan/issues/9033)

- [Add plugin event bus `loaded-protyle-dynamic`](https://github.com/siyuan-note/siyuan/issues/9021)

## v0.2.1 2023-08-21

- [Plugin API add getOpenedTab method](https://github.com/siyuan-note/siyuan/issues/9002)

- [Plugin API custom.fn => custom.id in openTab](https://github.com/siyuan-note/siyuan/issues/8944)

## v0.2.0 2023-08-15

- [Add plugin event bus `open-siyuan-url-plugin` and `open-siyuan-url-block`](https://github.com/siyuan-note/siyuan/pull/8927)

## v0.1.12 2023-08-01

- Upgrade siyuan to 0.7.9

## v0.1.11

- [Add `input-search` event bus to plugins](https://github.com/siyuan-note/siyuan/issues/8725)

## v0.1.10

- [Add `bind this` example for eventBus in plugins](https://github.com/siyuan-note/siyuan/issues/8668)

- [Add `open-menu-breadcrumbmore` event bus to plugins](https://github.com/siyuan-note/siyuan/issues/8666)

## v0.1.9

- [Add `open-menu-xxx` event bus for plugins](https://github.com/siyuan-note/siyuan/issues/8617)

## v0.1.8

- [Add protyleSlash to the plugin](https://github.com/siyuan-note/siyuan/issues/8599)

- [Add plugin API protyle](https://github.com/siyuan-note/siyuan/issues/8445)

## v0.1.7

- [Support build js and json](https://github.com/siyuan-note/plugin-sample/pull/8)

## v0.1.6

- add `fetchPost` example
