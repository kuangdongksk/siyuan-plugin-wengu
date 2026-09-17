---
name: feedback-storage-layout-from-code
description: 查「某数据存哪」先读代码定位 saveData/数据源，别在存储 JSON 里瞎摸（2026-09-12 用户连番纠正）
metadata:
    node_type: memory
    type: feedback
    originSessionId: sess_d169247f-5f10-46c8-bf8a-67217b560e33
---

2026-09-12 排查「张宇概率索引噪音」时连被用户纠正三连：不知道存哪 → 给了存储路径还乱翻 → 「什么数据存在哪个文件代码里有」。最终靠读 `KnowledgeLink.ts` 才理清数据源分叉。

**Why:** 本插件数据源分三路，不看代码必然猜错：① saveData 持久店（bank/know-hash/know-synonyms/ai-sessions…，键名代码里写死）；② 实时查内核（知识面板小节树 `headingsByRoot` 现查文档 h1~h6 标题块，无 AI 树的章节整棵树都在思源文档里，插件不存）；③ 并流点 `treeHeads`——有 AI 树（bank.knowTrees[srcId]）则整体替换文档小节。另：3.8.2 内核 SQL 参数是 `stmt` 不是 `sql`。

**How to apply:** 「XX 数据在哪」一律先 `grep saveData/关键模块` 读代码定位数据源与键名，再读文件；面板显示 ≠ 插件存储，先分清是哪路。存储文件在 `data/storage/petal/siyuan-plugin-wengu/<key>`。相关：[[wengu-cnb-cli-credential]]
