---
name: wengu-delete-doc-feature
description: 侧栏文档右键「删除文档」+专题对话框 iconList 巨图修复——已随变式一期提交(b5cba82)推送部署，待用户验收
metadata:
    node_type: memory
    type: project
    originSessionId: sess_80365c10-95e4-4c34-8546-4da799d802a1
---

2026-08-26 晚落地并部署（tsc/eslint/prettier/67 测/build 全绿；
setPetalEnabled off→on 均 code 0；部署时 i18n 一并拷贝），
**2026-08-27 已随 [[variant-and-doctree-impl]] 一期提交（b5cba82）推送**：

- **右键删除文档**：ViewBindings 文档行 contextmenu 加 iconTrashcan 菜单项
  （与「错题复习」同场）；QuizView.deleteDocOf 编排 = KernelDoc.remove（删入
  思源回收站可找回）→ QuestionBank.removeDocData（清该卷 records/hashed/
  doc: 影子专题/各专题 qid 引用/migratedDocs；gen- 生成题不挂 sourceDocId
  不受影响）→ history.removeDocs → load()（QuizLoader 选中回退链
  当前>记住>活动>第一个 自动切离被删卷，无需手动清 docId）。
- **iconList 巨图修复**：专题对话框已有专题行的 svgIcon 裸 svg 没进全局
  14px 清单（[[wengu-dock-icon-branch]] 裸 svg 300×150 坑又一例）——
  panels.scss 全局清单补 .wengu-col-row-title svg（14px+vertical-align -2px）。
- i18n 两份加 deleteDocMenuLabel（插在 reviewMenuLabel 之后）。

验收方式：重开温故页签，侧栏文档行右键应见「删除文档」；专题管理里
源卷行前的图标不再撑大。
