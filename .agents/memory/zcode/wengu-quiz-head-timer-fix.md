---
name: wengu-quiz-head-timer-fix
description: 刷题头部吸顶+计时不再累计后台墙钟已提交(721d088)；20260830 补修吸顶头z-index盖官方弹窗——isolation:isolate收口视图根已部署待验收
metadata:
  node_type: memory
  type: project
  originSessionId: sess_d8648257-4f3d-4eb9-b920-684a5a6bfd41
---

2026-08-27 晚刷题页签两修（721d088，已部署机器 A + petal 重载，待用户验收）：

- **头部统计行吸顶**（用户口令「这个应当固定」）：`.wengu-head` sticky，负
  margin 抵消 `.wengu-main` 8px padding + 自带同额内衬（未吸顶布局不变）；
  题号栏 `top: var(--wengu-head-h)` 让位，NumRail 每次渲染实测头部高度写入；
  复习模式容器（wengu-review-main）不滚动无 padding，选择器 `:not()` 排除。
- **计时不进后台墙钟**（用户「每次打开都三十几分钟」）：根因是开轮后
  `started` 为真就每秒 tick，从不检查页签可见——切走思源页签（fn__none）
  /最小化窗口照样累计。修为 tick 前查 `document.hidden` +
  `getClientRects().length===0` 即暂停。契约文档计时条目已同步。

**2026-08-30 追修：吸顶头盖住官方弹窗（用户报「这个比官方的弹窗都高了，
是 zindex」）**。根因（读 3.8.1 stage 源码定论）：官方 `.b3-dialog`/`.b3-menu`
本体都是 `position:fixed` 且 **z-index:auto**，靠挂 body 末尾的 DOM 顺序盖
页面；插件页签根到 body 之间无层叠上下文祖先，头部 `z-index:20`（正値）在
根上下文直接压过全部 z-auto 官方浮层——伴学 15/词书菜单 220/english 1000
同病。修法：`.wengu-panel`（刷题页签根，base.scss）与
`.wengu-word-root`（单词 dock 根，words.scss）各加 `isolation: isolate`——
内部 z 顺序原样保留、官方浮层永远在上；isolation 不像 transform 会绑架
position:fixed 后代的包含块，是安全收口位。已部署两工作区+petal 重载
（仅测试区内核 52036 在跑），**未提交**（树上还有并行会话未提交件）。
验证法：刷题页开任意官方弹窗（如设置），吸顶头不得浮在弹窗上。

**未完事项**：① push 五连败（Recv failure / 443 连不上）后放弃，本地 dev
ahead 1 待补推——直连失败符合 [[machine-a-git-proxy]]（Clash 代理按需开关，
本轮先成后败即用户关了代理），下轮 push 失败先想代理；② 用户文档已落库的
虚增 total-time（如 35:34）**不会自动缩**，「清零重计」入口已向用户提议、
未表态前不做；③ 验收方式：开一轮后切走页签几分钟，计时应只走可见期秒数。

相关：[[project-parallel-sessions]]（同晚「剩」修复 cfd7193 已推上）
