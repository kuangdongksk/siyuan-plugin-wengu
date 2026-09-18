---
name: wengu-svelte-batch2-bank
description: Svelte
    批次2(bank面板)+批次3(review主区)已提交部署测试工作区；控制器单例模式；rail/side/head组件化并入批次6；push断连本地ahead待补推
metadata:
    node_type: memory
    type: project
    originSessionId: sess_ae10b8bd-c0bc-47b7-a880-752687402f59
---

Svelte 迁移批次 2+3（2026-08-30）：bank 两工作区面板（7869fad）+
review 错题本主区（49bb908），均已部署**测试工作区**（D:\data\思源\
测试）并重载，等用户真机验收。批次 4 起 stats 域（echarts action 壳；
顺手修 destroy 不清 statsPanel 泄漏）。

**Why:** 用户指令「继续转换svelte」；批次顺序由 docs/svelte-migration.md
路线图锁定，两批落地记录已写进该文档。

**How to apply:**

- 递归树组件：`import Self from "./Self.svelte"` 后用 `<Self>`（Svelte 5
  无 svelte:self）；snippet 渲染调用是 `{@render name(args)}`。
- **控制器单例模式**（review 先例，跨视图持久状态用）：模块级 ctl
  单例持 filter/sort/selQid/cache/详情串行链，组件 attach 同步进 ui、
  detach 作废在途装载——外部域（quiz 侧栏/统计面板）视图外读写走
  ctl 方法转发。
- **rail/side/head 共享组件化并入批次 6**（批次 3 要点修订，已在文档
  注记）：review 是 quiz 模式分支非平级面板，side/head 绑定链与 quiz
  壳同生命周期，提前抽无行为收益。
- 机器 A 环境（AGENTS.md 已回填）：思源 3.8.1、conf.json 在 conf/
  子目录、内核端口随机（查 SiYuan-Kernel.exe 命令行）、调试常用
  「测试」工作区。
- **并行会话纪律踩坑**：`git add -A` 会卷入对方在途文件（KnowPickerApp
  /TreeList.svelte 被 reset 拆出）——提交一律点名文件，见
  [[project-parallel-sessions]]。
- push 断连（GitHub 443 不通，两轮重试失败）：本地 ahead 含我的两
  提交+对方 e253def 等，下轮先补推。
- Tailwind 结论已给用户（不引或 @apply 折中，等六批迁完再定）。

- 批次 4（stats，4d5bbad 2026-08-30）：四件套+echart action 壳
  （use:echart，节点卸载即 dispose，StatsChartHost 实例池删除）；
  QuizView.destroy 补漏 destroyStatsPanel（挂账清偿）；onClose 走
  props 注入防组件→index 循环。批次 5 起 convert 域（3962 行，Dialog
  壳保留 new Dialog 只换内容区）。

- 批次 5（convert 两弹窗，267b98b 2026-08-30）：范围裁定 service
  层~3300 行不属 UI 迁移，只迁 UI 层两弹窗；Dialog 壳模式=new
  Dialog(content 宿主 div)+mountSvelteApp，close 走编排层（unmount+
  destroy），组件 props onClose 防循环；busy X 接管留编排层
  （ctl.isBusy/stopImport）；PdfImportRow 纯函数化 runPdfImport 组件
  直调；setBusy 十二元素手动 disable → disabled={ui.busy}。批次 6
  （quiz 域拆多批+rail/side/head 组件化）待开工。

- 批次 6-1~6-3（2026-08-30，31fd228/119444e/c846863+文档 0b3532e，已
  推送 origin/dev）：开刷面板/轮次报告/rail+题号栏。**anchor 挂载法**
  （mountApp 新增 anchor 选项）：布局依赖直接子元素（rail flex:none、
  题号栏 sticky）不能包宿主 div——壳放锚节点、mount(target:父,anchor:
  锚)后删锚，CSS 零改动；四处壳拼接统一 RAIL_ANCHOR_HTML。**题号三写
  收敛**：初始/判分/已答统一 NumRailApp marks 响应态，实例导出在 ts 侧
  收口 interface+cast（KnowPicker 同款）。AI 通道 bind:this 喂命令式
  （暗雷§8）。错误兜底 rail 漏绑事件顺修（有意）。已部署机器A两区
  （文件拷贝；思源当时未运行无热重载，启动即新版）。**6-4（题卡+
  Steps/AnswerFlow 三写终结）刻意未动**：~~1900 行作答核心，长卷性能
  分片管线是 20260830 刚真机调优的硬约束，按「每批真机验证后进下一
  批」纪律候用户验收 6-1~~6-3 后再动，切分约束已记进迁移文档。
