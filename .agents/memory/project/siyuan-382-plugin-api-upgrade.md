---
name: siyuan-382-plugin-api-upgrade
description: 思源 v3.8.2/3.8.3 插件 API 升级评估——3.8.2 十四条已核实；20260907 机器 B 内核实测
    3.8.3：customBlockRenders 自定义块/addToolbarItem·removeToolbarItem/onDataChanged 改进/
    getBlockKramdown tag 分隔符；npm 类型包 1.2.7 已带新 API（仓库锁 1.2.4）；机器 A 仍 3.8.1
metadata:
    node_type: memory
    type: project
    originSessionId: sess_31af8d7c-7c2e-4056-9509-4a13e3f1ec04
---

2026-08-31 用户贴出思源 v3.8.2（尚未发布，官方仓库 `app/changelogs/v3.8.2`）的 14 条插件相关 changelog 要求评估。已逐条核实 issue 原文（#12137/#18762/#18830/#18856/#18876/#18878/#18909/#18911/#18915/#18916/#18935/#18972/#18978/#18979），与温故的关系：

- **事件总线重写（#18762）**：每插件独立 bus、禁用/卸载时整体销毁自动退订——`src/index.ts:293` 手动 `eventBus.off("ws-main",…)` 从 3.8.2 起冗余（留着无害）。新增 `hasPluginSubscriber`，`open-menu-content` 等无人订阅时内核跳过准备工作。
- **addTopBar 支持 id + removeTopBar（#18911）**：元素 id 稳定（不再依赖数组长度，unpin 存储不失效），可按设置动态显隐顶栏入口。
- **面包屑自定义按钮（#18856）**：`addBreadcrumbButton({id,icon,title,callback})/removeBreadcrumbButton(id)`，适合放「本文档转习题/开刷」一键操作，比右键菜单少点两次。
- **open-link 拦截（#18830）**：`preventDefault` 可接管任意链接打开（覆盖 openLink/openByMobile 全路径，含 siyuan://）；温故现有 `window.open("siyuan://…")` 块引用跳转不冲突。
- **forwardProxy 修复（#18978）**：`responseEncoding` 之前编码的是字符集转换后的 UTF-8 文本，非 UTF-8 原始字节拿不到；MinerU 目前 text 模式未踩坑，以后经 forwardProxy 拉 GBK/二进制才需要。
- **生命周期时序（#18979）**：修复 onunload async 不被 await 等契约不一致；温故 onunload 本就同步，无需改动。
- Protyle `setFullscreen/isFullscreen`（#18909）、dock 可见性独立控制（#18876/#18935）、搜索渲染前处理（#18915）、已保存搜索 API（#18916）、自定义启动界面（#18972）、Protyle 容器带文档自定义属性（#12137，利好 CSS 主题适配）。

**升级待办（3.8.2 装机后）**：①`siyuan` 类型包 1.2.4→配套新版（addDock/removeTopBar/面包屑按钮目前靠局部声明兜底，见 src/index.ts:26 WordDockConfig）；②顶栏按钮传稳定 id；③评估面包屑加快捷入口；④删 `src/index.ts:293` 手动 `eventBus.off("ws-main",…)`（3.8.2 起卸载自动退订，见 #18762）。

**机器 B 内核已升 3.8.2**（2026-08-31 同日 curl /api/system/version 实测返回 "3.8.2"）——changelog 里的 API 已可用，升级待办可开始执行；类型包是否已发配套新版待查 npm。机器 A 版本未验。

**20260903 真机踩坑补充（saveData 生命周期闸）**：3.8.2 前端 `Plugin.saveData/loadData/removeData` 失败 reject **裸对象** `{code,msg,data}`（非 Error，`String()` 得 "[object Object]"），且新增生命周期闸——实例 dispose（petal 重载/页签销毁与 2s 防抖 markDirty 竞态）后**永久**拒 410「Plugin lifecycle has ended」。三类拒绝全是客户端的（fetchPost 回调形态内核出错也 resolve）：410 终止类（重试循环必须停手否则僵尸化）/403 只读/400 序列化失败。修法已落仓：`ui/shared errText`（全仓 34 处扫换）+ `isLifecycleGone`（QuestionBank.flush 终止类不重排）；细节记 AGENTS.md 内核坑节。当时「题库落盘失败 [object Object]」toast 全来自重载残骸的旧实例，正常实例落库无恙（盘上 bank 持续增长为证）。

**重载机制与无头僵尸运行（20260903 实锤）**：petal 每次装载经 `window.eval` **重新求值**插件 JS——模块状态全新（新 ConvertRun 单例为空、`convertRunActive()`=false），但**旧模块闭包里运行中的异步循环不死**（转换批次循环+store 引用全在闭包内）→ 重载后旧运行成「无头僵尸」：bank 照常落库（实测持续 4 小时+）、新界面无停止钮管不住它、对同文档再开转换有并发写同题集之险；二次实例 hydrate 会把在途 running 记录补标 AI_INTERRUPTED（endedAt=hydrate 时刻）——时间线核查别把这种误标当真实失败。处置：刷前端杀僵尸→「重新导入」增量补剩余。同日 ai-sessions 落盘自重载点断供（串行落盘链疑卡死于外置卷 EIO 挂起，文件 mtime 冻结在 10:16）——面板核对「文件没有≠没调用」。见 [[convert-pipeline-pending]] [[ai-session-manager-panel]]。
