---
name: variant-and-doctree-design
description: 变式重练+文档树形化设计文档 docs/variant-and-doctree.md 已产出，待用户逐条过 §五 □1~□7
  后实施；二刷乱序选项已对齐方案但明确独立成项不混入
metadata:
  node_type: memory
  type: project
  originSessionId: sess_80365c10-95e4-4c34-8546-4da799d802a1
---

2026-08-26 晚用户口令「先把我发你的落实成文档」（按 [[feedback-discussion-style]]
先审后做）产出 docs/variant-and-doctree.md。**下一步=用户逐条过 §五 □1~□7
（入口/范围/产物/展开层级/影子专题隐去/树搜索融合/分期），过完再动手。**

已对齐的方案要点：

- **变式重练**：现有 variant 生成（=以原题模板改数字/换条件/反向提问，
  GenQuestion.ts）只会按知识点挑模板（GenCore），需新增按题生成核
  `generateVariantOf(qid)`；入口=侧栏文档行右键菜单；范围「整卷/仅错题」+
  单轮 1~10 题（做完可再开一批，薄弱加练同款节奏）；产物每次新建
  《{卷名}·变式》专题（带时间戳后缀防同名），会话挂 col: 域与原卷统计隔离。
- **侧栏树形化（一期）**：WenguDoc[] 已带完整 hPath，切分建树即可；中间路径
  做纯容器分支；默认展开第一层、展开态存 prefs（sideTreeOpen）；顺带隐去
  doc: 源卷影子专题行（[[wengu-source-col-sidebar-dup]] 修法并入 □5）；
  右键菜单挂树行（容器级事件委托已存在不用重绑）。
- **KnowPicker 树化（二期）**：懒加载分页拉全量 type='d' 建树（SQL 无 LIMIT
  截断 64 行坑须分页），输关键词切平铺结果（思源文档树自己的模式）；类名
  自建 wengu-tree 只借结构不借官方 b3 类名（防内核升级）。
- **「二刷乱序选项」不混入本设计**（§〇 注明）：方案已对齐=装载轮次时生成
  洗牌副本（重排 optionMd+同步改写答案字母），判分是「字母→选项内容」双重
  比对（QuestionGrading.ts:20-25）天然兼容，源块不动；独立小项后续单独做。

**Why:** OptionShuffle 现只在转换落盘时洗一次（AI 输出正确项恒居首的补丁），
之后顺序固定会泄露答案位；用户二刷诉求=每次开刷顺序不同。
**How to apply:** 实施从一期开始（变式+侧栏树互相成就：树行右键即变式入口）；
动手前先看用户对 □1~□7 的表态，别默认全按文档建议项执行。
