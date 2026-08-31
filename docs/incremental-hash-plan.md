# 增量哈希方案（内容寻址转换/关联）

2026-08-31 定稿方向。目标：文档只改一部分时 AI 只处理变更部分，题只改
一道时只重生成了这道——按内容哈希跳过未变输入，省 AI 调用成本。

## 〇、为什么不用思源历史/比较 API

内核 history 体系（`/api/history/getDocHistoryContent` 等）面向「整文档
回滚」，前端的版本比较是 UI 组件（`history__doc-compare` 对话框选两个
版本渲染 diff），**内核没有暴露「diff 两版本返回变更区间」的程序化
API**；且文件历史需在设置里开启才有数据。就算能拿到 diff，把变更区间
映射回「哪个转换块」也绕不过自己切块这步。结论：自建内容寻址，不依赖
思源历史。

## 一、现有地基（已存在，直接复用）

- **题级哈希**：`BankParse.questionHash(kd)`——剥块 id 与 `updated`
  时间戳后的双 djb2 指纹（`h1-h2` base36）。`BankRecord.hash` 逐题存
  储，`BankData.hashed` 做「指纹 → qid」反查，现用于跨卷同题去重与
  解析缓存失效。**「每题一个哈希」已在跑。**
- **分块转换**：`ConvertService.chunkKramdown`（5000 字空行边界）、
  每块独立路由+生成、独立落盘——增量替换的天然挂点。
- **路由结果可缓存**：MatchDialog/BatchLinkDialog/TagDialog 三处共用
  `routeKnowledgeDiag`，入参是题目文本+知识索引，纯函数式可缓存。

## 二、分期方案

### 第一期：路由结果按题哈希缓存（✅ 2026-08-31 已落地）

实现：`src/bank/data/RouteCache.ts`——`routeKnowledgeCached` 共用入口
（MatchDialog/BatchLinkDialog/TagDialog 三弹窗换调），模块级单例
`initRouteCache`/`routeCache` 由 index.ts onload 注入
`saveData("route-cache")`。要点与本节方案的差异：

- 缓存键：`questionHash(路由输入文本)`（弹窗侧路由喂的是 routeTextOf
  的题干+选项，按实际输入取指纹）+ 模型 id；知识索引代数
  （`indexGenOf`：全部章 docId+path 与小节 id+path 的指纹，比「章数/
  小节数」更严——任何结构级变更必失效）作为整表代数，不符即整表
  作废重建。
- 缓存值：`{id,title}[]`；**AI 明确判零命中的空结果也缓存**（空也是
  有效答案），但 AI 调用失败（onFail 触发）不缓存，下次重跑再试。
- LRU 上限 2000 条（命中刷新时序，Record 保插入序淘汰最旧）；
  put 只进内存，一轮跑完与题库同节奏 flush（串行落盘链防内核并发
  互吞）。单测 `RouteCache.test.ts` 13 例。

### 第二期：结构切块 + 块级 src-hash + 增量重转换（核心）

现状 `chunkKramdown` 按偏移切块：文档中间插一段，后续所有块偏移错位，
哈希全失效。改为**结构切块**：

1. 按标题（h1~h6）/题号等稳定边界切大块；超阈值（5000 字）再按空行
   二切为子块，子块哈希挂父块名下。
2. 转换时每块在产出习题的容器 IAL 写 `custom-plugin-wengu-src-hash`
   （该块归一化内容指纹，复用 questionHash 同款双 djb2）。
3. 重转换入口对源文档重新结构切块、逐块算指纹，与题库/习题文档里
   已存的指纹比对，三态分类：
    - **相同** → 跳过（零 AI 调用，原题与刷题统计原样保留）；
    - **新增** → 正常走路由+生成，append 落盘；
    - **变更/消失** → 列清单让用户逐块选：重生成（旧题统计作废）
      或保留旧题（块标「源已更新」）。
4. 默认策略=用户逐块选（AI 重生成要花钱，开关交给用户）；设置页可
   配「全部保留旧题，只补新增块」的省费模式。

### 第三期（可选）：题级 src-hash 回写

每题容器 IAL 加该题来源段落的指纹，重生成单题前先比对源段是否真变
——没变直接拒绝重生成（「源未变化，无需重生成」）。要动落盘管线
（appendBlock 后补 setBlockAttrs，或生成占位再替换），工作量不小，
优先级最低。

## 三、约束与注意

- 归一化口径必须与 questionHash 一致（剥 id/updated、空白归一），
  否则思源读回 kramdown 的格式噪声会造成假变更。
- 结构切块对「无标题纯段落流」文档退化为按空行大块（边界=空行组），
  仍比偏移切块稳定（中间插入只影响所在大块）。
- IAL 新属性 `custom-plugin-wengu-src-hash` 需同步
  `docs/question-block-contract.md` 与 `src/siyuan/attrs.ts`。
- 思源历史/快照体系保持零依赖（见 §〇）。
