---
name: wengu-dispatch-20260912
description: 20260912 调度轮——PR#38/#40/#41 全合并（浮条标注+know-index+批量转换）部署两区待验收；定时自动化已挂（每30分钟审查/合并/部署/冒烟）
metadata:
    node_type: memory
    type: project
    originSessionId: sess_78c9ba35-405f-4079-9683-d71d8ad02a8e
---

2026-09-12 调度轮结论（本地只调度口径下的一整圈）：

- **PR [#38](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/pulls/38)**（feat/anno-bar-2e8e，Issue #36 浮条标注改造：查词改标生词不弹卡、长度闸 120→1000、跨节点高亮 `locateAcrossNodes`+`markSlots` 施工序、防御三件套）已审查合并 dev（7a462fb），Issue #36 已关。真机验收点：材料拖选→标为线索出高亮、**同一段标两条线索两处都要有高亮**、标生词直接入生词本。
- **Issue [#37](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/37)**（批量转换）→ **PR [#41](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/pulls/41) 已审查合并（eade976）、Issue 已关**（定时自动化首轮完成）：子文档发现 SubDocs（rowsAll 分页防 64 行截断、hpath 字典序）、ConvertBatchQueue 串行队列（全程占 active 槽）、ConvertRunState 拆分压红线、`ConvertProgressRecord.batch?` 只加不改名（单篇记录形状逐字节不变）。真机验收点：转换弹窗选「肖秀荣1000题-题解版」→ 显示 5 子文档清单 → 面板分篇进度 → 各自成题集；中途停止=当前篇保留/丢弃+剩余取消。
- 构建 dev@eade976 已部署工作+测试两区（md5 一致，产物抽查含 know-index/批量转换/重扫全部特征串）；测试区内核冒烟过（3.8.3、端口动态、petal 重载 enabled=true）。**机器 A 思源已升 3.8.3**（AGENTS.md 写 3.8.1 已过时）；查内核用 `powershell Get-CimInstance`（wmic 已废，双引号内 `$_` 会被 Git Bash 吃掉，用 `Select-Object -ExpandProperty`）。
- **定时自动化已挂**（automation-ab206fb7，每30分钟）：自动对账→审查合并 NPC PR→部署→测试区冒烟；护栏=绝不自动召唤 NPC、不动非自己启动的内核。
- **Issue [#42](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/42)（20260912 晚开，20260913 午修复合并关闭）**：#41 批量转换真机回归——**MinerU 壳文档全带一个空段落块**（肖秀荣/330/660 根+660 三个中间篇均实测），`SubDocs.isEmptyDoc`「有无非 doc 块」判据全判非空 → `rootEmpty` 恒 false → 空壳自动展开永不触发，用户点文件夹直接转根自身报「文档内容为空」（「递归导入还是不支持」的真因）。**递归发现 SQL 本身没问题**（9 篇后代全查出）。
- **PR [#43](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/pulls/43) 已审查合并（dev@ebd3929）**：判空改「有无正文」（TRIM+REPLACE 全空白）、中间层空壳剔除（探针极性命名锁死+按篇聚合，NPC 自己复审出一版极性反+LIMIT 1 的静默缺陷）、`isBlankSource` 源判空加固、**子文档排序改码点序**——复审阻断缺陷：`localeCompare` 落系统 collation，Windows zh-CN 拼音序 vs CI 码点序，队列顺序跨机器漂移（CI 绿≠本机绿，独立目录复跑抓到）；已配 locale 无关性回归锁。851 tests 两机全绿。两区已部署（md5 ab5b3e05）+ petal 重载。**真机验收已过（20260913 用户确认「可以了」）**：660 不勾框→6 叶队列零失败 / 肖秀荣 5 篇回归 / 勾选时壳不入队。本轮教训：①CI 绿≠本机绿——`localeCompare` 随机器 locale 漂移只有 Windows 真机复跑才抓得到，NPC PR 审查必须独立目录复跑四件套；②壳文档判据一律「有无正文」非「有无块」，MinerU 壳全带空段落。

**Why**: 多会话并行时需要知道哪些任务在飞、哪些产物等验收，避免重复召唤 NPC（一次只跑一个）。
**How to apply**: 下次调度先 `cnb pulls list-pulls --state open` + `cnb issues list-issues --state open` 对账；#37 的 PR 到了先审后合。相关：[[wengu-know-index-issue39]]、[[wengu-cnb-cli-credential]]。
