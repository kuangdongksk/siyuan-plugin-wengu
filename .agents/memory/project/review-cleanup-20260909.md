---
name: review-cleanup-20260909
description: 20260909 全仓审查修复：死代码根除+Armed/debounce/openWenguDialog/mintTsId 底座收口，已提交(f18c916/1c62857)已装机
metadata:
    node_type: memory
    type: project
    originSessionId: sess_ed5fb6d5-d09e-406f-9030-28202f0040e7
---

2026-09-09 全仓审查（UI 抽离/公共底座/死代码）后的修复：**已拆两笔提交（f18c916=并行会话的路由② R2 归属、1c62857=本会话清理），装机探针全过、petal 已重载，真机验证待做**。全链校验绿（tsc/check:svelte/eslint/prettier/vitest 480/build）。提交拆分手法：换出 3 个共享文件里我的 hunk→先提对方→换回→再提自己，全树 md5 快照对账前后一致。

- 新底座：`ui/shared.Armed`（两击确认 7 槽 5 面板收编）、`ui/shared.debounce`、`ui/Dialog.openWenguDialog`（10 处字符串弹窗壳）、`types.mintTsId/mintPrefixedId`（id 铸造收口，格式逐字保持）、`siyuan/kramdown.ts`（stripIal 自 BankParse 上移）。
- 审查教训（误报两则）：i18n `type*` 键簇经 `CardParts.typeKey` 动态拼接**是活的**；`.wengu-clue-*`/`.wengu-status-ok` 等 CSS 类经 `wengu-clue-${v.clue}`/`wengu-status-${kind}` 动态构造**是活的**——死键/死选择器删前必须先扫动态拼接。
- `driftDocs`/`knowHidden` 字段保留不删：注释明示「按数据演进守则保留兼容存量」，是既定决策。
- 遗留大头：bank/ui 九弹窗迁 Svelte（openWenguDialog 底座已备好）；quiz 壳层字符串与命令式流为有意保留。

**Why:** 底座类名/位置后续会话要直接用；误报教训防止下次审查重复踩。
**How to apply:** 动 bank/ui 弹窗迁移前先看本条；动死代码前先扫 `wengu-*${` 动态拼接。
