---
name: variant-and-doctree-impl
description: 变式重练+侧栏文档树化一期+KnowPicker树化二期全部完成——已提交推送(9218a66/b5cba82,2026-08-27)并部署机器A，待用户真机验收；实施记录在 docs/variant-and-doctree.md §六
metadata:
  node_type: memory
  type: project
  originSessionId: sess_80365c10-95e4-4c34-8546-4da799d802a1
---

设计 [[variant-and-doctree-design]]（docs/variant-and-doctree.md）：一期
（V1~V4 变式重练 + S1~S3 侧栏树）2026-08-26 实施，二期（□6/T1~T3
KnowPicker 树化）2026-08-27 完成——**均已提交推送**（一期 b5cba82，
二期 9218a66，一期里同批收进右键删除文档见 [[wengu-delete-doc-feature]]）
并部署机器 A 重载，待用户真机验收。

一期落点：
- `bank/GenQuestion.ts` generateVariantOf（按题变式，模板=题自己）+
  `bank/QuestionBank.ts` recordsOfDoc。
- `bank/VariantDrill.ts`（新）：右键「变式重练」→ 范围（整卷/仅错题）+数量
  1~10 → 串行生成追加《{卷名}·变式 时间戳》专题（每次新建）→ 自动切换。
- `quiz/SideTree.ts`（新）：buildSideTree/renderSideTree，自建 wengu-tree
  类名借思源文档树结构（toggle 箭头旋转+缩进）。
- 树展开态 prefs.sideTreeOpen 持久化，首载默认第一层；搜索词非空退回平铺。
- 右键菜单现有三项：错题复习/删除文档/变式重练。

二期落点（2026-08-27）：
- `ui/PickerTree.ts`（新）：buildPickerTree（笔记本首段纯容器根，同路径
  撞名以同名子行挂载）+ renderPickerTree（行壳 b3-list-item，toggle/缩进
  复用 base.scss wengu-tree 全局类；仅文档行 data-id 可选，分支行
  data-tree-path 只折叠且事件优先级更高）。
- `ui/KnowPicker.ts`：空搜索默认树——首开 `SELECT id,hpath` 按 LIMIT 100
  OFFSET 串行分页拉全量（ORDER BY hpath 保分页稳定），60s 缓存；关键词切
  平铺/清空回树；转换知识文档多选与源/父文档单选入口无改动直接受益。
- 树展开态是浮层内会话态（不持久化），默认展开笔记本级。

- 二刷乱序选项（装载边界洗牌副本）已对齐方案但**未实施**，独立小项。

**Why:** 「继续完成文档中写好的事情」= 按设计文档把二期做完（自主决策授权）。
**How to apply:** 验收反馈改动时先看 §六实施记录定位文件；变式生成走
addGenerated（gen- qid），不写回源文档。相关：[[wengu-source-col-sidebar-dup]]
（S3 同批修复）。
