# Svelte 渐进迁移指南

全仓 UI 从「字符串模板 + innerHTML + 委托事件」渐进迁移到 Svelte 5 组件。
本文件是后续各批次迁移的施工手册：模式样板 + 暗雷清单 + 路线图。
首批落地记录见文末。

## 现状

- 构建链零配置扩展：webpack 按 `\.svelte$` 后缀匹配整个 `src/`
  （webpack.config.js），任何域新增 `comp/*.svelte` 即被编译。
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
2. **根组件** `comp/XxxApp.svelte`：
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

| 批  | 目标                  | 规模    | 要点                                                                                        | 状态          |
| --- | --------------------- | ------- | ------------------------------------------------------------------------------------------- | ------------- |
| 1   | 地基 + CompanionPanel | 218 行  | 首个面板样板（mountApp/FormRow/svelte-check）                                               | ✅ 2026-08-27 |
| 2   | bank 工作区面板       | ~740 行 | 同 WorkspaceShell 挂载链，复用面板样板；两棵递归树组件                                       | ✅ 2026-08-30 |
| 3   | review 域             | 539 行  | 先抽 quiz 借用的 rail/side/head 成共享组件                                                  |               |
| 4   | stats 域              | 822 行  | echarts action 壳；顺手修 destroy 不清 statsPanel 泄漏                                      |               |
| 5   | convert 域            | 3962 行 | Dialog 壳保留 `new Dialog` 只换内容；setBusy/lastBar 重放自然消失                           |               |
| 6   | quiz 域（拆多批）     | 6807 行 | StartPanel → RoundReport → rail/Nums → 题卡（Protyle 壳）→ Steps/AnswerFlow（三写痛点终结） |               |

**不迁清单**：`ui/FormHtml.ts`（两轨公共地基）；ModelPicker/KnowPicker
浮层（body 单例，保持字符串模板，Svelte 侧用 action 桥接）；
SettingsDialog（低频稳定，路线图末尾再评估）。

## 首批落地记录（2026-08-27）

- `src/ui/mountApp.ts`：共享挂载帮手（word/companion 现有两处手写
  样板不回改，新域一律用它）。
- `src/ui/FormRow.svelte`：表单行 Svelte 积木（children snippet）。
- `src/ui/ModelPicker.ts` 新增 `modelPickAction`：Svelte action 桥。
- companion 管理面板四件套：`CompanionPanelUi` / `CompanionPanelCtl`
  / `comp/CompanionPanelApp.svelte`，删除旧 `core/CompanionPanel.ts`
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
  `comp/CollectionPanelApp|ColTreeLevel` / `comp/KnowledgePanelApp|
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
