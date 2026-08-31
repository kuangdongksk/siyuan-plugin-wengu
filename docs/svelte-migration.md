# Svelte 渐进迁移指南

全仓 UI 从「字符串模板 + innerHTML + 委托事件」渐进迁移到 Svelte 5 组件。
本文件是后续各批次迁移的施工手册：模式样板 + 暗雷清单 + 路线图。
首批落地记录见文末。

## 现状

- 构建链零配置扩展：webpack 按 `\.svelte$` 后缀匹配整个 `src/`
  （webpack.config.js），任何域新增 `component/*.svelte` 即被编译。
  Svelte 5 编译器原生支持组件内 `lang="ts"`，无需 svelte-preprocess。
- 类型检查：`pnpm run check:svelte`（svelte-check + tsconfig.svelte.json
  的 bundler 解析；主 tsconfig 的 node10 解析配 vitest 子路径导出会假报）。
  tsc/eslint 都不覆盖 `.svelte`，svelte-check 是唯一关卡，调试链必跑。
- 样式：组件**零 `<style>` 块**，类名与迁移前逐字一致，全部走全局
  scss（`src/scss/`）——迁移不改任何 CSS。
- FormHtml（`src/ui/FormHtml.ts`）是两轨公共地基：Svelte 组件里
  `{@html svgIcon(...)}` 桥接图标（规范 §〇.1 禁 emoji 不变），
  表单行用 `src/ui/FormRow.svelte`（逐类名复刻 formRow 输出）。

## 四件套模式（每域标配）

以 word 域为完整参照，companion 面板为最小参照：

1. **响应态形状** `core/XxxUi.ts`：接口 + `initialXxxUi()` 工厂 +
   context Symbol。只放「渲染要读」的字段；纯逻辑数据留在控制器私有字段。
2. **根组件** `component/XxxApp.svelte`：
    - `const ui: XxxUi = $state(initialXxxUi());`（深代理，此后读写全走代理）
    - `export const view = new XxxView(ui, …);`（实例导出，挂载方能读到）
    - `setContext(XXX_CTX, view);`（子组件 `getContext` 取控制器）
    - `onMount(() => { view.attach(el); …; return () => view.destroy(); })`
      ——控制器清理由组件 cleanup 负责，mountApp 帮手不感知
    - 屏幕路由就是根组件里一条 `{#if ui.mode}` 链
3. **挂载编排**（域 `index.ts`）：`mountSvelteApp(Root, el, props)`
   （`src/ui/mountApp.ts`）→ 需要时读 `app.view`；返回的 `unmount`
   必须在宿主 destroy 时调用。
4. **控制器** `core/XxxView.ts`（或轻量 `XxxCtl`）：语义动作方法，
   方法体里写 `ui.xxx` 即触发细粒度更新，零手动通知。

子组件消费样板：

```svelte
const view = getContext<XxxView>(XXX_VIEW_CTX)!;
const ui = view.ui;
const p = $derived(ui.progress!);
```

事件回传＝组件直调控制器公开方法（`onclick={() => view.option(i)}`），
不用 createEventDispatcher、不用 data-act 委托。

### 单例/多宿主变体（acquireUi）

一个控制器对多个 Svelte 实例（companion 双宿主先例）：每实例仍
`$state(initialUi())`，控制器 `acquireUi(make)` 用 `this.ui ??= make()`
采纳第一个——首实例的代理挂上单例，后续实例的代理弃用。看板娘
（quiz 页签挂载层 + word dock 内嵌）即此模式。

## 暗雷清单（word/companion 迁移真机踩过，开工前必读）

1. **`$state` 只能在 Svelte 编译单元里创建**——控制器/普通 ts 文件里
   没有 `$state`，深代理必须在根组件里创建再交给控制器。这是四件套
   存在的理由。
2. **数据必须先赋进 ui 才被代理**：`this.ui.progress = await store.get()`
   之后就地改 `p.words[...]` 才响应；直接拿外部对象改不触发。
3. **scss 里 `data-act`/`data-*` 键控选择器是迁移暗雷**：Svelte 化后
   元素不再带这些属性，CSS 静默失效（查词行按钮退化 block 顶爆布局
   的真机事故）。迁前先 grep scss 里目标面板的选择器，改专用类名。
4. **按钮点击冒泡到卡根**：推进按钮点完换卡后，同一次点击冒泡到卡根
   会把新卡误翻面。卡根 onclick 要忽略 `closest("button, input")` 来源。
5. **焦点恢复要 `$effect` 手动对齐**旧 innerHTML 全量重绘的行为
   （word QuizCard 焦点 $effect 先例）；听音自动播、列表滚底同理。
6. **草稿类输入用非受控**（value + onchange/oninput 直写），避免每次
   击键重建输入框丢焦点；查词这种高频输入不要 bind:value 重绘列表。
7. **destroy 必须调 unmount**：Dock/页签 destroy 回调空置会泄漏监听
   （word dock 踩坑）；重灌宿主（renderList innerHTML 覆盖）前先
   detach 旧实例（`isConnected` 幂等检查 + 先卸再挂，attachCompanion
   舞步）；QuizView.destroy 里兜底再卸一次。
8. **思源命令式挂载要 action/壳组件**：Protyle 实例（逐卡串行、
   挂载代数防竞态）、echarts（init/dispose + resize 监听）别声明式化，
   用 Svelte action 包住现有命令式代码。
9. **settings 等插件全局对象不要整个 `$state()`**：只把渲染要读的
   字段镜像进 ui，表单值直写 settings 后 save()——面板外代码零感知。
10. **表单行样式逐类名复刻**：`fn__flex b3-label config__item
wengu-formrow` 类名串与 `.b3-label.wengu-formrow` 特异性补丁
    （base.scss）是运行时主题对抗的一部分，借迁移「清理」类名必炸。
11. **`svelte-ignore` 多条规则要拆成多条注释**（5.56 实测）：一行
    空格分隔多规则只有第一条生效，`<!-- svelte-ignore a11y_a -->
    <!-- svelte-ignore a11y_b -->` 连写两行才都生效。
12. **`use:action` 的名字必须与 import 的标识符一致**：模板里
    `use:modelPick` 而 import 的是 `modelPickAction` 会报「Cannot
    find name」（svelte-check 可拦住，tsc 看不见 .svelte）。

## 路线图（练手优先序，每批真机验证后进下一批）

| 批  | 目标                  | 规模    | 要点                                                                                                                                | 状态                                            |
| --- | --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | 地基 + CompanionPanel | 218 行  | 首个面板样板（mountApp/FormRow/svelte-check）                                                                                       | ✅ 2026-08-27                                   |
| 2   | bank 工作区面板       | ~740 行 | 同 WorkspaceShell 挂载链，复用面板样板；两棵递归树组件                                                                              | ✅ 2026-08-30                                   |
| 3   | review 域             | 550 行  | ~~先抽 quiz 借用的 rail/side/head~~（修订：留批次 6，见落地记录）                                                                   | ✅ 2026-08-30                                   |
| 4   | stats 域              | 827 行  | echarts action 壳；顺手修 destroy 不清 statsPanel 泄漏                                                                              | ✅ 2026-08-30                                   |
| 5   | convert 域（两弹窗）  | ~800 行 | Dialog 壳保留 `new Dialog` 只换内容；setBusy/lastBar 重放自然消失                                                                   | ✅ 2026-08-30                                   |
| 6   | quiz 域（拆多批）     | 6807 行 | StartPanel → RoundReport → rail/Nums → 题卡（~~Protyle 壳~~静态管线，9a53a63 退役）→ Steps/AnswerFlow（三写痛点终结）→ side/head 壳 | ✅ 6-1~6-3 2026-08-30；6-4a/6-4b/6-5 2026-08-31 |

**不迁清单**：`ui/FormHtml.ts`（两轨公共地基）；ModelPicker/KnowPicker
浮层（body 单例，保持字符串模板，Svelte 侧用 action 桥接）；
SettingsDialog（低频稳定，路线图末尾再评估）。

## 首批落地记录（2026-08-27）

- `src/ui/mountApp.ts`：共享挂载帮手（word/companion 现有两处手写
  样板不回改，新域一律用它）。
- `src/ui/FormRow.svelte`：表单行 Svelte 积木（children snippet）。
- `src/ui/ModelPicker.ts` 新增 `modelPickAction`：Svelte action 桥。
- companion 管理面板四件套：`CompanionPanelUi` / `CompanionPanelCtl`
  / `component/CompanionPanelApp.svelte`，删除旧 `core/CompanionPanel.ts`
  （-218 行字符串模板）。行为变化：改任意配置不再全量重灌面板，
  响应式就地更新；两击确认状态不再因重灌丢失。
- 挂载：`companion/index.ts` 的 `mountCompanionPanel`/`detachCompanionPanel`；
  `QuizShell.renderQuizShellFor` 开头清理（同 statsPanel 位），
  `QuizView.destroy` 兜底。
- `tsconfig.svelte.json` + `pnpm run check:svelte`（存量 14 组件
  零错误零警告）。

## 批次 2 落地记录（2026-08-30，bank 工作区面板）

- 两个面板四件套（CollectionPanel/KnowledgePanel）：
  `core/ColPanelUi|ColPanelCtl` / `core/KnowPanelUi|KnowPanelCtl` +
  `component/CollectionPanelApp|ColTreeLevel` / `component/KnowledgePanelApp|
KnowTreeItem`。原 `ui/CollectionPanel.ts|KnowledgePanel.ts` 瘦身为
  视图模型层（类型+树化/聚合纯函数+渲染辅助，单测不动）。
- **递归树组件自引用**：Svelte 5 移除 `<svelte:self>`，组件文件
  `import Self from "./Self.svelte"` 后用 `<Self>` 递归（两棵树同款）。
  svelte-check 对未 import 的自名标签报 Cannot find name，是防呆位。
- 挂载：`bank/index.ts` 的 `mountCollectionPanel/mountKnowledgePanel/
detachBankPanels`（companion 同款模块级单例+先卸再挂）；
  `renderQuizShellFor` 开头 `detachBankPanels()`（同 statsPanel 位），
  `QuizView.destroy` 兜底。
- 行为改进（有意）：折叠态/两击确认态/编辑态进 ui 后，数据刷新不再
  重置（旧 innerHTML 全量重绘全丢）；Knowledge 面板「移除」确认态与
  渲染同源，消除旧模块级 rmArmed Map 与重绘 DOM 漂移的隐患。
- 竞态守卫换血：旧 `root.isConnected` 检查换成控制器 `alive` 标志
  （destroy 置位，装载 await 后检查作废）。
- 旧实现「面板相关 scss 无 data-* 键控选择器」迁移前已核实，`data-*`
  委托键（data-cid/data-dir/data-kdoc…）随迁移整体消失，类名逐字
  保留（含 wengu-cp-armed/wengu-cp-editing 状态类改由条件渲染挂）。

## 批次 3 落地记录（2026-08-30，review 域）

- 四件套：`core/ReviewUi|ReviewCtl` + `component/ReviewApp|ReviewGroup|
ReviewDetail`；原 `index.ts` 瘦身为壳渲染+挂载编排+外部入口，
  `ReviewHtml.ts` 瘦身为模型层（清单分组纯函数 listReviewModel +
  时间线 html 串——svg/Lute 产物与详情其余 html 字段同口径走
  {@html} 桥接）。
- **控制器单例模式（review 特有）**：筛选/排序/选中/缓存/详情串行链
  持久在模块级 `reviewCtl`（外部域 quiz 侧栏/统计面板在视图外也要
  读写：filterReviewDocFor/selectReviewQid/wrongOverviewNow 转发它）。
  组件 attach 时同步持久字段进 ui、detach 作废在途装载——视图重挂
  状态不丢（旧模块级变量语义）。
- **要点修订（rail/side/head 共享组件化留批次 6）**：review 是 quiz
  页签的模式分支而非平级面板（本就深依赖 quiz/service），side/head
  的绑定链（bindHeadFor/applySideFilter/树交互）与 quiz 壳同生命
  周期，提前抽字符串版无行为收益；批次 6 quiz 壳 Svelte 化时一并
  组件化才是自然时机。
- 装载完成仍走 `rerenderView()` 整壳重绘刷头部 summary（旧语义）——
  Svelte 主区随之重挂，单例状态由 ctl 承接；头部/侧栏事件仍由
  QuizView 统一绑定（壳 DOM 逐字未动）。
- snippet 渲染调用是 `{@render name(args)}`（写成 `{@name(args)}`
  svelte-check 报 expected_tag）。
- 详情数学渲染换 `$effect`（phase ready 且容器在位时对 inner 补
  renderMathIn，对齐旧 innerHTML 落位即调的时机）。

## 树组件收拢（2026-08-30，TreeList）

- `src/ui/TreeList.svelte`：共享递归树行组件——知识面板树（原
  `KnowTreeItem`，已删）与文档选择器树（原 `PickerTree.ts` 渲染层，
  已退役只剩建树纯函数）两套同款类名、各写一份渲染+宿主 CSS 的漂移
  源，收敛为同源渲染。通用行样式归 `base.scss` `.wengu-tree` 一份
  （原 rail/panels 两份宿主规则删除，宿主只留面板动作钮 hover、勾位
  图标色等特有位）。
- 组件契约：宿主自备 `<div class="wengu-tree">` 容器；`openKeys` 传
  共享可变 Set（$state 深代理，组件内增删即响应）；行尾自定义（计数/
  动作钮/勾位）走 `trailing` snippet；`kind: branch|doc|sec` 定行壳，
  `id` 参与单选高亮/多选勾。浮层内挂载见 `KnowPickerApp.svelte`
  （实例导出 getSelected/toggleSelected/clearSelected，平铺搜索行与
  「清空/确定」共用同一份勾选事实源）。
- vitest 无 svelte 插件：测试 import 链路过 .svelte（convert→
  KnowPicker→KnowPickerApp）会解析失败，`vitest.config.ts` 把
  `*.svelte` 别名到 `tests/svelte-stub.ts` 空壳（挂载不进单测）。
- 顺带修暗病：旧知识面板分支行/文档行的箭头点击无 stopPropagation，
  与行体 handler 双触发（分支折叠相互抵消=点箭头没反应、文档行误触
  打开）；TreeList 箭头统一断泡。

### 侧栏树并入（20260830 同日）

- 刷题侧栏文档树（原 `quiz/render/SideTree.ts` 字符串渲染）并入
  TreeList：渲染层退役，只剩 `buildSideTree` 纯建树；新增
  `quiz/component/SideTreeApp.svelte`（宿主：两行文档行经 TreeList 的
  `main` snippet 注入，元信息串在挂载侧预计算）+
  `quiz/flow/SideTreeMount.ts`（挂载编排：整壳 innerHTML 重建下
  挂载点不常驻——renderQuizShellFor 头部 detachSideTree、壳落后
  mountSideTreeFor；applySideFilter 重灌侧栏体后 remountSideTree
  复用本次壳的回调重挂，搜索态无挂载点=只卸不挂）。
- 折叠不再走 DOM 委托重绘：SideTreeApp 内部改展开集合经
  `ontoggle` 回调持久化 prefs.sideTreeOpen（旧 toggleSideTreeFor/
  toggleTree 委托链删除）；复习模式侧栏同挂（docId 传空不亮行，
  点行=selectDoc 分流筛选错题本）。树行带 `data-id`，右键菜单
  委托从 `[data-docid]` 扩到 `[data-id]`。
- **TreeList 契约同步扩展**：`main` snippet（自定义行主内容）、
  `ontoggle` 回调、行上 `data-id`；节点契约挪 `ui/TreeListTypes.ts`
  ——*.svelte 环境声明不带具名导出，.ts 侧（SideTreeMount）无法
  从 .svelte 具名导入类型。
- base.scss 旧的 `.wengu-tree-doc/.wengu-tree-branch/.wengu-tree-name`
  行规则随旧渲染删除；侧栏两行行/active 高亮条改 `.wengu-side-body`
  作用域新规则（对齐旧观感）。
- 专题树 ColTreeLevel **不并入**：官方文档树同款 li/ul+文件夹图标+
  行内改名/新建输入是其定稿视觉（col-folder 分支验收过），行解剖
  （depth 缩进模型/计数/武装态）与 TreeList 差异过大，硬塞会把共享
  组件撑成上帝组件；它本身已是递归 Svelte 组件，架构同族。

## 批次 4 落地记录（2026-08-30，stats 统计面板）

- 四件套：core/StatsUi|StatsCtl（ctl 单例，浮层 open/destroy 外部契约
  不变）+ comp/StatsApp（浮层壳+tab 路由）|StatsOverview|StatsDoc；
  StatsHtml.ts 整体删除（纯渲染函数组件化）。
- **echarts action 壳**（comp/echart.ts）：`use:echart={option}`——
  init/setOption/dispose + window resize 监听全收进 action，节点
  卸载即 dispose（旧 StatsChartHost 实例池删除，浮层关闭/切 tab 天然
  防泄漏——暗雷 §8 命令式别声明式化的标准应用）。
- 挂账清偿：QuizView.destroy 此前漏调 destroyStatsPanel（浮层随
  v.el 移除但 echarts 实例与 resize 监听滞留）——已补。
- 浮层定位壳 .wengu-stats-wrap 由挂载编排建宿主挂（组件根从
  .wengu-stats-layer 起，CSS 零改动）；关闭动作经 props onClose
  注入（防组件→index 循环 import）。

## 批次 5 落地记录（2026-08-30，convert 两弹窗）

- 范围裁定：service 层（ConvertRun/Batch/Service/Detect/MinerU 等，
  ~3300 行）是流程与数据逻辑不属 UI 迁移；本批只迁 UI 层两弹窗
  （ConvertDialog 288+118 行 / ConvertPanel 197 行 + ConvertPick 110）。
- **Dialog 壳模式落地**：`new Dialog({content: 宿主 div})` +
  mountSvelteApp 进宿主——关闭统一走编排层 close()（unmount+destroy），
  组件经 props onClose 调用（防组件→编排循环 import）。busy 期间
  右上角 X 的 capture 接管留在编排层（ctl.isBusy/stopImport）。
- ConvertDialog 四件套：表单状态全进 ui（旧实现散在 DOM 控件、start
  时逐个 querySelector 收集）；选择器桥（KnowPicker/ModelPicker）由
  ctl 方法直调 openKnowPicker / modelPickAction action；回显解析带
  竞态序号；PdfImportRow 改纯函数 runPdfImport 由组件直调（按钮/
  文件输入交互在组件）。setBusy 禁用=disabled={ui.busy} 声明式，
  旧 setBusy 十二个元素手动 disable 的重放自然消失。
- ConvertPanel 四件套：subscribeConvertRun 订阅在 attach/detach 对齐
  组件生命周期（旧 document.contains 自清退订不再需要）；丢弃进度
  两击确认进 ui.armedDoc；「进行中」空态/两区路由全响应式。
- ConvertDialogHtml.ts / ConvertPick.ts 删除（渲染与联动逻辑分别
  进组件与 ctl）。

## 批次 6 落地记录（2026-08-30，quiz 域拆多批：6-1~6-3）

- **6-1 开刷面板**：component/StartPanelApp（表单字段全 $state）+
  render/StartPanel.ts 瘦身为模型构建（buildStartPanelModel）+ 开轮
  执行（startRound/beginDrillFor）+ 挂载编排（mountStartPanelFor/
  detachStartPanel）。「继续上次=锁定回显」走 $derived 渲染值，旧
  bindStartPanel 的 setVal 重放与 data-act 委托链删除；壳在面板位放
  `[data-startpanel-host]` 宿主，面板态条件（非加载/错误、有文档有题、
  未开刷非预览渐进）与 renderMainShell 同款在编排层判断。
- **6-2 轮次报告**：component/RoundReportApp（条形图/薄弱区脚本侧
  预计算，model 为收卷时一次性快照）+ showRoundReportNow 收口挂载
  （[data-report] 宿主，收一次卷整挂整卸）。AI 分析按暗雷 §8 保持
  命令式：组件 bind:this 拿按钮/输出区直喂 runAgentTextOrPanel；
  薄弱加练经 onWeakDrill 回调进编排层。renderRoundReport/
  renderWeakSection/bindRoundReport 删除；byBaseQid/buildAnalysisPrompt
  导出供组件复用。
- **6-3 rail + 题号栏**：component/RailApp + component/NumRailApp；
  RailHtml.ts 改名 RailMount.ts（挂载编排，RAIL_ANCHOR_HTML 锚）。
  **anchor 挂载法**（mountApp 新增 anchor 选项）：rail（flex:none
  三栏）与题号栏（sticky 直接子元素）的布局依赖父子关系不能包宿主
  div——壳 HTML 在插入位放锚节点，mount(root,{target:父,anchor:锚})
  后删锚，组件根顶替锚位，CSS 零改动。四处壳拼接（主壳/错误兜底/
  工作区分支/复习分支）统一 RAIL_ANCHOR_HTML + mountRailFor；错误
  兜底旧路径渲染了 rail 却漏绑事件，随迁移顺修（有意）。
- **题号栏三写收敛**：初始态（numState）/判分描色（FlowDom.markNum）/
  已答态（AnswerFlow.markNumAnswered）三处直改 DOM 统一为 NumRailApp
  的 marks 响应态，写入经实例导出（setActive/markAnswered/
  markResult，*.svelte 实例导出类型在 ts 侧收口 interface + cast，
  KnowPicker 同款）；bindNumRail 保留全部实测调优行为（追赶滚动/
  滚动跟踪/吸顶封顶实测），activeBtn 差分手写退役。showPast 守卫
  （预览保密/统一揭示）从渲染入参挪进挂载入参，语义不变。
- ~~**待办（6-4b）**~~：已落地，见下「批次 6-4b 落地记录」。

## 批次 6-4a 落地记录（2026-08-31，题卡渲染层组件化）

- **范围裁定**：本批只迁「渲染层」——三类题卡（普通/steps/slots）与
  材料组壳的字符串模板退役为组件，**DOM 契约逐字一致**（类名/
  data-*/hidden 初始态全部保留），Answer/Steps/Slot 三流程、
  PreviewFlow 装饰、restoreAnsweredCards 恢复、MaterialFlow 组交互、
  NumRail 滚动跟踪（DOM 扫描）、标注层/重新生成（委托）全部零改动。
  作答态收敛（三写痛点）留 6-4b——一次性同时动渲染源与状态源在
  做题主流程上回归面过大，先真机验证组件产物的 DOM 等价性。
- 四件（件数减一，无状态渲染层没有 ui/ctl）：component/QuizCardApp
  （三形态 {#if} 路由 + snippet 复用卡头/思路区/尾行）+ component/
  GroupUnitApp（组壳+组内卡 hidden）+ render/CardMount（逐单元挂载
  编排 + 模块级 apps 清单 + detachCardApps）。挂载：renderStaticChunked
  的 `insertAdjacentHTML(renderOneUnitHtml)` 换 `mountDrillUnit`
  （mount 追加容器尾=组件根顶替原字符串节点）；组件无自有状态、
  props 挂载后不变，外部直改 DOM 不被覆写（state_referenced_locally
  警告按 NumRail 先例 svelte-ignore 并注明快照语义）。
- 卸载链：renderQuizShellFor 的 detach 块与 QuizView.destroy 补
  detachCardApps（innerHTML 覆盖不触发 Svelte 卸载，暗雷 §7）；分片
  管线 stale 检查在挂载前、挂载点间无 await 间隙，整壳重建不会漏卸。
- 退役：renderCardHtml/renderStepsCardHtml（字符串版）/renderAnswerArea/
  renderCardsHtml/renderUnitsHtml/renderOneUnitHtml/renderCardHead/
  renderThoughtArea、SlotHtml.ts 整文件、DrillUnits 渲染半（只剩
  buildDrillUnits 纯函数）。**留守**：renderOneStepHtml/
  renderStepsInnerHtml/fillOneStep（StepsFlow 实时模式仍走 DOM 追加轨，
  与组件静态步骤markup暂双轨——6-4b 随状态化合一）。
- 单元渲染失败兜底：mountDrillUnit try/catch 回退占位卡字符串
  （旧 tryCard 同策）。

## 批次 6-4b 落地记录（2026-08-31，作答态三写收敛进卡内响应态）

- **范围裁定**：本批迁「状态源」——初始渲染（renderCardHtml 系）/
  恢复继续（restoreAnsweredCards 含 restoreSubmitted/revealCard）/
  判分揭示（Answer/Steps/Slot 三流程直改 DOM）三处写卡统一收敛为
  卡内响应态 CardUi，三流程只写状态不碰 DOM。6-4a 已验证组件产物
  DOM 等价，本批把「写」也收进组件。
- 三件套（新增，render/）：**CardState**（CardUi 全量渲染态接口 +
  buildCardInit 纯函数——新卡与恢复卡同一条路，steps/slots 逐 #k
  恢复矩阵口径与旧 restoreAnsweredCards 对齐）+ **CardCtl**（控制器，
  持 ui + 根元素，向流程与组件提供读写面，事件编排在流程、本类只
  放形态无关小件）+ **CardRegistry**（模块级登记表：组件 onMount
  自登记/注销，收卷锁卡/思路快照/收口检查/统一揭示按表遍历，替代
  .wengu-card [data-graded] DOM 扫描）。
- 组件升级：QuizCardApp 从无状态渲染层升级为持 CardUi（$state
  buildCardInit）+ CardCtl 实例，作答事件组件直调流程（pickLetter/
  submitQuestion/nextStep/submitSlot 等），onMount 自登记 + 题干静态
  填充（旧 mountStatic 单节点语义收进组件）。拆出 CardStepsArea/
  CardSlotsArea 两个作答区子组件压行数。GroupUnitApp 收组导航/
  材料折叠/滚动记忆（qi 响应态），组运行态仍持 MaterialFlow 模块级
  Map 跨重渲染存活，题号导航 focusQuestion 改组登记表定位。
- 挂载编排（QuizShell/CardMount）：renderStaticChunked 挂首卡前一次
  算好 CardInitCtx（interactive=可作答 / locked=收卷后锁 / restore=
  恢复源），逐单元 mountDrillUnit 传 ctx+host——已答恢复/收卷锁卡
  随组件挂载就位，落幕统一恢复（renderListFor 的 restore 尾注）与
  逐卡 bindCardEvents 事件绑定删除。revealAnsweredNow 改等 renderTask
  （静态分片就绪）再揭示——手动收卷不再漏在途卡。
- 退役：AnswerFlow 的 bindCardEvents/readSubmitted/restoreAnsweredCards/
  restoreSubmitted/markChips，MaterialFlow 的 bindGroupUnits/
  bindOneGroupUnit/restoreGroupScrolls，CardHtml 的 renderOneStepHtml/
  renderStepsInnerHtml/fillOneStep/collectCardThoughts，SlotFlow 的
  bindSlots 系。ProtyleHost.mountStatic 的题卡/材料填充收进组件
  onMount（类本身留存）。
- 行为对齐要点：steps 离线解锁滚动改组件渲染后 stepEl 查询（旧
  next.scrollIntoView 同位）；实时模式追加步 flushSync 后滚动（旧
  renderOneStepHtml+fillOneStep DOM 轨并入响应态 appendRealtimeStep）；
  match 提交钮描色后由 marks 派生隐藏（旧直接 setAttribute）；逐题
  计时/思路快照/AI 判分三态/申诉改判全部走状态，无 DOM 读取。

## 批次 6-5 落地记录（2026-08-31，侧栏/头部壳 Svelte 化——quiz 域收尾）

- **范围裁定**：本批迁 quiz 域最后的字符串壳——侧栏（目录树/搜索/
  专题区/工具区）与主区头部（次头部/结束本轮/计时器）。至此 quiz
  域（除不迁清单）整体 Svelte 化，六批路线图收官。
- 两组件：**SidePanelApp**（侧栏壳+头部图标操作+顶部工具区+主体
  清单）+ **QuizHeadApp**（目录开关/次头部/结束本轮/计时器壳）。
  编排收进 flow/SideMount（mountSideFor/mountHeadFor/detachSideHead/
  refreshSideCols/sideActFor），壳占位从 renderMainShell 的
  data-side-host/data-head-host 进，组件根即布局直接子元素。
- 侧栏主体三态（树/搜索平铺/专题区）统一为 $derived 切片：同一份
  docs 派生源，空搜索=TreeList（展开态组件内 Set+onPersistOpen
  回写 prefs）、有词=按父路径平铺分组、专题区恒顶。原
  renderSideBodyHtml+applySideFilter 重灌+remountSideTree 重挂三件套
  退役——搜索不再重灌 DOM、输入框不重建、焦点天然不丢。
  专题清单/选中轻量刷新走实例导出 updateCols（bank.refreshSide 改道
  refreshSideCols，不打断作答）。
- 头部次头部是导航时一次性渲染的静态串（文档信息/轮次成绩，
  renderSubheadHtml 留编排侧算 rounds），作 prop {@html} 喂入。
  跨重建命令式钩子保留 DOM 契约、组件只产壳不接管写：计时器
  [data-timer]（TimerBinder 每秒）、倒计时归零 [data-timeup-slot]、
  转换进度 [data-status]、转换按钮文案 [data-convert-label]、
  文档行右键菜单（ViewBindings 委托 data-docid/data-id，带 async
  livingSourceOf 门控，组件右键语义弱于原生 contextmenu 故保留）。
- 退役：renderSideHtml/renderHeadHtml/renderSideBodyHtml/applySideFilter、
  ViewBindings 的 bindViewEvents/bindHeadFor/HeadAccess（refresh/
  convert/settings/side-fold/side-toggle/end-round/stats/collections
  逐钮绑定收进 sideActFor 单 switch）、SideTreeMount/SideTreeApp
  （树并入 SidePanelApp）。review 壳改占位宿主、side/head 由
  QuizShell 统一挂载（次头部待刷/已掌握经 reviewHeadSummary 喂）；
  MainShellModel 剥掉不再透传的侧栏/头部字段。
- 红线备注：src/quiz/index.ts 518 行略超 500——本批新增的 sideAct
  访问器簇属 QuizView 紧凑访问器表，强行外移破坏内聚，豁免并记此。
