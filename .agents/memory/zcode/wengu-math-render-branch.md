---
name: wengu-math-render-branch
description: 公式裸 $ 修复分支——已并入 dev 并清理 worktree（2026-08-25 全合流）
metadata:
    node_type: memory
    type: project
    originSessionId: sess_2e656ce9-8e3c-41c2-815f-019e9ba56078
---

wengu/math-render 分支（2026-08-25）：修复刷题界面公式显裸 `$...$`。
根因：插件加载器给 `"siyuan"` 模块注入的固定对象不含 Lute，`import { Lute } from "siyuan"`
得 undefined；修复=改用 `window.Lute`。顺手修 3.8.1 putFile 路由迁移
（/api/file/putFile+相对路径）。真机探针 katex_rendered=true 验收通过，
**已并入 dev（5b48335）并清理 worktree/分支**——本条仅存档根因结论。
机器 A 思源 3.8.1 运行进程在 `C:\Program Files\WindowsApps\89C2A984.SiYuan_3.8.1.0_x64__*\`，
D:\program\SiYuan 是旧 3.7.3（其 stage 的 lute.min.js 可在 Node 里独立复现 Lute 行为）。
相关：[[wengu-kernel-extra-traps]]
