## 内核坑（3.8.0 真机实测，两台机器通用）

- **fetchSyncPost 必须串行**：并发调用互相吞响应挂起（12 题卡「加载中」
  的根因）。逐题/逐卡请求都要 await 串行。
- **内核 attributes 索引有数秒延迟**：新建文档立刻查 SQL 查不到，
  轮询（1s 间隔，15s 超时）。
- 未知路由返回 **200 + 空 body**，不能用状态码判断端点存在。
- 闪卡 API 是 `/api/transactions`（复数）+ `{reqId: 数字, transactions:
[{doOperations:[…]}]}`；旧 `/api/riff/addFlashcards` 等已不存在。
- `insertBlock/appendBlock` 在 3.8.0 不可用，写 kramdown 用
  `/api/filetree/createDocWithMd`；改块内容用 `/api/block/updateBlock`
  （markdown 里带 `{: id="…" 属性}` 可保留 IAL）。
- **「向已有文档追加内容」通道（20260826 在 3.8.1 八轮真机探针定论，
  修正 20260822 旧结论——旧探针的锚点误用了文档根块）**：
    - **`/api/block/appendBlock`（markdown dataType）+ `parentID=文档id`
      可用**——sy-lively 同款方式：一次**追加单块**到文档末尾，串行逐块
      即可增量成文；**IAL 独立成行则块属性直接落盘**（超级块容器 IAL
      同理，属性表 ~2s 可查），无需 setBlockAttrs 补。温故渐进落盘已改走
      此通道（KernelBlock.append / ConvertService.appendBlockToDoc）。
    - `/api/block/insertBlock`（previousID 锚定）同样可用，但**锚点必须是
      真实子块**——previousID 传文档根块（type='d'）会**假成功**：code 0
      且回显 doOperations，内容根本不落盘（两轮探针假阴性的根因）。
    - **一次只能一块**：单次调用传多块 markdown 会散落错位（首块进锚点、
      其余乱序落尾）；IAL 写在行内会变成正文，必须独立成行。
    - **kramdown 读回形态（20260829 题库踩坑）**：getBlockKramdown/
      落盘读回时，列表项首段子块的 IAL 是**行内尾随**（`- {: id="…"
updated="…"}A. …`）、条目自身 IAL 缩进独立成行、块引用子块 IAL
      带 `>` 前缀——按行解析 kramdown 时必须清理这些残渣（siyuan/kramdown.ts
      的 stripIal/IAL_LINE/IAL_INLINE），否则渲染成字面属性文本。
    - `/api/transactions` + DOM 数据（前端同款）也可用（多顶层块、超级块
      完整落盘），但 **`data-custom-*` 被内核剥离**且 `data-node-id` 可能
      被重生成——不如 markdown 通道，留作后备。
    - `updateBlock` 仍不可用：文档根传多块 → 并成**一个段落**；普通子块传
      多块 → **只保留第一段**（危险）。

- **putFile 不吃 JSON**：上传文件必须 multipart（path/isDir/file），
  fetch + `window.siyuan.config.api.token` 鉴权（见 `siyuan/files.ts`
  kernelWriteText）。
  **3.8.1 路由迁移**：端点变为 `POST /api/file/putFile`（旧 `/api/putFile`
  返回 200+空 body 假成功），且 path 必须工作区相对（带前导 `/` 会拼出
  `…\C::` 非法路径报 mkdir 错）（20260825 真机实测）。
- **saveData 拒绝路径抛裸对象 + 生命周期闸（3.8.2 前端源码定论，
  20260903）**：`Plugin.saveData/loadData/removeData` 失败时
  `Promise.reject({code,msg,data})`（非 Error）——`String(e)` 直出
  「[object Object]」，展示用错误一律走 `ui/shared errText`。拒绝只有
  三类客户端来源（`fetchPost` 回调形态内核出错也 resolve，内核侧失败
  不会 reject）：① code 410「Plugin lifecycle has ended」——**3.8.2
  新增生命周期闸**，实例被 dispose（petal 重载/页签销毁与 2s 防抖
  markDirty 的竞态）后永久拒绝，防抖重排撞上必须停手
  （`isLifecycleGone`），否则僵尸循环每冷却期弹一次错（20260903
  题库落盘失败真机踩坑，且当时正常实例落库无恙——toast 全来自旧
  实例残骸）。**20260904 收口：410 属旧实例残骸的预期失败，连通知
  也一并静默**（QuestionBank/AiSessions 的 flush 都先 `isLifecycleGone`
  再弹）；fire-and-forget 的 `void save()` 一律链尾 `.catch`——try/catch
  接不住异步 reject，漏出去是控制台未捕获拒绝刷屏（savePrefs/settings
  踩过）；② code 403 全局只读/发布模式（用户可解，重试合法）；
  ③ code 400 数据 JSON 序列化失败（循环引用等）。
- 内置智能体 `/api/ai/agent/chat`（SSE）：**并发锁按 sessionID 键控
  （`runningSessions map[string]*runningSession`，非全局锁），不同
  sessionID 可并发、且每次可指定 `model`——即「并发 + 每场景指定模型」
  两个诉求一个接口全满足**（20260827 在 3.8.1 两轮真机验证：两个不同
  sessionID 并发请求均 `event:done` 零 busy；传假 model id 被拒
  「请先参考用户指南进行配置」证明 model 生效）。
    - **消息里的 `![](assets/…)` 会被抠成图片附件（20260903 MiniMax 2013
      真机踩坑）**：内核 `AgentMessageImageAssets` 用 Lute 解析 user 消息，
      把 assets/ 开头的图片抠出来 base64 附给供应商，`image_url.detail`
      无显式值一律 `"auto"`（kernel/agent/attachments.go
      buildAttachmentMessage），且单请求最多 4 张/20MB、超出静默丢。
      供应商 schema 不认 auto 时（MiniMax 只收 low/default/high，报
      「网络异常，请稍后再试: invalid params, invalid image detail: auto
      (2013)」）整批必挂——带图批次全灭、纯文本批次全活。内核的
      isImageInputUnsupportedError 降级白名单不匹配这类措辞，不会自动
      重试纯文本。**插件对策：`ai/PromptHygiene` 在发送口（client 两条
      公开通道）把图片行统一换成 `〔插图:路径〕`占位符（Lute 解析不出
      图片节点），`QuestionDraft.cleanPartText` 兜底还原——落盘 kramdown
      与旧产物逐字同构**。往 agent chat 发文档 kramdown 的新通道都必须
      过这层消毒（20260903 已用内核探针双验证：真图片行=2013 复现、
      占位符=正常出字）。
    - **老结论「并发互斥」是假象**：20260823 验证时没传 sessionID，
      所有请求都撞在 `runningSessions[""]` 这一个 key 上 → 全局互斥。
    - 调用前置（缺一即 409/「网络异常」假象）：
        1. `sessionID` 必须是合法格式 `{14位时间戳}-{7位字母数字}`
           （isValidSessionID 校验，如 `20260827063055-fk64l1s`；乱传
           直接 `load agent session permission failed: invalid session id`）；
        2. session 必须先落盘：`POST /api/ai/agent/saveSession` body
           `{id, revision, title, entries:[{id, type:"user", content}]}`
           ——**entries 至少一条 `type:"user"` 条目**，否则 chat 报
           `begin agent runtime failed: agent runtime user entry not found`
           （前端逻辑：先 push user 条目→saveSession→再 chat）；
        3. chat body `{sessionID, userEntryID: <user 条目 id 或空串>,
message, language, references, model?}`；`userEntryID` 是
           **entries 里 user 条目的 id**（非文档 ID），空串=取最后一条
           user 条目；`model` = `conf.json ai.providers[].models[].id`。
    - **model id 是内核生成的时戳格式**（如 `20260824211456-z5lcgdq`，
      3.8.1 实测）：删改 AI 配置后存量 id 永久失效，内核对未知 id
      一律报「请先参考用户指南 [人工智能] 章节进行配置」——调用侧
      一律走 `ai/models.resolveModelId`（agentChat 入口已总闸：失效
      回落默认、默认无效省略 model），别把用户存量选择直送内核
      （20260829 学伴档案存已删模型踩坑）。
    - 流结束 SSE 出 `event:turn`（带 turnID）；前端随后调 saveSession
      `{...session, commitTurnID: turnID}` 提交；插件任务结束不保留
      上下文就调 `POST /api/ai/agent/removeSession {id}` 清理，否则
      每个随机 sessionID 会在 `data/storage/ai/agent/sessions/{id}/`
      落盘两个文件堆积。agent chat 可能触发工具权限
      `event:permission`/`event:confirm`（approvalPolicy=risk 时），
      插件纯文本问答通常不触发，需自测。

- 旧直答端点 `/api/ai/chatGPT`（`{msg}` → `{code,data:回复全文}`）
  支持并发（真机验证），模型跟随设置默认、不可按次指定——**插件侧
  已于 20260830 弃用**（并发统一走 agent/chat 独立 sessionID，顺带
  修掉并行转换忽略用户选模型的暗病），内核行为仅备查。conf.json 里
  providers 的 apiKey 是**内核加密
  密文**（hex，长 224/512），插件拿不到明文、无法绕开内核直连供应商。
- 插件 addDock 的 config **必须带 position 与 size**：缺 position 会在
  内核 dock 布局初始化里 `.startsWith` undefined 直接崩，且是 onload 级
  崩溃（整个插件不可用，20260823 真机踩坑）。
- **SQL API 无 LIMIT 静默截断 64 行**（20260823 真机验证）：
  `/api/query/sql` 不带 LIMIT 最多返回 64 行且 code=0 无异常（书架
  94 篇文档只回 64 篇的假象）；子查询不支持（返回空）。批量/
  全量查询必须显式 `LIMIT n OFFSET k` 分页（工厂 `KernelQuery.rowsAll`）。
- **SQL `ORDER BY sort` 不是文档序**（20260907 真机验证）：导入语料
  （MinerU 等）块 sort/created 全退化——实测 23/23 章节全部标题块
  sort 同值、created 整秒并列，SQLite 对并列序返回**任意序且时好时坏**
  （随查询计划漂移）：知识面板小节树「五、二、一」乱序、子标题先于
  父标题到达就近挂靠直接沉顶层（层级塌平）；`created` 与
  `/api/outline/getDocOutline` 都不可靠（后者只回两层、h5 丢）。
  **文档序唯一权威来源=根块 kramdown 里 IAL `id="…"` 的出现序**——
  `KernelBlock.docOrder`（siyuan/block.ts，按文档 updated 缓存）+
  `byDocOrder` 回排帮手；读块顺序的代码一律过这层，别再信 ORDER BY
  sort（消费点：KnowIndex.headingsByRoot/docBlocks/sectionKramdown/
  docSectionHashes）。
- Lute：**只能用全局 `window.Lute`**——插件加载器给 `"siyuan"` 模块
  注入的固定对象里没有 Lute（3.8.1 加载器实测：window.eval 包合成
  require，模块表只有 fetch*/Protyle/ProtyleMethod/Dialog 等；
  **showMessage/hideMessage 在表内**（3.8.2 common.js 实测），
  `import { showMessage } from "siyuan"` 可用——ui/Notify.ts 即此路），
  `import { Lute } from "siyuan"` 得 undefined，`New()` 抛异常被
  safeLute 吞掉→整体退 `<pre>` 纯文本，公式显成裸 `$...$`
  （20260825 踩坑，ProtyleHost.luteToHtml）。自建实例还必须
  `SetInlineMath(true)`（编辑器默认关行级公式，否则 `$...$` 原样
  输出）；内嵌 Protyle 必须**逐卡串行挂载**（并发 getDoc 挂起）。
  `Md2BlockDOM` 段落输出形态（3.8.1 lute.min.js 在 node 沙箱探针实测，
  20260829）——正文藏在 contenteditable 壳里、尾部还拖 protyle-attr：

      <div … class="p"><div contenteditable="true">正文</div><div class="protyle-attr">…</div></div>

    要取内联内容剥壳得按这个形态（ProtyleHost.unwrapSingleBlock），
    朴素取 innerHTML 会把块级壳漏进去。

## 外部 API：无（MinerU/PDF 导入 20260901 移除）

- PDF 导入的中间产物文档无处安放（20260903 起转换零落盘，题库才是
  内容真相），MinerU 管线失去意义——PdfImport/MinerUClient/PdfImportRow
  三文件与 settings.mineruToken、fflate 依赖、EApi.ForwardProxy 一并
  删除（20260901 首删时的动因是「另存文档永久留文档树」，pivot 后
  更彻底）。若将来重接外部 JSON API，内核 `/api/network/forwardProxy`
  `{url, method, headers, payload?, timeout}`（上游响应在 `data.body`）
  仍可用，但 payload 只收 **string，二进制过不去**（20260823 真机验证）。
