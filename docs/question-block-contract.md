# 温故题目块契约（Question Block Contract）

温故插件不建独立题库。题目以思源**原生块**存储，插件只：
从一块文档树读题、页签内渲染/判分、写回状态、进闪卡、出统计。
本文件是「AI 把笔记块转换成题目块」时必须遵守的参数契约，
也是插件代码常量（`attrs.ts` / `types.ts`）的权威来源。

## 一、题目块结构（块优先，而非属性）

**一道题 = 一个超级块（Super Block）容器** + 若干带 `part` 标记的子块。

实际结构（已在真实思源验证）：

```
{{{col                                        ← 容器超级块，块上打属性
**题干……** 设 $...$ = ____                ← 子块 p   part="stem"
- A. $e$                                  ← 子块 l   part="option-0"
- B. $e^2$                                ← 子块 l   part="option-1"
> 我的答案：___                          ← 子块 b   part="mine"
> 正确答案：$e^2$                          ← 子块 b   part="answer"
> 解析文字……                               ← 子块 b   part="solution"
}}}
```

**转换完成标志**：容器块带 `custom-plugin-wengu-q = 1`。插件查询到
`attributes` 表 `name='custom-plugin-wengu-q' AND value='1'` 命中容器块 id
即认为转换完成，可以刷题。

## 二、容器块上要打的属性（前缀 `custom-plugin-wengu-`）

| 属性 | 必填 | 值 |
| --- | --- | --- |
| `q` | ✅ | `1`，转换完成标记 |
| `type` | ✅ | `single` / `multiple` / `judge` / `fill` / `brief` |
| `knowledge` | 推荐 | 知识点/考点名 |
| `chapter` | 推荐 | 章节名 |
| `difficulty` | 推荐 | `1`~`5` 星 |

> `answer` 不再做属性存放——**答案就是容器内 `part="answer"` 的子块**。
> 判分原料是「我的答案子块」与「答案子块」的文本，不是属性字符串。

`type` 判分规则：

| type | answer 子块写法 | 判分 |
| --- | --- | --- |
| single 单选 | 字母 `B` | 自动：比对象 |
| multiple 多选 | 字母串 `AD` | 自动：子集不算对 |
| judge 判断 | `√`/`×`（或 `对`/`错`） | 自动 |
| fill 填空 | 用 `\|` 分隔可接受答案 | 自动：命中一个即对 |
| brief 大题 | 解析文字 | 自评：作答→看解析→自己标对错 |

## 子块 `part` 标记（打在容器下的各子块）

| part | 含义 |
| --- | --- |
| `question-list` | 题干段（可多段，`list-*` 递增） |
| `option-*` | 选项子块（单选/多选用） |
| `mine` | 用户作答位（文档内引述块，也可由页签输入代替） |
| `answer` | 正确答案块 |
| `solution` | 解析/详解（闪卡卡背），可多个子块 |

## 三、运行时状态属性（插件写入，属性视图读）

插队作答后写下列属性到**容器块**：

| 属性 | 值 | 含义 |
| --- | --- | --- |
| `attempts` | 整数 | 刷题次数 |
| `last-answer` | 文本 | 最近一次我的答案 |
| `right` | `0`/`1`/空 | 最近一次正误 |

## 四、渲染与答题

- 页签打开时，取当前文档 id，递归取容器超级块 → 每题一张卡片。
- 卡片内把 `stem` + `option-*` 子块的 kramdown 交给思源 Lute
  （`window.Lute.Md2BlockDOM`）渲染成与文档一致的外观，CSS 全部用思源
  内置类名/主题变量，不用自定义样式。
- `answer` / `solution` 子块**不渲染**（答坑隐藏），判分后展开。
- 作答：页签输入框；客观题自动判分，写 `attempts/last-answer/right`；
  `brief` 走展示解析→自评（产品决策 2）。错题由 riff 把容器块加成闪卡
  （产品决策 3）。

## 五、与平台机制对应（全部真实验证）

- 自定义属性存 `attributes` 表 `name`/`value`，SQL 可查；单块属性
  `/api/attr/getBlockAttrs` `/api/attr/setBlockAttrs`。
- 容器块问：`/api/block/getChildBlocks`（`data[].id/type/markdown/content`）。
- 容器整块 kramdown：`/api/block/getBlockKramdown`（含全部子块源码+IAL）。
- 渲染：`window.Lute.Md2BlockDOM`。
- 闪卡：riff `addFlashcards`（deckID + blockIDs）。