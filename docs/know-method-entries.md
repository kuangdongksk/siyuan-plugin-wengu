# 知识文档「题型 → 解法」条目抽取方案（设计稿）

2026-09-10 定稿方向（Issue #4，**本 Issue 只交设计稿，实现另开 Issue**）。
目标：把知识文档里「某类题怎么解」的内容（**题干特征 + 步骤序列 + 关键判据 +
常见坑**）从「只是一段被引用的正文」升级成**有结构的条目**，供两个消费点
使用——出题时作参考（第二期）、刷题时按需展示（第一期）。

本稿不引入新的数据体系：条目挂在既有 `bank.knowTrees` 上，生成并入既有
「索引」动作，消费点复用既有归一链与揭示闸。

---

## 〇、问题陈述（为什么不满足于现状）

知识文档现在有两种形态，都**只到「知识点」粒度**：

1. **SQL 小节**：章节文档的 h1~h6 标题树。小节正文靠 `sectionKramdown`
   现取（`src/convert/service/knowledge/KnowRef.ts`），上限 3000 字。
2. **AI 知识树** `bank.knowTrees`（`src/bank/data/KnowTrees.ts`）：对结构
   单薄的章节做 AI 归纳，产出 `h1 知识大类 / h2 方法·解法 / h3 细分` 的
   节点表，节点 id 铸内核块 id 形态。

问题在于：**「方法/解法」现在是树上的一个标题**，不是可消费的数据。落到
做题场景上，缺的恰恰是做题真正需要的那几样：

- 看到题干里出现什么形式，就该想到这个解法（**题干特征**）；
- 动手的**步骤序列**（先做什么、再做什么）；
- 什么时候**不能用**、边界条件是什么（**关键判据**）；
- 学生最常踩的坑（**常见坑**）。

这些内容在源文档里**往往是有的**（尤其是讲义、题解书），只是散在段落
文字里——出题 prompt 拿不到、刷题答错时也推不出来。把这块结构抽出来，
是「知识文档从引用源变成可用资产」的最后一公里。

**与 Issue #2 自动索引的关系**：本方案是自动索引的**延伸**，不是并行体系。
索引已经做完了「把章节归纳成树」这件事，解法条目只是同一份正文的**第二次
结构化**——挂到树上已有的节点上，因此应当并入同一次 AI 调用（见 §二）。

---

## 一、数据形状（D1）

### 结论

**落 `bank.knowTrees[docId].methods`，给 `BankKnowTree` 加一个可选字段；
不新开 `saveData`。**

```ts
/** 一条「题型 → 解法」条目。 */
export interface BankKnowMethod {
    /** 条目 id：铸内核块 id 形态（同 mintKnowNodeId）——与树节点共用 id
     *  空间，parseKpRefs / BLOCK_REF 正则冻结不动，将来要挂引用零成本。 */
    id: string;
    /** 适用题型；空数组 = 题型无关（见 D5）。 */
    types: QuestionType[];
    /** 题干特征：什么形式的题干该想到这个方法（≤80 字，可省略）。 */
    stemTraits?: string;
    /** 步骤序列（有序，1~8 步；每步 ≤60 字）。 */
    steps: string[];
    /** 关键判据：适用条件 / 边界 / 何时不适用（≤150 字，可省略）。 */
    criterion?: string;
    /** 常见坑（≤150 字，可省略）。 */
    pitfalls?: string;
    /** 补充说明（≤80 字，可省略）。 */
    note?: string;
    /** 挂载锚点：树节点 id（`BankKnowNode.id`）。 */
    nodeId: string;
    /** 源小节指纹键：见 D6（`tree:<path>` 降级形态）。 */
    sourceKey: string;
    /** 源小节内容指纹（stale 判定基线）。 */
    srcHash: string;
    /** 生成时间（毫秒时间戳）。 */
    generatedAt: number;
    /** 源已变更、条目待复核（不删，见 D6）。 */
    stale?: boolean;
}
```

`BankKnowTree` 增量：

```ts
export interface BankKnowTree {
    /* …既有字段不动… */
    /** 「题型 → 解法」条目（可选：旧树无此字段 = 没跑过解法抽取）。 */
    methods?: BankKnowMethod[];
}
```

### 理由

1. **与树同一次产出、同一次落盘**：解法条目是归纳的副产物，生命周期与树
   完全一致（同源文档、同一次 AI 调用、同一次覆盖写）。分成两个存储键，
   `setKnowTree` 的覆盖语义、`bank.flush()` 的去抖节奏、版本闩都要各写一份，
   收益却是零。
2. **锚点必须落在树节点 id 上**：`kpRefs`（题目记录的知识点引用）、
   活视图专题键 `col-kp-{id}`、薄弱画像键 `kp:{id}` 全都以这个 id 空间为
   键（`KnowledgeLink.treeOf` 已把树节点当章节小节输出）。条目独立成表
   就得重写 `internalRootMap` 与全部聚合点的对账口径——正是 Issue 里点名
   要避免的「并行体系」。
3. **兼容成本为零**：按数据演进守则（AGENTS.md），新增字段一律
   optional + 装载 backfill。旧树没有 `methods` 字段 → 读取端 `?? []`，
   不 bump version、不需要迁移；新树写下去，旧版本插件读到未知字段
   只是忽略。反向（新装旧）同样安全。
4. **不落文档——与 20260903 存储收口一致**：知识树已经不物化成
   《·知识树》文档，条目更不该落。

### 字段取舍说明

- **`steps` 必填、其余可省**：抽不到步骤的条目没有存在价值（那就还只是
  一段正文）；题干特征/判据/坑在源文里本就不一定写全，缺了不该判条目失败。
- **`nodeId` 必填、一个条目挂一个节点**：出题注入要能按 kp 节点 id 精确
  命中（D3）；多挂会让「节点 ↔ 条目」变成多对多，预算控制无从下手。
  一个节点上有多个方法时，就是多条条目（`洛必达法则` / `根式有理化` 各自
  一条，都挂在「未定式的计算」下——见 §七 示例）。
- **不存题目级字段**（难度/来源/正确率）：解法是知识侧的不变量，与用户
  做题统计无关；要统计就该去 `bank.stats` / `weakness` 取。

---

## 二、生成入口（D2）

### 结论

**并入既有「索引」动作，同一次 AI 调用产出**（手动「索引」与导入后自动
补索引两路共用 `KnowPanelCtl.executeOutline`），在回复末尾追加
`@@M…@@END` 解法块；**不做独立按钮**。

### 理由

1. **输入完全相同**：`generateKnowledgeOutline` 已经拉了整篇章节正文
   （`chapterTextOf`，预算 24000 字）喂给 AI（`KnowOutline.ts`）。独立按钮
   = 同一份 24000 字正文**再烧一次** prompt，成本翻倍、产出还可能与前一次
   归纳不一致（两次 AI 对同一章的「方法层」理解会漂）。
2. **生成入口天然只有一处**：索引的坑位管理（`ui.outlining` 单飞闸）、
   中止（`AbortController`）、通知收口（`notifyOutlineAutoDone`）、
   手动/自动两路共用执行体（`driveOutline` + `executeOutline`，AGENTS.md
   明令禁复制第二份）——新开入口就要把这些再实现一遍，且必然与索引的
   单飞闸打架（用户点「索引」时解法任务该不该起？）。
3. **AI 的语义负担很小**：归纳 prompt 已经要求「方法层要穷尽内容中有实质
   讲解的方法与解法」，只是产出的是**标题**。加一段「把方法层节点对应的
   步骤写出来」是对同一份理解的深挖，不是新任务。

### 衔接形态：树是主体，条目是节点属性

- 树节点（`BankKnowNode`）仍是**导航/聚合骨架**——面板树、路由词表、
  活视图、薄弱画像全部照旧。
- `methods[]` 是**挂在节点上的细节层**——面板默认不展开，只在刷题揭示区
  （D4）与出题注入（D3）被消费。
- **不要求一对一**：一个节点 0 条或多条条目、题型无关的条目挂任意节点，
  都是正常状态（§七 示例里「等价无穷小代换」节点就没有条目）。

### 协议：大纲 markdown 后追加解法块

`buildOutlinePrompt`（`src/ai/prompts/convert.ts`）末尾追加一段约定，AI 在
大纲 markdown **之后**输出：

```
@@M
AT: 未定式的计算
TYPES: single,brief
TRAITS: 题干出现 0/0、∞/∞、∞-∞ 型，或含 sin/cos/ln 与 x 的多项式比
STEPS: 判断未定式类型 | 检验洛必达适用条件（0/0 或 ∞/∞、可导、导数之比极限存在） | 分子分母分别求导 | 求极限；仍为未定式则重复
CRITERION: 导数之比极限不存在时不能用（只能说明此法失效，不能说明原极限不存在）
PITFALLS: 常见错解是条件没验完就求导；或求导后仍为未定式就误判极限不存在
NOTE: 一次只处理一层未定式
@@END
```

解析规则（新增纯函数，落 `KnowOutline.ts` 或其邻近模块）：

- `@@M` ~ `@@END` 为一条；**同一节点可多条**（重复 `AT`）。
- `AT` = **树节点标题**（不是路径）——命中规则见 D6；命中不到节点、或
  标题在树里不唯一，**该条丢弃并计入 `methodMiss` 计数**（不因此失败整个
  归纳，与 `stripChapterEcho` 的容错口径一致）。
- `TYPES` 三态见 D5；`STEPS` 用 `|` 分隔。
- 块外内容照旧走既有解析；`@@M` 块在 `extractOutlineMd` 之前剥除，
  避免污染大纲 markdown。
- 单条超长（steps > 8 / 字段超字数）**截断不丢条**；`STEPS` 为空则丢弃该条。

落库：`generateKnowledgeOutline` 把解析结果连同节点一起交给
`setKnowTree`（同一 `bank.markDirty()` + `bank.flush()`）。

### id 与增量复用

沿用树的既有策略（`treePathsOf` 同路径复用旧 id）：**条目按
`(nodeId, types 集合, 步骤首步)` 三元组对齐旧条目并复用 `id`**；对不上的
铸新 id。这样条目 id 稳定，将来若要挂引用/做用户笔记不会悬空。
`generatedAt` / `srcHash` 每次重索引刷新。

---

## 三、消费点一：出题注入（D3）

### 结论

落 **`GenQuestion.generateQuestion` 的 concept 模式**（薄弱加练
`WeakDrill` / 收集补题 `CollectionDialog` → `GenCore.genIntoCollection` →
`generateQuestion`）：

> **kp 节点 id 精确命中 → 题型过滤 → 1200 字预算**；零新 AI 调用、
> 零新缓存表；与 `sectionKramdown` **共享 3000 字**（解法 ≤1200 + 正文
> ≤1800）。

### 匹配规则（三步，全确定性子）

1. **精确命中**：`point.key` 形如 `kp:{nodeId}` 时，取
   `trees[?].methods.filter(m => m.nodeId === nodeId)`。这是**唯一**的
   主干路径——`kp:` 键本来就来自树节点/小节块 id，命中是精确等值比较，
   零模糊、零 AI。
2. **题型过滤**：目标题型由 concept prompt 固定为 `single/judge`
   （`conceptPrompt` 的 `protocolSpec([QT.Single, QT.Judge])`）；
   保留 `m.types.length === 0`（题型无关）或与目标集合有交集的条目。
3. **自由文本键兜底**（`kn:` / `ch:`）：`GenCore` 目前把 concept 降级为
   variant（`genIntoCollection` 里 `!p.key.startsWith("kp:")` 分支），
   本方案**不改这个降级**——`kn:`/`ch:` 拿不到节点 id，用标题归一匹配
   容易错挂。**如将来要放开**，走既有归一链（`loadSynonyms()` 快照 →
   `normalizeKnowledge`，与 `textRefsFor` 同一条链），唯一命中才用；
   本期不做。

> 注意：**变式模式（variant）不注入解法**。变式的模板是原题 kramdown，
> 注入解法会与题模板打架（原题已在同一知识点上定型），且 variant 的
> prompt 里没有知识点小节位。属于**有意不做**，不是遗漏。

### 注入形态

`conceptPrompt(title, statLine, section)`（`src/ai/prompts/gen.ts`）新增
第 4 个可选参数 `methods: BankKnowMethod[]`，在【知识点】块下方追加：

```
【解法参考（供出题参考，不要照抄成解析）】
- 未定式的计算（single/brief）
  步骤：判断未定式类型 | 检验洛必达适用条件 | …
  判据：导数之比极限不存在时不能用
  常见坑：条件没验完就求导
```

要点：

- **明确写「不要照抄成解析」**：这张 prompt 的产物是**新题**，解法是
  选题/设干扰项的参考；不写这句，AI 会把解法抄成解析，导致「解析与题目
  无关」的产出（`verifyPrompt` 自检能拦一部分，但白烧一次调用）。
- 只喂 `steps` / `criterion` / `pitfalls` 三项，不喂 `sourceKey` /
  `srcHash` / `id` 等元数据。
- 题型标签按 i18n 展示名给（`typeKey` 同源），不喂原始枚举串。

### token 预算

```
sectionKramdown(kpId, 1800)  ← 正文压到 1800（原为 3000）
methodsText                  ← 解法合计 ≤1200
                             ─────────────
                               合计 ≤3000（与改造前 section 上限持平）
```

- **正文有意提前截断**：解法条目的信息密度显著高于原文段落（原文有大量
  铺垫/例子），同样字数下解法对出题的参考价值更高。1200 字大约够 2 至 3 条
  完整条目（一条约 350 至 450 字）——一期不做优先排序，按 `methods[]` 顺序
  取到预算为止，超预算的条目**整条丢弃**而不是截半条。
- **预算常量集中**：`GEN_METHOD_CHARS = 1200` 与
  `GEN_SECTION_CHARS = 1800` 进 `src/ai/prompts/gen.ts` 顶部（调用点禁自造
  预算数字，同 `AI_TIMEOUT` 口径）。
- **零缓存**：解法是题库内的本地数据，读取是内存操作，不需要 RouteCache
  那一层（那是给 AI 路由用的）。

---

## 四、消费点二：刷题侧展示（D4）

### 结论

落 **`revealCard` 揭示态**（`src/quiz/flow/AnswerFlow.ts`）的解析区下方，
渲染为 `.wengu-method` 可折叠区块；**答错默认展开**，答对默认收起。

> ⚠️ 硬口径：**CSS 显隐钩子挂 `.wengu-revealed`，不挂 `.wengu-graded`**
> （AGENTS.md 明令）。`.wengu-graded` 只表示「已判分」，after 模式提交时
> 就落位——挂它等于提交当场泄题。

### 数据通道（两段，别混）

1. **装载期建表**：题目装载后，按 `q.kpRefs[].id` 收集节点 id →
   `knowTreesOf(bank)` → 建 `Map<nodeId, BankKnowMethod[]>`（只保留与
   该题题型相关或题型无关的条目）。表挂在视图/装载上下文里，**不进
   `WenguQuestion` 字段**（那是题目内容的解析产物，加运行时展示数据会污染
   指纹口径——`questionHash` 会跟着变，触发全库假漂移）。
2. **渲染期取值**：`CardInitCtx`（`src/quiz/render/CardState.ts:114`）新增
   可选 `methods?: BankKnowMethod[]`，「挂载编排整卷一次算好」时按
   `q.kpRefs` 填好（`QuizShell.renderStaticChunked` 里 ctx 构造处）；
   组件 `QuizCard/index.svelte` 的 `buildCardInit` 后直接读 `ctx.methods`。

> 注意这里**不在 `CardInitCtx` 里写 `m.showAttempts` 那种开关**：那是
> `CardHtmlModel`（渲染入参）的职责，`m` 里没有题目身份，按 `q` 取不到
> 解法。

### 展示形态

挂在解析区（`.wengu-static-sol`）之后：

```html
<div class="wengu-method" data-method-open>
    <div class="wengu-method-head">解法参考（unilist 折叠）</div>
    <div class="wengu-method-body">
        <div class="wengu-method-item">
            <div class="wengu-method-title">未定式的计算 · 洛必达法则</div>
            <ol class="wengu-method-steps">
                <li>判断未定式类型</li>
                …
            </ol>
            <div class="wengu-method-criterion">适用条件：…</div>
            <div class="wengu-method-pitfall">常见坑：…</div>
        </div>
    </div>
</div>
```

- **显隐靠父级 `.wengu-card.wengu-revealed`**（与解析区同闸，scss 加一条
  `.wengu-card:not(.wengu-revealed) .wengu-method { display:none }`），
  scss 落 `src/scss/card-render.scss`。
- **折叠态字段落 `CardUi`**：`methodOpen: boolean`（初始 `false`）。
  `revealCard` 里**唯一新增的一行**：`ctl.ui.methodOpen ||= !r.ok` ——
  「答错默认展开」在挂载期无从得知（挂载时还没判分），只能在揭示时补。
  恢复路径（`initRestoredNormal`）同样按 `r.ok` 置位。
- 卡片零 `<style>`（组件约定），类名走全局 scss；新类名前缀 `wengu-method-`
  与既有 `wengu-` 命名一致。
- **步/空/材料组口径**：steps 卡与 slots 卡同样按 `q.kpRefs` 取解法，
  挂在卡尾（不走它们自己的步/空区域）；材料组内逐题各自取自己的。
- **预览/渐进模式不展示**：预览是「看题目长什么样」，渐进每批重建块 id
  会失效——统一由 `.wengu-revealed` 闸自然挡掉（预览不判分、不揭示）。

---

## 五、与现有「题型」体系的关系（D5）

### 结论

**独立维度，不合并。**`types` 用**三态**表达适用面。

### 理由

`QuestionType`（`src/types.ts`）是**封闭枚举**，且被多处吃死：

- `protocolSpec(types)` 按题型裁剪行协议（AI 只看到要写的部件与答案约定）；
- 判分族 `AUTO_GRADE_TYPES`、`hasSteps/hasSlots/isChoice` 等结构判据；
- i18n 键 `typeKey` 按枚举生成（`type${type[0].toUpperCase()}${type.slice(1)}`）。

「解法」是**开放集合**（洛必达法则、根式有理化、夹逼准则、换元积分…），
既不能穷举、也不进判分路径。把它塞进 `QuestionType` 会污染协议裁剪与
判分族，还要给每个解法补 i18n 键——典型的错误抽象。

### 三态语义

| `types` 取值          | 语义                   | 例子                               |
| --------------------- | ---------------------- | ---------------------------------- |
| `["single"]`          | 只对单选               | 概念辨析类（「下列命题正确的是」） |
| `["multiple","fill"]` | 对这几类都适用         | 需要写计算过程的题型               |
| `[]`                  | **题型无关**，一等公民 | 「先看未定式类型」这种通用起手     |

**`[]` 不是「解析失败」**：省略 `TYPES` 行就是 `[]`（与转换侧
`TYPES:` 缺席 = 无现成题目同源的容错口径）。解析时未知题型名**逐个丢弃
但不丢条**（枚举里没有的写法不该让整条解法消失）。

### 与既有维度的组合

- 卡片上的 `knowledge` / `chapter` 是**内容标签**，`kpRefs` 是**引用**，
  `methods` 是**方法**——三者互补不替代。
- 薄弱画像聚合键 `kp:{id}` 不变：条目不参与聚合（它不是统计维度）。

---

## 六、增量维护（D6）

### 结论

**复用 `KnowHash` 的包含式切段指纹**（`src/bank/data/KnowHash.ts`），
条目粒度 = 「节」；源变更 → 标 `stale` **不删**，用户可控重建。

### ⚠️ 本稿最关键的一处坑：条目 ↔ 源小节**对不上**

`KnowHash.sectionHashesOfDoc` 的键是**源文档标题块 id**；而
`BankKnowTree.nodes[].id` 是 `mintKnowNodeId()` 铸的**内核块 id 形态**，
**不是**源标题块 id。两者之间**没有任何现成映射**——树是 AI 归纳的产物，
节点标题与源标题本来就可能不一致（归纳会改写法、并小节、拆小节）。

因此**不能**直接说「条目的 `sourceKey` 复用 KnowHash 段 id」。解决方案：

1. **prompt 加一行 `AT: <原文小节标题>`**（D2 协议里已有）——AI 见过的
   正文里带着 `#` 前缀的源标题，回填原文照抄即可。
2. **索引时顺手建表**：`generateKnowledgeOutline` 已经拉了 `docBlocks`
   （`id/type/subtype/content`），过滤 h 块 → `Map<normalizeKnowledge(标题)
→ 标题块 id>`（复用既有归一链，与词表/路由同一口径）。
3. **唯一命中才记小节级 `srcHash`**：`sourceKey = <标题块 id>`、
   `srcHash = KnowHash 段指纹`（若该块在 `sectionHashesOfDoc` 输出里）。
4. **落空降级吃树级指纹**：`sourceKey = tree:<节点 path>`、`srcHash =
questionHash(章节正文)`（即 `outlineSrcHash` 的口径，树本来就用它）。
   **绝不因为映射不上就丢条目**——降级只是失效精度变粗（整篇一起 stale）。

### stale 三态

| 情形                     | 处理                                                            |
| ------------------------ | --------------------------------------------------------------- |
| `srcHash` 与现行指纹一致 | 正常                                                            |
| 不一致                   | 标 `stale: true`（**不删、不出题、刷题侧加「源已变更」徽标**）  |
| 重索引                   | 覆盖写整棵树（含 `methods`），`stale` 由新产出的 `srcHash` 决定 |

- **与树/记录的 stale 口径一致**：`BankKnowTree.srcHash` 就是「源变更 →
  重新归纳」的既有约定；`KnowHash` 的 stale 是**一次性提示**（比对后基线
  自推进）。条目沿用前者（持久标记，不自动清），因为重建需要 AI 调用——
  自动清掉等于悄悄丢数据。
- **重索引是覆盖语义**：用户点「索引」（两击确认）→ 重跑 AI → 用新
  `methods[]` 整体替换。与条目按 D2 的三元组对齐复用 id。**旧条目上的人工
  修订会被覆盖**——这是既有「索引 = 覆盖」语义的延续（开放选项 §九 □2）。

### ⚠️ 术语区分（写代码时最容易混的一处）

| 字段                               | 语义                      | 生命周期                      |
| ---------------------------------- | ------------------------- | ----------------------------- |
| `BankMethod.sourceKey` / `srcHash` | 条目 ↔ **知识文档小节**   | 索引刷新                      |
| `BankRecord.srcKey` / `srcHash`    | 题目记录 ↔ **源讲义区间** | 重导逐段比对（`SetSegments`） |

**两者语义不同，不合用、不要互相赋值。**题目侧 `srcKey` 是逐段链的
`A:<区间起点偏移>`（见 `SetSegments`），别因为「都有 src 前缀」就复用。

---

## 七、端到端示例（真实链路）

### 7.1 源文档

工作区一篇章节文档《2.3 未定式的计算》（docId 记作 `20260910120000-abc1234`），
正文（节选）：

```
# 2.3 未定式的计算

本节讨论 0/0 与 ∞/∞ 两类基本未定式，以及 ∞-∞、0·∞ 的转化。

## 2.3.1 洛必达法则

若 lim f(x)=lim g(x)=0（或同为 ∞），且 f、g 在去心邻域可导、g'(x)≠0，
并且 lim f'(x)/g'(x) 存在（或为 ∞），则 lim f(x)/g(x) = lim f'(x)/g'(x)。
注意：只能先验条件再求导；若 f'/g' 的极限不存在，不能断言原极限不存在——
此时洛必达失效，应改用其他方法。典型错解是看到 0/0 就求导，忽略条件检验。
若一次求导后仍未定式，可重复使用，每步都要重新检验。

## 2.3.2 根式有理化

含 √ 的 0/0 型，先把分子（或分母）有理化，约去零因子再求极限。
例：lim (√(x+1) − 1)/x = lim x/(x(√(x+1)+1)) = 1/2。

## 2.3.3 等价无穷小代换

x→0 时 sin x ~ x、ln(1+x) ~ x、1−cos x ~ x²/2。乘积与商的因子可直接
替换，但加减法中替换要谨慎（可能改变未定式类型）。
```

### 7.2 索引产出（`bank.knowTrees["20260910120000-abc1234"]`）

一次「索引」AI 调用，回复含大纲 + 解法块：

```
# 未定式的计算
## 洛必达法则
适用 0/0 与 ∞/∞ 型，需先验条件
## 根式有理化
含根式的 0/0 型，先约去零因子
## 等价无穷小代换
x→0 的常用替换，注意加减法慎用
@@M
AT: 洛必达法则
TYPES: single,brief
TRAITS: 题干出现 0/0、∞/∞ 型，或含 sin/cos/ln 与 x 的多项式比
STEPS: 判断未定式类型 | 检验条件（0/0 或 ∞/∞、可导、g'≠0、导数之比极限存在） | 分子分母分别求导 | 求极限；仍为未定式则重复 | 条件失效时改用其他方法
CRITERION: 导数之比极限不存在时不能用——只能说明此法失效，不能说明原极限不存在
PITFALLS: 看到 0/0 就求导，忽略条件检验
NOTE: 一次只处理一层未定式
@@END
@@M
AT: 根式有理化
TYPES: single
TRAITS: 分子或分母含 √、直接代入得 0/0
STEPS: 判断根式在分子还是分母 | 乘以共轭式有理化 | 约去零因子 | 代入求极限
CRITERION: 只适用于含根式的代数型；含三角/对数应先考虑等价无穷小
PITFALLS: 共轭式乘错号（√a−b 的共轭是 √a+b）
@@END
```

解析 + 落库结果（`methods` 字段填满，两条；节点 id 由 `mintKnowNodeId()`
铸，这里记作 `20260910120003-k3f9a2b` / `20260910120003-m7c1d4e`）：

```json
{
    "srcId": "20260910120000-abc1234",
    "outlineMd": "# 未定式的计算\n## 洛必达法则\n…",
    "nodes": [
        { "id": "20260910120003-k3f9a2b", "title": "洛必达法则", "level": 1, "note": "适用 0/0 与 ∞/∞ 型，需先验条件" },
        { "id": "20260910120003-m7c1d4e", "title": "根式有理化", "level": 1, "note": "含根式的 0/0 型，先约去零因子" },
        {
            "id": "20260910120003-p2q8w5r",
            "title": "等价无穷小代换",
            "level": 1,
            "note": "x→0 的常用替换，注意加减法慎用"
        }
    ],
    "srcHash": "3f2a91-7c4b",
    "createdAt": 1789000000000,
    "methods": [
        {
            "id": "20260910120005-a1b2c3d",
            "types": ["single", "brief"],
            "stemTraits": "题干出现 0/0、∞/∞ 型，或含 sin/cos/ln 与 x 的多项式比",
            "steps": [
                "判断未定式类型",
                "检验条件（0/0 或 ∞/∞、可导、g'≠0、导数之比极限存在）",
                "分子分母分别求导",
                "求极限；仍为未定式则重复",
                "条件失效时改用其他方法"
            ],
            "criterion": "导数之比极限不存在时不能用——只能说明此法失效，不能说明原极限不存在",
            "pitfalls": "看到 0/0 就求导，忽略条件检验",
            "note": "一次只处理一层未定式",
            "nodeId": "20260910120003-k3f9a2b",
            "sourceKey": "20260910120001-h3x9k2m",
            "srcHash": "8d21f0-4ab7",
            "generatedAt": 1789000000000
        },
        {
            "id": "20260910120005-e4f5g6h",
            "types": ["single"],
            "stemTraits": "分子或分母含 √、直接代入得 0/0",
            "steps": ["判断根式在分子还是分母", "乘以共轭式有理化", "约去零因子", "代入求极限"],
            "criterion": "只适用于含根式的代数型；含三角/对数应先考虑等价无穷小",
            "pitfalls": "共轭式乘错号（√a−b 的共轭是 √a+b）",
            "nodeId": "20260910120003-m7c1d4e",
            "sourceKey": "20260910120001-n8p4q1t",
            "srcHash": "c9a3e2-1f60",
            "generatedAt": 1789000000000
        }
    ]
}
```

> **注意 `等价无穷小代换` 节点没有条目**——源文里它只有一句「加减法慎用」
> 的提醒，够不上「步骤序列」。这实证了 §二 的口径：解法与树节点**不是
> 一对一**，没有条目的节点是正常态，不该为凑数而生成。

### 7.3 消费链路一：出题注入（第二期）

薄弱画像里用户在 `kp:20260910120003-k3f9a2b`（洛必达法则）做错 2 次，
点「薄弱加练」→ concept 模式：

1. `GenCore.genIntoCollection` 收 `{ key: "kp:20260910120003-k3f9a2b",
title: "洛必达法则" }`，mode=concept，key 以 `kp:` 开头**不降级**。
2. `generateQuestion` → `kpId = "20260910120003-k3f9a2b"` →
   `sectionKramdown(kpId, 1800)` 取源小节正文（走 `tree:<path>` 降级时
   取 `knowNodeText`）→ **新增**：从 `knowTreesOf(bank)` 取该节点的
   `methods`，题型过滤（目标 `[single, judge]`）：
    - 条目一 `types=["single","brief"]` → **保留**（与 single 有交集）；
    - 条目二 `types=["single"]` → **保留**；
    - 若某条写的是 `types=["fill"]` → **过滤掉**，一条都不注入也是正常分支。
3. `conceptPrompt(title, statLine, section, methods)` 拼出：

```
【知识点：洛必达法则（做错 2 次）】
<源小节正文，≤1800 字>

【解法参考（供出题参考，不要照抄成解析）】
- 洛必达法则（single/brief）
  步骤：判断未定式类型 | 检验条件（…） | 分子分母分别求导 | …
  判据：导数之比极限不存在时不能用——…
  常见坑：看到 0/0 就求导，忽略条件检验
```

4. AI 出题 → `parseDrafts` → `renderUnit` → `genWithVerify` 自检
   （`VERIFY: yes`）→ `addGenerated` 入库，`kpRefs` 照旧
   `[{id: kpId, title: "洛必达法则"}]`。

### 7.4 消费链路二：刷题侧展示（第一期）

一道 `fill` 题答错，判定 `{ submitted: "1", ok: false }`：

1. `AnswerFlow.submitAnswer` → `revealCard(host, ctl, q, {submitted, ok:false})`。
2. `ctl.reveal(submitted)` 置 `ui.revealed` → 卡根 `.wengu-card.wengu-revealed`。
   解析区与 `.wengu-method` 区块**同一个闸**一起显形；作答前整片不可见。
3. **新增的一行**：`ctl.ui.methodOpen ||= !r.ok` → 本题答错 → 解法区块
   默认展开。
4. 组件渲染：`ctx.methods`（挂载期按 `q.kpRefs` 建表填入）→
   `.wengu-method` 区块列出该节点全部保留条目（洛必达法则 + 根式有理化，
   两条 `types` 都与 `fill` 无交集？——注意：题目的 kpRefs 只指向
   「洛必达法则」节点，故只展示该节点的条目；`fill` 与
   `["single","brief"]` 无交集 → **该条不展示**，「解法参考」区整体不渲染，
   回到改造前行为）。
    > 这条分支特意写出来：**题型过滤在展示侧同样生效**，否则会出现
    > 「填空题里推一条只适用于大题的解法」的错配。
5. 用户点标题折叠/展开（`ui.methodOpen` 双向）。

### 7.5 增量链路

1. 用户在思源里改了 `2.3.1 洛必达法则` 一节（补了一句「每步都要重新
   检验」）。
2. `KnowHash.diffDocs` 或 `ws-main` 更新事务（`refreshDoc`）：该标题块段
   指纹变 → 面板出「源已变更」徽标。
3. 条目侧：**读取时**用现行指纹（`docSectionHashes` 或
   `outlineSrcHash`）与条目 `srcHash` 比对——不一致 → 该条 `stale`：
   出题注入跳过、刷题侧展示带「源已变更」小字。
4. 用户点「索引」两击确认 → 重跑 AI → 新 `methods[]` 按
   `(nodeId, types, 步骤首步)` 对齐复用 `id`，覆盖写整棵树。
   新条目的 `srcHash` = 现行指纹 → `stale` 清除。

---

## 八、分期建议（D7）

### 第一期（先做，能最快见到效果）

**范围：数据类型 + 协议解析 + 写回 + 刷题侧展示。**

1. `BankKnowMethod` / `BankKnowTree.methods?`（`src/bank/data/KnowTrees.ts`）；
2. `buildOutlinePrompt` 追加 `@@M` 约定 + 纯函数解析（`@@M` 剥除、
   字段校验、`AT` 命中树节点、id 复用）；
3. `generateKnowledgeOutline` 写回 `methods`；`AT` → 标题块 id 映射表
   （`docBlocks` 顺手建）；
4. 刷题侧：装载建 `Map<nodeId, BankKnowMethod[]>` → `CardInitCtx.methods`
   → `QuizCard` 的 `.wengu-method` 区块 + `CardUi.methodOpen` +
   `revealCard` 一行 `methodOpen ||= !r.ok` + scss 两条规则；
5. `stale` 徽标（展示侧）与出题侧跳过（出题注入本身不在本期，但
   `stale` 判定函数本期落地）。

**为什么先做展示**：这是**唯一用户立刻看得见的消费点**——答错就有解法
参考，价值当场兑现；而且它零 AI、零新 prompt 预算、零缓存，实现面最小。

### 第二期（出题注入）

等第一期跑一段、条目质量被用户验证过之后再做：

- `conceptPrompt` 加 `methods` 参数 + 预算常量（1200/1800 共享 3000）；
- `GenQuestion` 取条目 + 题型过滤 + 预算截断；
- 自由文本键（`kn:`/`ch:`）是否放开兜底匹配（本期先不放开，见 D3）。

**为什么放第二期**：条目质量没验证时调 prompt 预算与注入形态**必然白做**
（第一批条目可能过半是废话，注入进去只会拉低出题质量）。先让人看、
让人骂，再决定喂什么。

### 第三期（可选，视用户反馈）

- 条目手工编辑（面板新增「解法」子区）；
- 出题注入按薄弱度/命中次数排序取前 N 条；
- 条目级 `AT` 映射精度提升（多级标题路径匹配）。

### 验收口径（可执行，供实现 Issue 抄）

1. `BankKnowTree.methods` 为可选字段；旧树读取不报错、不触发 rewrite
   （`KnowTrees.test.ts` 加一条「旧树无 methods 读成 `[]`」）。
2. `parseMethodBlocks`（名字待定）纯函数单测：正常块 / 缺 `@@END` /
   `AT` 命中不到树节点 → 丢弃计数 / `TYPES` 未知题型名逐个丢 / `STEPS`
   空 → 丢条 / 超长截断不丢条，各一例。
3. `AT` → 标题块 id 映射：唯一命中记小节级 `srcHash`；重复标题/无命中
   降级 `tree:<path>`，**条目仍在**。
4. `srcHash` 变化 → `stale: true`；出题侧跳过（第二期起）、展示侧出徽标。
5. 刷题侧：作答前 `.wengu-method` 不可见（`.wengu-revealed` 闸）、答错
   默认展开、答对默认收起、`types` 与题目题型无交集时不渲染该条。
6. 重索引：同 `(nodeId, types, 步骤首步)` 复用 id，`stale` 清除。

---

## 九、待用户拍板的开放选项

以下 7 项**本稿给了推荐默认**，但需要你确认；不确认就按推荐执行：

| #   | 选项                     | 本稿推荐                                           | 备选                            | 影响面                                                                                                    |
| --- | ------------------------ | -------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| □1  | **条目粒度**             | 跟**树节点**（一个节点可多条，条目内不再按题型拆） | 按题型拆成更细条目              | 改粒度会改注入与展示的取值路径                                                                            |
| □2  | **是否可手工编辑**       | 第一期**不开放**（索引=覆盖语义，改了会被冲掉）    | 第一期就加面板编辑              | 要做需要条目级「人工修订」标记与合并策略                                                                  |
| □3  | **预算取舍**             | 正文 1800 + 解法 1200（共享 3000，正文有意截断）   | 解法 1000 + 正文 2000；或都调大 | 只影响 prompt 常量，后期好改                                                                              |
| □4  | **默认展开**             | 答错展开、答对收起                                 | 一律收起 / 一律展开             | 影响 `revealCard` 那一行                                                                                  |
| □5  | **重索引时旧条目**       | **整体覆盖**（与树一致）                           | 保留人工修订、只补新增          | 选后者需引入条目级来源标记                                                                                |
| □6  | **第一期是否先不做注入** | **是**（先只做展示）                               | 两件一起做                      | 一起做会把未验证质量直接喂进出题                                                                          |
| □7  | **`AT` 映射这层要不要**  | **要**（A：失效精度到小节）                        | B：不做映射，整篇一起 stale     | **唯一「不拍板则返工面较大」的选项**：选 B 可省掉映射表与 prompt `AT` 行，但源改一小节 ⇒ 全篇条目一起失效 |

> □7 详述：选 A 的实现成本 = prompt 多一行 + 索引时建一张归一化标题表
> （约 20 行）+ 降级分支；收益是「改哪节只失效哪节」。选 B 则所有条目
> `sourceKey` 一律 `tree:<path>`、`srcHash` 一律 `outlineSrcHash`，
> 源文档任何改动都让全篇条目 `stale`——实现更简单，但用户改一个错别字
> 就要重索引整章。**推荐 A**；若你认为条目质量本来就粗糙、不值得这层
> 精度，选 B 我也认。

---

## 十、明确不做的事（划边界，防实现时扩面）

- **不做独立「解法抽取」按钮**（D2 已述：同一份正文二次烧 token）。
- **不新开 `saveData` 键**（D1）。
- **不改 `QuestionType` 枚举**、不给解法补 i18n 题型键（D5）。
- **不把方法写进题目 kramdown**（那是内容指纹的一部分，
  `questionHash` 会跟着变 → 全库假漂移；AGENTS.md 冻结清单）。
- **不在 after 模式提交时展示解法**（揭示闸 = `.wengu-revealed`，收卷前
  一律不可见）。
- **不给 `WenguQuestion` 加解法字段**（D4：运行时展示数据不进题目
  指纹口径）。
- **不复用 `BankRecord.srcKey` 语义**（D6 术语区分）。
