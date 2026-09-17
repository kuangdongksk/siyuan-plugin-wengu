---
name: wengu-reimport-remove-set
description: 题集右键两改+半截脏数据修复(b03a3e2)已提交部署机器A；渐进文档=题集常态删前漏读回是根因；push 断连待补推
metadata:
  node_type: memory
  type: project
  originSessionId: sess_879c1ae2-2f35-4398-967a-cd4540020b4d
---

2026-08-29 需求：①习题支持重新导入（网络中断导一半可重做）②「删除文档」改「删除此题集」（不删文档本体）。已落地（提交 e8fa890+bebe398）。用户补要求：重导**须检测断点续跑而非全量重转**（已生成部分不重复花费）——bebe398 已改。

**2026-08-30 半截脏数据修复（b03a3e2 已提交已部署机器 A）**：用户真机踩坑「重新导入清空旧题集又从断点续跑，结果只有后半截」。根因：`reimportDocFrom` 读回旧内容只在 `rec.docId !== docId` 时执行，而 **newdoc 终止保留的常态恰是 rec.docId===当前题集**（《源·习题》渐进文档即题集本身）→删前没读回→resume 只带 offset→续跑只剩后半截。修复双兜底：①`planReimportRead`（纯函数，DocOps）读回目标含渐进文档=题集形态；②`reimportResume`（纯函数）读不回任何旧内容不带断点从头转；③ConvertBatch 断点总闸：existing 空→resume 归一 undefined（全新转换含 detect），「继续生成」路径渐进文档被手动删同病同修。用户手上的半截题集：前半截旧题集在**回收站**可找回。部署注意：当时思源开着**测试工作区**（D:\data\思源\测试，内核动态端口 52036），「工作」工作区内核没跑、无法热重载——文件已拷到位，下次打开「工作」即生效。

**关键机制（真机探针验证）**：内核 `/api/attr/setBlockAttrs` 传**空串值=删除该属性**（attributes 表行消失）；SQL `/api/query/sql` 的 payload 键是 `stmt` 不是 `query`（探针脚本踩过）；`removeDocByID` 是大写 ID。相关：[[wengu-kernel-extra-traps]]。机器 A 思源 3.8.1：conf.json 在 `conf/` 子目录、内核端口**动态分配**（AGENTS.md 的 6806 过时，`wmic process where "name='SiYuan-Kernel.exe'" get CommandLine` 拿真实端口+workspace）。

**实现口径**（勿回退，与 [[user-kaoyan-exam-prep]] 的模拟卷场景对齐）：
- 删除此题集=`DocOps.unregisterDocAsQuiz`：按 root_id 全量分页查文档内 `custom-plugin-wengu-%` 属性→一块一次 setAttrs 置空剥离+清题库/会话历史，文档保留；source-doc 随属性剥离后 OrphanCleaner 不再连带。
- 重新导入=`DocOps.reimportDocFrom`（**续跑语义**）：菜单先查 `livingSourceOf`（source-doc 配对+存活核对，fail-closed 不露出）→查 `convertProgressOf(srcId)` 续跑记录→`planReimportRead` 定读回/单独删目标（渐进文档=题集只读不单独删）→删前读回 kramdown→删旧题集(回收站)→清续跑记录（防「offset 已覆盖全文」短路把待删文档当完成态返回）→`reimportResume` 组装（读不回不带断点）→`startConvertForView` 另存续转；rec.kramdown 形态（原位中断）经 reimportResume 回落并入。cfg 组装 `reimportCfg(srcId,last,settings,resume?)`。
- 转换事件接线抽公共组 `convertRunEventsFor`（convert/index.ts），弹窗 startRun 与右键共用；ConvertHostCtx 里的 el/onBatch/onCancel/onDone/saveProgress 死字段已删。
- 菜单三项：错题复习/重新导入(有源才露出,iconRefresh)/删除此题集(iconTrashcan)+变式重练；右键查源有 SQL 往返，菜单迟一拍开（无原生点击延迟感知）。
