# src/ui/ —— Svelte 迁移公共积木 / 样式工具

- FormHtml：行样式/选择器/设置弹窗；`shared.ts` 工具；`mountApp.ts` 挂载帮手 +
  `FormRow.svelte` 表单行。
- **Notify.ts 思源通知帮手**（20260901）：后台任务的静默失败/完成走内核级 showMessage
  浮层——`initNotify(i18n)` 由 index.ts onload 注入、深层模块用 `{key,vars}` 取词，
  错误同文案 60s 冷却防重试风暴；已接 AiSessions/QuestionBank 落盘失败、导入即关联、
  建知识树、转换/增量终态、启动迁移链 catch。
- **弹窗去阻塞**（20260905 用户定夺，七个 AI 弹窗统一口径）：重新生成/匹配/批量关联/
  生成标签/变式重练/薄弱加练/收集补题全部「点击即关窗」——AI 后台跑、调用带 track
  进 AI 会话面板（实时进度）、终态走通知。重型批流走 ai/flow.ts launchAiFlow 单飞闸
  （aiFlowBegin/End，内核写流并发互吞防线）；「停止」迁到 AI 会话面板（client.ts
  中止登记簿 stopBySid：track.onSid 把记录 id 挂回流级句柄，面板 abortAiSession 触发）。
