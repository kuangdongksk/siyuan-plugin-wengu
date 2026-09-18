---
name: ai-concurrency-write-audit
description: 20260914 多 AI 并发落盘审计——死锁不可能（并行只在 AI
    层/各店串行落盘链/单飞闸+内核原子写）；QuestionBank 是唯一无链店（小丢更新窗口，补链修复待拍板）
metadata:
    node_type: memory
    type: project
    originSessionId: sess_21f5ca61-5129-49c7-8938-6e114cf78c7a
---

20260914 用户问「多 AI 并发会不会同时读写一个文件造成死锁」——全仓落盘通道审计定论：**死锁结构上不可能**（并行只在 AI 调用层，落盘全串行）。

三层机制：

1. **并行不落盘**：转换 1~4 并行分片只并行 AI 调用，落库经片序闸门
   （SetWriter `await gate[i-1]` 连续前缀）串行，落盘只走 `markDirty()`
   （置脏+2s 防抖）→ 每店单一 flush；多 AI 流对 bank 的修改=单线程
   JS 下共享内存缓存原地变更，天然互斥。
2. **串行落盘链**：除题库外每店显式 `chain.then(() => saveRaw(snap))`，
   快照入队时克隆（AiSessions/ChatStore/HistoryStore/WordStore/
   RouteCache/KnowSynonyms/KnowHash/KnowIndex；AiSessions.ts:151 注释
   明言动机=「并发 saveData 互吞」）。链 fire-and-forget（调用方不
   await 链尾）⇒ 无重入自锁；链面吞错 ⇒ 前笔失败不断链。最坏=
   saveRaw 挂住 → 落盘延迟堆积、业务不阻塞，不是死锁。
3. **外围两道闸**：重型批流全局单飞闸 `aiFlowBegin`/`flowBusy`
   （src/ai/client.ts:52，真机 fetchSyncPost 内核写流并发互吞坑的
   防线）；内核 saveData 原子写（tmp+rename），并发到达=后到者赢，
   不损坏文件、不互等。

**唯一弱点（非死锁）**：`QuestionBank.flush`
（src/bank/data/QuestionBank.ts:231）是唯一无串行链的店——在途
saveRaw 期间又 markDirty ⇒ 2s 定时器触发第二笔并发 saveData("bank")。
后果上限=旧快照后落盘、文件短暂回退旧态；内存缓存始终权威、下次
flush 补齐；仅进程恰崩在窗口内才丢末笔（index.ts:367 卸载兜底 flush
收窄）。

已答复用户并提议把同款 ~10 行串行链搬进 QuestionBank 封死窗口
（走 Issue 派 NPC），**待用户回应**。

真正的「两写入方同碰一个文件」来自两机思源同步，已由版本闩（foreign
停写）挡住，见 [[storage-arch-ial-vs-bank]]。

**How to apply:** 用户回「补吧」时：修法=把 chain 模式复制进
QuestionBank.flush（快照语义注意 bank 是共享缓存引用、需浅拷贝或接受
写时序列化）；新持久化存储上线必须带串行链，与 AGENTS.md 版本闩惯例
同列为标配。再答并发/落盘安全问题直接引本审计结论，不必重查。
