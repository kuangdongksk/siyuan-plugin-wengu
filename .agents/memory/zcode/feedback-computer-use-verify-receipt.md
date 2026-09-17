---
name: feedback-computer-use-verify-receipt
description: computer-use 点屏幕前必须核对 action_receipt 的 resolved_app_ref——用户可能在实时用机（曾误点进全屏游戏）
metadata:
  node_type: memory
  type: feedback
  originSessionId: sess_e06130bf-8341-4166-bf4b-e57336133eea
---

20260905 驱动思源 UI 时，激活思源后一次坐标点击的 dispatch 结果显示 `resolved_app_ref` 是用户正在玩的全屏游戏（Don't Starve Together）——游戏抢回了焦点，截图栅格虽是思源内容，事件却发进了游戏。

**Why:** Windows 前台焦点是竞态的：activate=true 返回 active:true 不代表点击瞬间仍是前台；全屏独占游戏会在截图后、派发前夺回焦点。

**How to apply:** 每次点击后立即看 `resolved_app_ref`/`dispatch_surface` 是否目标应用；不符就停手，不要连续重试。用户正在活跃用机（游戏/打字）时放弃 UI 自动驾驶，把最后一步留给用户手点并写清操作路径。
