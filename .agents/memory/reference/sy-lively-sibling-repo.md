---
name: sy-lively-sibling-repo
description: 同作者兄弟插件 sy-lively（与温故同父目录）——内核 API 构建工厂与目录组织的借鉴源，用户会直接指路参考它
metadata:
    node_type: memory
    type: reference
    originSessionId: sess_eb9a6202-75f6-4915-a176-72354a8a5297
---

sy-lively 在 `/Volumes/baiWeiNV7200/sasa/siyuan/sy-lively/`（与温故仓库同父目录；Windows 机 A 对应路径未知）。同作者（kuangdongksk）的「喧嚣」思源插件，React+vite+tailwind 技术栈（与温故的字符串模板不同，别照搬 UI 层）。

**可借鉴的部分（2026-08-26 已迁入温故）**：

- `src/class/思源/块.ts·文档.ts·笔记本.ts`（SY块/SY文档/SY笔记本 薄封装）+ `src/constant/API路径.ts`（EAPI 路径枚举）——即用户说的「构建工厂」，已适配为温故 `src/siyuan/`（KernelBlock/KernelDoc/KernelNotebook + EApi，英文方法名）。
- 目录组织：class（内核层）/module（业务）/pages/业务组件/constant/types/utils 分层——温故七域结构借鉴于此。
- 内核写入惯用法：`/api/block/insertBlock|appendBlock|prependBlock`（markdown dataType）锚定 previousID/parentID 逐块操作，读回显 `data[0].doOperations[0].id` 作真实块 id——正是温故 append 通道的来源（锚点须真实子块等约束见 AGENTS.md「内核坑」）。

**How to apply:** 用户遇内核/组织问题时常指路「看看 sy-lively 的方式」——先读对应模块再决定迁移；它跑在同一思源内核上，其 API 用法真机可信。相关：[[work-rules-siyuan-plugin]]、[[convert-pipeline-pending]]。
