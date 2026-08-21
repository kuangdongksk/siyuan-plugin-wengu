# AGENTS.md — 温故插件开发与调试备忘

给 AI 编码代理的项目说明。**调试环境按机器区分**，两台机器各自一节，
在别的机器上先确认本节路径/端口/token 再动手，并回填缺失信息。

## 项目速览

* SiYuan 插件「温故（wengu）」：笔记文档 → AI 转习题 → 页签刷题。
* 源码 `src/`（入口 `src/index.ts`，模块在 `src/wengu/`，样式 `src/scss/` 分片）。
* **硬性约束：仓库内单文件 ≤500 行**；界面规范见 `docs/design-review.md §〇`
  （图标用 `FormHtml.svgIcon` 禁 emoji；表单统一 FormHtml 行样式）。
* 改行为必须同步 `docs/question-block-contract.md`。

## 通用调试流程（两台机器一致）

1. `npx tsc --noEmit && npx eslint src --ext .ts && npx dprint fmt && npm run build`
2. 安装：把 `dist/index.js`、`dist/index.css`、`src/i18n/{zh-CN,en}.json`
   复制到**本机工作区的插件目录**（见下）——i18n 忘拷会显示原始键名
   （看起来像「英文」）。
3. 重载前端：`POST /api/petal/setPetalEnabled`
   `{"frontend":"desktop","packageName":"siyuan-plugin-wengu","enabled":false}`
   → sleep 1s → 同体 `enabled:true`。之后让用户**重开温故页签**验证。
4. 验证安装：在装好的 `index.js` 里 grep 特征串；注意 minify 会把中文
   转成 `\uXXXX`，grep 原文中文可能查不到（用英文标识符/属性名查）。

## 机器 A（本机，Windows + Git Bash，已验证）

* 思源 3.8.0 桌面版，工作区 `D:\data\思源\工作`
* 内核 API：`http://127.0.0.1:6806`，`Authorization: Token gm8mhokhgd58ceaf`
  （token 变了去工作区 `conf.json` 里找 `api.token`）
* 插件安装目录：`D:/data/思源/工作/data/plugins/siyuan-plugin-wengu/`
* 思源前端源码（读实现用）：`C:\Program Files\WindowsApps\
  89C2A984.SiYuan_3.8.0.0_x64__1qfd3tsw4ngc2\app\resources\stage\build\app\`
  （`common.*.js` 是压缩单行，**直接 grep 会卡死 shell**，先
  `tr ';{' '\n\n'` 分行再 grep）

## 机器 B（待回填：路径 / 端口 / token / 思源版本）

> 在机器 B 上第一次调试时：确认 `conf.json` 位置与 token、插件目录、
> 思源版本，回填到这一节。

## 内核坑（3.8.0 真机实测，两台机器通用）

* **fetchSyncPost 必须串行**：并发调用互相吞响应挂起（12 题卡「加载中」
  的根因）。逐题/逐卡请求都要 await 串行。
* **内核 attributes 索引有数秒延迟**：新建文档立刻查 SQL 查不到，
  轮询（1s 间隔，15s 超时）。
* 未知路由返回 **200 + 空 body**，不能用状态码判断端点存在。
* 闪卡 API 是 `/api/transactions`（复数）+ `{reqId: 数字, transactions:
  [{doOperations:[…]}]}`；旧 `/api/riff/addFlashcards` 等已不存在。
* `insertBlock/appendBlock` 在 3.8.0 不可用，写 kramdown 用
  `/api/filetree/createDocWithMd`；改块内容用 `/api/block/updateBlock`
  （markdown 里带 `{: id="…" 属性}` 可保留 IAL）。
* 内置智能体：`/api/ai/agent/chat` SSE，body `{message, language,
  references:[], model?}`，model=设置里模型 id；`event:content` 的
  `data.token` 是回答增量，`event:error` 报错。
* Lute：自建实例必须 `SetInlineMath(true)`（编辑器默认关行级公式，
  否则 `$...$` 原样输出）；内嵌 Protyle 必须**逐卡串行挂载**（并发
  getDoc 挂起）。

## Shell/工具坑（本机）

* Git Bash 里转义会悄悄破坏 JSON payload——**精确 payload 用文件**
  （Write 工具写临时文件再 `curl -d @file`），别在命令行内联 JSON。
* `python` 是 WindowsApps 桩，用 `node -e` 做解析。
* 重 grep minified bundle 会卡死（见机器 A 节的 tr 分行法）。
