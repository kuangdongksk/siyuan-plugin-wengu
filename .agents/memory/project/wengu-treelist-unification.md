---
name: wengu-treelist-unification
description: 知识面板树+文档选择器树收敛共享组件 TreeList（20260830），已部署测试工作区待验收、未提交
metadata:
    node_type: memory
    type: project
    originSessionId: sess_9bfe960b-2224-4758-bd16-bcb9ca441db6
---

用户指出知识文档面板树与 KnowPicker 选择器树样式明显不一致，要求建一个
treelist 组件（2026-08-30）；随后扩令「所有树尽量都用它」。三树已并+侧栏
树已部署测试工作区（内核端口 52036），**未提交**；两区插件目录已拷，md5 一致。

- `src/ui/TreeList.svelte` 共享递归树行组件（Self 自引用）；契约：宿主
  自备 `<div class="wengu-tree">`、`openKeys` 传共享可变 Set、行尾走
  `trailing` snippet、行主内容可走 `main` snippet（侧栏两行行）、
  `kind: branch|doc|sec`、`id` 参与选中+行带 `data-id`（右键委托用）、
  `ontoggle` 折叠回调。**节点契约在 `ui/TreeListTypes.ts`**——.svelte
  环境声明不带具名导出，.ts 侧无法从 .svelte 具名导入类型。
- 三个树已并：知识面板（KnowTreeItem 已删）、选择器（PickerTree 只剩
  建树，浮层挂 KnowPickerApp）、**刷题侧栏树**（20260830 同日第二批：
  SideTree.ts 渲染层退役只剩 buildSideTree；quiz/comp/SideTreeApp +
  quiz/flow/SideTreeMount 挂载编排——整壳重建下 renderQuizShellFor
  头 detachSideTree/壳后 mountSideTreeFor，applySideFilter 尾
  remountSideTree 复用回调；折叠改组件内消化+ontoggle 持久化
  prefs.sideTreeOpen，旧 toggleSideTreeFor/toggleTree 委托链已删；
  复习模式侧栏同挂 docId 传空；右键菜单委托扩到 [data-id]）。
- **ColTreeLevel（专题树）有意不并**：官方文档树同款 li/ul+文件夹+
  行内改名是其定稿视觉（col-folder 验收过），行解剖差异过大，硬塞
  会撑成上帝组件；它已是递归 Svelte 组件同族。
- **vitest 无 svelte 插件**：测试图路过 .svelte（convert→KnowPicker→
  KnowPickerApp）解析失败——vitest.config 把 `*.svelte` 别名到
  `tests/svelte-stub.ts` 空壳；别名正则必须 `^.*\.svelte$` 整串匹配
  （只写 `\.svelte$` 会替换成拼接垃圾路径）。
- 顺带修暗病：旧面板分支/文档行箭头点击不 stopPropagation，与行体
  handler 双触发（折叠相互抵消=点箭头没反应）。
- `.svelte` 走泛型环境声明，实例导出类型丢失：mount 后
  `mounted.app as XxxExports` 一次断言收口（KnowPicker/SideTreeMount
  两处同款）。

- **20260830 审查发现 P0（未修）**：浮层 KnowPicker.ts 的 `showFlat()`
  会 `unmountTree()` 销毁勾选事实源（treeApp 置空）——搜索模式多选
  点行静默无效、「确定」返回 [] → 知识面板 `setKnowRoots(bank, [])`
  反向清空已有登记。详见 [[wengu-knowledge-redesign-audit]]。

相关：[[wengu-svelte-batch2-bank]]（batch2 的 KnowTreeItem 已被本组件取代）、
[[project-parallel-sessions]]（期间并行会话在提交 bank 批次2/review 批次3
并改 word 域，WordImport 半成品曾让 svelte-check/vitest 凭空红）。
