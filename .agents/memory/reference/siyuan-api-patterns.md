---
name: siyuan-api-patterns
description: 已核实的思源 API 用法：attributes 表与 SQL 聚合、attr API、Protyle 取当前文档 id
metadata:
    node_type: memory
    type: reference
    originSessionId: sess_3bdb5d2e-1541-4791-98ce-e871f3905338
---

2026-08-21 对照 `node_modules/siyuan/*.d.ts` 与 sy-lively 源码核实的模式：

- 块自定义属性存内核 `attributes` 表，属性名统一 `custom-plugin-<name>-*` 前缀；思源属性视图可直接读此类列出统计，无需外部存储；
- 批量查题：`/api/query/sql` + `GROUP_CONCAT` 聚合 attributes 表（sy-lively CardQueryService 同款写法）；blocks 表主键是 `b.id`（不是 block_id），所属文档列是 `b.root_id`；
- 单块属性读写：`/api/attr/getBlockAttrs`、`/api/attr/setBlockAttrs`（`fetchSyncPost` 封装，参考 sy-lively constant/API路径.ts）；
- 前端取当前文档 id：`getActiveEditor()` 返回 `Protyle` 类，字段是 `.protyle.block.rootID`（当前块 id 是 `.protyle.block.id`），IProtyle 接口在 `types/protyle.d.ts`；
- 判分/闪卡相关：内核操作枚举 `addFlashcards`/`updateAttrViewCell` 等在 `siyuan.d.ts` TOperation 中可见；
- **AI 接口是单向的（AI→插件），插件不能直接调用思源内置 AI**：前端 `Plugin.addAgentCapability(options)`（`siyuan.d.ts:570`）/ 内核 `siyuan.agent.registerCapability(name, config, handler)`（`kernel.d.ts:612`）是插件把自己操作注册为 AI 的能力供 AI 调用；插件发起 AI 对话或转换的 API 不存在，全包无 `/api/ai`、`/api/chat`、`/api/agent` 端点。转换需用户在思源内置 AI 界面手动触发。
- 取容器块全文（含子块，LaTeX 原样）用于页签展示：`/api/block/getBlockKramdown` 传 `{id}` 返回 kramdown 字符串（`fetchSyncPost`）。
- 2026-08-21 **新页签渲染/解析原文（在真实运行中的思源上实测确认）**：
    - **Lute.Md2BlockDOM 不是静态方法**，要先 `Lute.New()` 建实例再调实例方法（`types/protyle.d.ts:594` 有静态 `New()`，实例 `Md2BlockDOM(md)` 在 :694）。渲染前建议 `lute.SetKramdownIAL(true)`/`SetSanitize(true)`。
    - **公式不会自动渲染**：Lute 输出的是含 `$...$` 的块 DOM，须再调 `ProtyleMethod.mathRender(element)`；代码高亮调 `ProtyleMethod.highlightRender(element)`（都是 static，from "siyuan"）。二者在 `types/protyle.d.ts:372/365`。
    - 取子块序列：`/api/block/getChildBlocks {id, length}` 返回 `data[].{id, type, content(纯文本), markdown(kramdown源码)}` —— `markdown` 才是渲染原料，供 Lute。
    - 测试用 API token 在 `工作/conf/conf.json` 的 `api.token`，可用 curl `Authorization: Token <token>` 直连 `127.0.0.1:6806` 内核实测（kernel 默认端口 6806，`lsof -iTCP:6806`）。外部 API 文档不可信（docs.siyuan-note.club 是域名停放页）。

**How to apply:** 新功能涉及块属性、文档定位、SQL 扫描时先翻这里，避免再踩列名/字段路径错误。

2026-08-25 对照 3.8.1 真机 stage `base.*.css` 核实的弹窗行为（转换配置弹窗超长不滚动的根因）：

- `.b3-dialog__content` 自带 `padding:16px 24px; flex:1; overflow:auto`，**但 `.b3-dialog__container` 没有 max-height**——弹窗随内容无限长高撑出视口，overflow 永远不触发。
- 插件侧修法：内容区 div 封顶 `max-height: calc(100vh - 200px)`（本项目共享类 `.wengu-dialog`，见 [[ui-consistency-feedback]]）；`b3-dialog__action` 是 content 的同级兄弟节点，在 flex 列容器里天然常驻底部。
- 新建 `Dialog` 时别只依赖思源默认滚动，长内容必须自带限高。

2026-08-25 查文档题目块实况时的坑（英语样卷核查）：

- **`/api/export/exportMdContent` 会丢自定义块属性**（`custom-plugin-wengu-*` IAL 全部不出现，属性统计全空）——核实题目容器/属性要用 `/api/block/getBlockKramdown` 逐块查；其返回 `data` 是 `{id, kramdown}` 对象不是字符串（`.data.kramdown` 才是原文）。
- 找文档里的题目超级块：SQL `type='s' AND root_id='<docId>'` 列出容器块 id，再逐块 getBlockKramdown 看 IAL。

2026-08-25 对照 3.8.1 stage `base.*.css` 核实的**有序列表序号 DOM**（选项 1234→ABCD 改造）：

- 序号不是 CSS `list-style`，而是 `.li > .protyle-action` 里的 **marker 文本**；`.li[data-subtype="o"]` 有序 / `"u"` 无序，`.list` 是列表容器。
- `.protyle-action` 自身是 `position:absolute; width:34px` 的 flex 居中盒，`height:calc(1.625em + 8px)`（**em 基于自身 font-size——font-size:0 会让盒子塌成 8px，别用**）。
- 字母化方案（本项目 cards.scss）：`.list` counter-reset + `li[data-subtype=o]` counter-increment，`.protyle-action` 原数字 `color:transparent`（布局保留），`::before` 用 `content: counter(x, upper-latin) "."` + `position:absolute; inset:0` 居中覆盖。

2026-08-21 自定义页签（替代 dock）——用户拍板前端不新开 dock，改为顶栏按钮 + 自定义页签，页签内容插件自渲染：

- 注册：`addTab({type, init, update, destroy})`；打开：`openTab({app, custom:{icon, title, id: plugin.name + type}})`，`custom.id` 由 `plugin.name + addTab 的 type` 拼接（sy-lively `demo.ts`/`index.tsx` 同款）。
- **`addTab` 回调里的 `this` 是 Custom/MobileCustom 实例，拿不到插件实例** → 用静态单例缓存（如 `WenguPlugin.instance`）存 i18n，供回调取文案。ESLint 的 `no-this-alias` 规则会拦 `const plugin = this`，别再写别名。
- dock 用 `addDock` 仍可行，但本项目已弃用（用户明确不要 dock）。

2026-08-26 AI 通道超时语义（转换批次被 5 分钟总时长误杀的修正）：

- `/api/ai/agent/chat` SSE 单批生成可合法超过 5 分钟——客户端超时须按**空闲**计（每收到一段流数据即重置计时器），不能按总时长掐；温故 AgentClient.agentChat 已按此实现。
- `/api/ai/chatGPT` 直答非流式、响应一次性整段返回，只能按总时长超时（温故取 10 分钟，ConvertService.AI_CONCURRENT_TIMEOUT_MS）。

2026-08-31 智能体会话条目与续聊形态（stage `common.*.js` 经 tr 分行后 grep 核实，AI 会话面板落地时）：

- saveSession 的 entries 条目 `type` 是 `"user"` / `"assistant"`（另有内部 snapshot/confirm 类型）；**续聊=把完整条目列表（含 assistant）连同新 user 条目一起 saveSession 再 chat**，回放条目即完整上下文——温故 agentChatContinued 同款。
- 前端 saveSession 实际 body 远比插件丰富（title/titled/contextTokens/createdAt/updatedAt/messageHistory/model/permissionMode/commitTurnID），但极简 `{id, revision:0, title, entries}` 已真机可用；不对齐内核 revision/commitTurn 就别复用旧 sessionID 续聊，直接播种新会话。
- 智能体前端实现在 stage/build/app/ 的 common.*.js（压缩单行，先 `tr ';{' '\n\n'` 分行再 grep saveSession/commitTurnID）。

2026-09-02 机器 B 内核实测：`/api/query/sql` 的 body 字段是 **`stmt` 不是 `sql`**——传 `{"sql":...}` 报 `{"code":-1,"msg":"Field [stmt] is required"}`，换 `{"stmt":"SELECT ..."}` 即通。curl 直连调试 SQL 时注意（插件内 KernelQuery 封装不受影响）。

**How to apply:** 新功能涉及块属性、文档定位、SQL 扫描时先翻这里，避免再踩列名/字段路径错误。
