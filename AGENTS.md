# AGENTS.md — 温故插件开发与调试备忘

给 AI 编码代理的项目说明。**调试环境按机器区分**，两台机器各自一节，
在别的机器上先确认本节路径/端口/token 再动手，并回填缺失信息。

## 项目速览

- SiYuan 插件「温故（wengu）」：笔记文档 → AI 转习题 → 页签刷题。
- 源码 `src/` **按功能分域**（2026-08-26 重构，组织方式借鉴 sy-lively）：
    - `src/siyuan/`——内核 API 工厂（`api.ts` 路径枚举 EApi + `KernelBlock`
      /`KernelDoc`/`KernelNotebook`/`KernelQuery`（SQL，rows 泛型收窄/
      rowsMap，**rowsAll/rowsMapAll 自动 LIMIT/OFFSET 分页——全量查询
      一律走它，别手写循环**）薄封装，迁自 sy-lively 构建工厂；
      2026-08-26 已把全仓 ~33 处散落内核调用收拢进来，SSE/putFile
      multipart/forwardProxy 三类特殊通道例外（工作区文件读写/删在
      `files.ts`：getFile 裸内容/putFile multipart/removeFile 信封，词书
      等非块文件走它））+ 题目契约属性常量
      `attrs.ts`。新增内核调用先走工厂，别散落 fetchSyncPost。
    - `src/ai/`——**AI 基础设施域**（2026-08-27 从 convert/AgentClient
      抽离，六域共用，无 index.ts 同 siyuan/ 惯例）：`client.ts` **唯一
      对外通道 agentChatOnce**（一次性独立会话：saveSession→chat→
      removeSession，独立 sessionID 天然并发+可按次指定模型；20260830
      起 chatGPT 直答与共享 "" 会话两条路已弃用——agentChat 收为模块
      私有，queue.ts/enqueueAi 整体退役）、`models.ts` 模型
      清单与默认、`timeouts.ts` AI_TIMEOUT 档位（调用点禁自造超时
      数字；超时统一按 SSE 空闲计）、`agentPanel.ts` 智能体面板
      DOM 自动化与「面板优先、页内降级」按钮帮手。
    - `src/quiz/`（做题主流程，`index.ts`=QuizView 编排）、`src/convert/`
      （AI 转换，`index.ts`=转换编排）、`src/review/`（错题复习）、
      `src/word/`（单词域，`index.ts`=mountWordView 挂载编排，控制器
      在 `WordView.ts`，**UI 是 Svelte 组件**（`word/component/`，2026-08-26
      起）：渲染走 $state 深代理细粒度更新，控制器经 context 注入组件；
      Svelte 5 编译器原生支持组件内 `lang="ts"`，无需 svelte-preprocess；
      词库数据在 `word/data/`；**多词书**（2026-08-28 redesign §五）：
      词书=`data/wengu/wordbooks/{id}.json`+manifest（service/WordLib，
      内置书首启动落盘与导入同权），**进度 key=归一化词头**（schema v3，
      同词跨书共享；v2 下标 key 的一次性迁移已随存量确认于 20260829
      移除）、队列
      统计一律当前书口径）、
      `src/stats/`（统计）、`src/bank/`（题库/专题/薄弱；专题标题含
      「/」即目录专题（如 高数/极限/洛必达，normalizeCollectionPath
      规范化、CollectionPanel buildColTree 树形展示）；知识文档
      （KnowledgePanel）：手动导入**递归展开**（KnowRoots 登记 +
      KnowledgeLink.expandKnowDocs 根+全部后代逐行；小节按 h1~h6
      **层级树**展示——20260831 起 headingsByRoot 取 subtype 建
      buildSectionTree 真树，路由 path=祖先标题链，不再是「文档路径/
      本标题」两段假层级）、
      行入口「匹配」（MatchDialog：选已入库习题文档→逐题两级 AI 路由
      →strip+inject 注入引用，KnowRoots.mergeRecordKpRefs 同步题库）
      与「转习题」（QuizView.openConvertPrefilled 预填源=知识点根=
      该文档）；**文本关联/批量关联**（KnowLinkText，20260831）：
      knowledge 标签 ↔ 小节标题归一精确相等即确定性挂引用（零 AI、
      歧义宁漏勿错）——「导入文档」登记后自动跑（导入即关联）、面板
      头部「批量关联」（BatchLinkDialog）= 全根 × 全库，文本优先 +
      可选 AI 路由兜底，落库共用 applyRefsToRecord；**生成标签**
      （TagDialog，20260831）：侧栏文档右键入口，已有标签核对挂引用、
      缺失标签 AI 生成（有知识文档逐题路由按小节标题命名、无则整批
      自由生成），setKnowledgeAttr 写 IAL + applyTagToRecord 落库；
      **标签归一**（KnowledgeNorm，20260831）：knowledge
      文本的 kn 聚合键剥命名性后缀归词干（「洛必达」=「洛必达法则」），
      只动键不动数据，四处聚合点统一 knKey；**路由缓存**（RouteCache，
      20260831 增量哈希一期）：匹配/批量关联/生成标签三弹窗的两级 AI
      路由走 routeKnowledgeCached 按题指纹缓存（saveData("route-cache")
      LRU 2000，索引结构/模型变更整表作废，命中零 AI 调用，方案与
      分期见 docs/incremental-hash-plan.md）；专题/知识文档管理面板
      CollectionPanel/KnowledgePanel 挂页签左栏 rail）、
      `src/companion/`
      （伴学看板娘「小书童」：规则层表情+台词/AI 增强与聊天走智能体
      agentChatOnce 独立会话并发，双宿主=刷题页签挂载层+单词 dock
      内嵌，各域收口一行 `notify*` 接入事件，管理工作区面板已 Svelte
      四件套化（2026-08-27，comp/CompanionPanelApp）；聊天历史按学伴
      id 分份持久 saveData("companion-chat")，core/ChatStore 串行写；
      默认学伴物化为 id=default 的正式条目——可删可改与自定义同权，
      列表至少保留一个）、
      `src/ui/`
      （FormHtml 行样式/选择器/设置弹窗/`shared.ts` 工具/Svelte 迁移
      公共积木：`mountApp.ts` 挂载帮手 + `FormRow.svelte` 表单行）。
    - **各域 `index.ts` 必须是该域的入口编排代码，禁止纯 re-export barrel**；
      共享类型在 `src/types.ts`，样式 `src/scss/` 分片。
- **Svelte 渐进迁移**（2026-08-27 起，全仓 UI 分六批迁 Svelte 5）：
  模式样板/暗雷清单/路线图见 `docs/svelte-migration.md`（各域开工前
  必读）；已迁 word 域、companion 看板娘+管理面板、bank 工作区面板
  （专题/知识文档）、review 错题本主区、stats 统计面板、convert 两弹窗、
  quiz 6-1~6-3（开刷面板/轮次报告/rail/题号栏）、6-4a 题卡渲染层
  （三类题卡+材料组壳逐单元 mount）、6-4b 作答态收敛（三写统一进
  卡内 CardUi 响应态）与 6-5 侧栏/头部壳（SidePanelApp/QuizHeadApp，
  2026-08-31，quiz 域收官）。组件零 `<style>`，
  类名与迁移前逐字一致走全局 scss；新域挂载一律用 `ui/mountApp.ts`。
- **硬性约束：仓库内单文件 ≤500 行**（src/quiz/index.ts 518 行豁免
  ——6-5 新增访问器属紧凑访问器表，外移破坏内聚，见迁移文档 6-5 节）；
  界面规范见 `docs/design-review.md §〇`
  （图标用 `FormHtml.svgIcon` 禁 emoji；表单统一 FormHtml 行样式）。
- **CSS 特异性与思源主题**（20260827 踩坑）：formRow 行容器
  `class="fn__flex b3-label config__item wengu-formrow"`——思源运行
  时主题注入的 `.b3-label` 单类选择器同特异性后定义会覆盖我们的
  `.wengu-formrow { display:flex; width:100% }`。修复：复合选择器
  `.b3-label.wengu-formrow { ... !important }` 把特异性抬到 0,2,0。
  工作区面板（`.wengu-ws-page`）没有 `.config__items` 父容器作兜底，
  所有 formRow 都需要这条复合规则。
- 改行为必须同步 `docs/question-block-contract.md`。

## 通用调试流程（两台机器一致）

1. `pnpm exec tsc --noEmit && pnpm run check:svelte && pnpm exec eslint src --ext .ts && pnpm exec prettier --write . && pnpm test && pnpm run build`
   （**一律 pnpm，禁 npm/npx**；`check:svelte`=svelte-check 检 .svelte
   组件类型——tsc/eslint 都不覆盖 .svelte，它缺了组件错误只能在
   构建/运行期暴露；格式化用 Prettier 紧凑规则 `.prettierrc`
   120 列/4 空格——2026-08-24 起从 dprint 切换，dprint 已移除；
   `pnpm test`=vitest 纯逻辑单测，内核 IO 不进单测——真机行为坑见
   下文「内核坑」，测试配置见 `vitest.config.ts` 与 `tests/siyuan-stub.ts`）
2. 安装：把 `dist/index.js`、`dist/index.css`、`src/i18n/{zh-CN,en}.json`
   复制到**本机工作区的插件目录**（见下）——i18n 忘拷会显示原始键名
   （看起来像「英文」）。
3. 重载前端：`POST /api/petal/setPetalEnabled`
   `{"frontend":"desktop","packageName":"siyuan-plugin-wengu","enabled":false}`
   → sleep 1s → 同体 `enabled:true`。之后让用户**重开温故页签**验证。
4. 验证安装：在装好的 `index.js` 里 grep 特征串；注意 minify 会把中文
   转成 `\uXXXX`，grep 原文中文可能查不到（用英文标识符/属性名查）。

## 机器 A（本机，Windows + Git Bash，2026-08-30 重验）

- 思源 **3.8.1** 桌面版（已自 3.8.0 升级），日常两个工作区：
  `D:\data\思源\工作`（主）与 `D:\data\思源\测试`（调试常开的是它）
- ⚠️ **conf.json 在 `conf/conf.json` 子目录**（3.8.1 挪的，同机器 B），
  token 变了去那里找 `api.token`（工作区=gm8mhokhgd58ceaf，
  测试区=ycfl0ijk9mxvnh21）
- ⚠️ **内核端口不再固定 6806**（2026-08-30 实测：conf 无自定义端口时
  随机，当时为 52036 且 6806 无监听）——调试前先
  `wmic process where "name='SiYuan-Kernel.exe'" get CommandLine`
  查 `--port` 与 `--workspace`，按实际工作区取端口+token 调用
- 插件安装目录：`D:/data/思源/工作/data/plugins/siyuan-plugin-wengu/`
  与 `D:/data/思源/测试/data/plugins/siyuan-plugin-wengu/`（两区都拷）
- 思源前端源码（读实现用）：`C:\Program Files\WindowsApps\
89C2A984.SiYuan_3.8.1.0_x64__1qfd3tsw4ngc2\app\resources\stage\build\app\`
  （`common.*.js` 是压缩单行，**直接 grep 会卡死 shell**，先
  `tr ';{' '\n\n'` 分行再 grep）

### 机器 A 的 Shell 坑（Git Bash 特有）

- **`/tmp` 是 MSYS 虚拟路径，Windows 原生 node 读不到**：curl
  `-o /tmp/x.json` 后验证要用
  `node -e "require(require('path').join(require('os').tmpdir(),'x.json'))"`
  （Git Bash 的 /tmp 恰好映射 os.tmpdir()，但 node 不认 `/tmp` 字面量）

## 机器 B（Mac，macOS arm64，已验证 2026-08-24）

- 思源 **3.8.1** 桌面版（比机器 A 的 3.8.0 新，内核坑一节若行为不符
  需重新验证），应用在 `/Volumes/baiWeiNV7200/app/SiYuan.app`（外置卷，
  不在 /Applications）
- 仓库路径：`/Volumes/baiWeiNV7200/sasa/siyuan/siyuan-plugin-wengu`
- 工作区 `/Volumes/baiWeiNV7200/data/思源/工作`
- 内核 API：`http://127.0.0.1:6806`，`Authorization: Token 8xmofpelwury3fkd`
  （同进程另有 `--attach-ui` 随机端口如 54644，用 6806 即可）
- ⚠️ **conf.json 在 `conf/conf.json`**——3.8.1 把它挪进了 `conf/`
  子目录，不在工作区根（机器 A 已升 3.8.1 同款），token 变了去那里找
  `api.token`
- 插件安装目录：`/Volumes/baiWeiNV7200/data/思源/工作/data/plugins/siyuan-plugin-wengu/`
- 思源前端源码（读实现用）：`/Volumes/baiWeiNV7200/app/SiYuan.app/
Contents/Resources/stage/build/app/`（同机器 A：`common.*.js`
  压缩单行，先 `tr ';{' '\n\n'` 分行再 grep）
- 工具链：node v24 + pnpm 11 均可用，tsc/eslint/dprint/webpack 构建链
  全部验证通过
- **插件目录随思源同步在两台机器间流转**（temp/ 有同步冲突记录）：
  另一台机器装了旧版同步过来会盖掉本机新装——每次调试前先比对
  `md5 dist/index.js` 与插件目录里的是否一致，不一致就重装

### 机器 B 的 Shell 坑

- `setPetalEnabled` 成功时响应体带**整个插件 JS（约 2MB）**，直接打印
  会刷屏——加 `-o /tmp/pe.json` 再用 `node -e` 取 `.code`/`.data.enabled`
- zsh 内联 JSON 同样有转义坑——精确 payload 用文件（与机器 A 相同）

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
      带 `>` 前缀——按行解析 kramdown 时必须清理这些残渣（BankParse
      的 IAL_LINE/IAL_INLINE），否则渲染成字面属性文本。
    - `/api/transactions` + DOM 数据（前端同款）也可用（多顶层块、超级块
      完整落盘），但 **`data-custom-*` 被内核剥离**且 `data-node-id` 可能
      被重生成——不如 markdown 通道，留作后备。
    - `updateBlock` 仍不可用：文档根传多块 → 并成**一个段落**；普通子块传
      多块 → **只保留第一段**（危险）。

- **putFile 不吃 JSON**：上传文件必须 multipart（path/isDir/file），
  fetch + `window.siyuan.config.api.token` 鉴权（见 PdfImport.putAsset）。
  **3.8.1 路由迁移**：端点变为 `POST /api/file/putFile`（旧 `/api/putFile`
  返回 200+空 body 假成功），且 path 必须工作区相对（带前导 `/` 会拼出
  `…\C::` 非法路径报 mkdir 错）（20260825 真机实测）。
- 内置智能体 `/api/ai/agent/chat`（SSE）：**并发锁按 sessionID 键控
  （`runningSessions map[string]*runningSession`，非全局锁），不同
  sessionID 可并发、且每次可指定 `model`——即「并发 + 每场景指定模型」
  两个诉求一个接口全满足**（20260827 在 3.8.1 两轮真机验证：两个不同
  sessionID 并发请求均 `event:done` 零 busy；传假 model id 被拒
  「请先参考用户指南进行配置」证明 model 生效）。
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
  `/api/query/sql` 不带 LIMIT 最多返回 64 行且 code=0 无异常（/MinerU
  书架 94 篇文档只回 64 篇的假象）；子查询不支持（返回空）。批量/
  全量查询必须显式 `LIMIT n OFFSET k` 分页（见 KnowledgeLink.sqlAll）。
- Lute：**只能用全局 `window.Lute`**——插件加载器给 `"siyuan"` 模块
  注入的固定对象里没有 Lute（3.8.1 加载器实测：window.eval 包合成
  require，模块表只有 fetch*/Protyle/ProtyleMethod/Dialog 等），
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

## 外部 API：MinerU（PDF 解析，20260823 接入）

- **浏览器直连 mineru.net API 被 CORS 拦**（OPTIONS 405、响应无
  ACAO 头）：JSON 请求一律走内核 `/api/network/forwardProxy`
  `{url, method, headers, payload?, timeout}`，上游响应在
  `data.body`（3.8.0 真机验证可用）。
- forwardProxy 的 payload 只收 **string，二进制过不去**：PUT 上传
  PDF、下载结果 zip 这两步浏览器直连 OSS 预签名地址。PUT **绝不能
  带 Content-Type**（官方 issue #4145：预签名按无该头计算，File/Blob
  body 会被 fetch 自动补类型——用 ArrayBuffer body）。
- 流程（v4 批量接口）：`POST /api/v4/file-urls/batch`
  `{files:[{name,is_ocr}], enable_formula, enable_table, language}` →
  `batch_id` + `file_urls[0]` → PUT 文件 → 轮询 `GET
/api/v4/extract-results/batch/{batch_id}`（state：waiting-file/
  pending/running/converting → done/failed；running 带
  extract_progress 页码）→ 下载 `full_zip_url`（full.md + images/，
  fflate 前端解压）。鉴权 `Authorization: Bearer <token>`。
- 用户 token 存 `settings.mineruToken`；插图落笔记本
  `assets/wengu/{时间戳}/` 再建原文档（PdfImport）。

## Shell/工具坑（本机）

- Git Bash 里转义会悄悄破坏 JSON payload——**精确 payload 用文件**
  （Write 工具写临时文件再 `curl -d @file`），别在命令行内联 JSON。
- `python` 是 WindowsApps 桩，用 `node -e` 做解析。
- 重 grep minified bundle 会卡死（见机器 A 节的 tr 分行法）。
- **CRLF 幻影脏**：pull 机器 B（Mac，LF）推的提交后，`git status` 报
  几十个 M 但 `git diff` 为空（换行符归一化假阳性，且会挡住 pull）——
  确认 `git diff --name-only` 无真实改动后 `git checkout -- .` 清掉再拉。
  变体（20260824）：**`prettier --check .` 在 CRLF 工作副本上大面积报
  warn、`prettier --write .` 改出几十个 M，其实全是行尾幻影**——
  `git add -A` 归一后 diff 消失、nothing to commit。判断真假用
  `git diff --ignore-all-space --numstat`（全 0 = 纯行尾噪音）。
