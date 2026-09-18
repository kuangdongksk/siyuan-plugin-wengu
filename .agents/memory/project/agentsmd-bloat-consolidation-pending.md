---
name: agentsmd-bloat-consolidation-pending
description: （已解决 20260915） 20260910 用户嫌 AGENTS.md 太长（576行/44KB，「项目速览」占半）；我诊断病根=append-only
    考古层，提议压「项目速览」考古/代码可推导部分、保留内核坑等硬约束，未动，等用户拍板
metadata:
    node_type: memory
    type: project
    originSessionId: sess_08e1509d-ccc3-44b9-970b-270be8b8ed17
---

20260910 用户问「这一段内容怎么这么多」，指 AGENTS.md 的 `## 项目速览` 段（第 6–281 行，276 行）。实测全文 576 行 / ~44KB，速览占近一半。

**病根**：AGENTS.md 是给 AI 代理读的 append-only 机构记忆，每域条目把「当前结构」与「历次改动的 before/after + 为什么改 + 退役了什么」（带 202609XX 日期前缀的地质层）全部揉在一起，混进了「代码可 grep 推导的组织描述」和「真正非显然、不可再生的硬约束」。

**why 和怎么分**：内核坑 / 数据演进守则 / 机器 A·B 差异 = 反复踩坑换来的，逐字保留（删了很快复发）；可压缩 = 「项目速览」里纯代码可推导的组织路径 + 带日期考古注释，估计能削一半（保守），不伤任何一个硬约束。另 AGENTS.md 与 memory 的 MEMORY.md 部分内容互相重复，也是冗余源。

**How to apply:** 我提出做一次「保硬约束整理」：速览压成「结构速查 + 只留非显然约束」、历史地质层注释降级或删、编号/冻结清单/内核坑/机器工具链坑逐字保留。**尚未动手**，等用户确认；真要做时给「留/删/迁 docs/」拆解方案再动（动 AGENTS.md 是改用户代理记忆的实质变更，属需拍板项，参考 [[post-feature-review-checklist]] 的文档三件套同步）。若用户改口「就这样别再动」，删掉此条。

**20260910 同日已拍板（方向修正）**：用户看到速览揉成一长段，反馈「分条改成列表，都集中在一起不好看」——**选的是可读性重排，不是内容缩减**。已把 `## 项目速览` 重排成「每域一个 `###` 小标题 + 逐条列表」，全部硬约束 + 带日期的考古备注**一字未删**，仅拆句（尾段数据演进守则及以后逐字未动，已 diff 校验）。此前「压考古/删代码可推导部分」的内容缩减方案**未采纳**——此用户偏好「留内容、只改可读性」，见 [[doc-prefer-structured-lists]]。此条不再 hold，只留作参考；如需真精简另议。

**20260915 已解决**：用户拍板真拆分——AGENTS.md 1977→207 行，域笔记按模块
搬入 `.agents/memory/`（quiz/mobile/convert/bank/ai/word/siyuan/companion/ui/
stats/env-debugging/kernel-pitfalls + README 索引 + legacy 归档），根文件只留
协作约定/横切约束/数据演进守则/索引。提交 170415e 双远端。同批清理：空文件
cd、siyuan-01.png、.playwright-mcp/、.audit/ 删除；.dsh/.workbuddy/.zcode 旧
agent 记忆归档进 legacy/ 后删除并移出 .gitignore。改域前先读对应模块文件成新惯例。
