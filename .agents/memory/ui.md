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

- **Dialog 动作变体与宽度档**（Issue #137，20260915）：`WenguDialogAction.variant`
  放宽为与 `ButtonVariant` 同源的四档（`primary`/`outline`/`text`/`cancel`），
  映射收口在 `ui/Dialog.actionClsOf`（`primary`＝裸 `b3-button`，**缺省
  `cancel`** = 最不可能违规的档，同 Button 的默认值口径）。**位序即语义**：
  右起第一钮＝唯一主操作（规范 §2.2），调用方按「次钮在前、主钮在后」书写数组。
  同时 `width` 接受档名 `sm|md|lg`（480/560/680）→ `min(档位, calc(100vw - 32px))`，
  裸 px 原样透传（`SettingsDialog` 的 780px 与两个 Svelte 宿主壳保留字面值）。
  `wenguDialogCls` 常量是「手写壳类名串」的同源落点；`dialogIconHtml(id)` 出
  弹窗图标位（38×38 / 圆角 10 / primary-lightest 底，样式在 `base.scss`
  的 `.wengu-dialog .wengu-dialog-ico`——类名由 TS 拼串产出，故留共享片）。
  ⚠️ **改 `base.scss` 的 `.wengu-dialog*` 记得同步 Svelte 宿主壳**（§5.1 已知重复）。
