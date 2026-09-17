---
name: wengu-option-packed-repair
description: 20260905 选项挤行事件：拆行修复已实现部署测试区，21条损坏数据待用户点「题库体检」执行；含 computer-use 误点游戏教训
metadata:
  node_type: memory
  type: project
  originSessionId: sess_e06130bf-8341-4166-bf4b-e57336133eea
---

20260905 测试区《概率篇-选择-题解》45 题中 21 题「只剩正确选项」：AI 把 4 个选项一行一个塞进同一 `@@P opt`，renderUnit 只给首行编字母、OptionShuffle n<2 跳过洗牌。修复双件已部署测试区（工作区也拷了 dist+i18n，但工作区内核当时未开）：`OptionShuffle.unpackPackedSingle`（生成侧拆行，答案重写 A 再洗牌）+ `bank/data/BankRepair` + 专题工作区「题库体检」入口（RepairDialog，预览即所得）。离线用真实损坏数据验证过 20 可修/1 多选 packed-multi/24 健康。**未提交**。

**遗留**：①测试区 21 条要用户重开温故页签 → 专题工作区 → 「题库体检」→ 勾选修复（多选那条习题614 走题卡重新生成）；②主工作区数据本来就干净；③同一批损坏记录里存的答案字母口径不可信（AI 混用原卷字母/重排字母），修复按「首行=正确项」重写——若用户反馈修复后有判分错，先怀疑该假设。**已提交推送（bd03097，随弹窗去阻塞批合并提交）**，两区已部署。

**Why:** 数据在运行中的插件内存里，离线改 bank 文件会被覆写，必须走 UI 入口执行；且「检测必过目」是插件自身设计原则。

**How to apply:** 遇同类「选项丢失」报告先跑体检入口而不是重转换（增量按 src-hash 判同会跳过）；[[wengu-audit-20260903]] 同批未提交，合并提交时一并卷入。
