---
name: wengu-source-col-sidebar-dup
description: 侧栏「源卷专题」与文档条目双显缺陷——已修（2026-08-26 随侧栏树化落地，S3 侧栏过滤 doc: 影子行）；专题管理弹窗仍可见
metadata:
  type: project
---

用户 2026-08-26 报侧栏同一篇文档出现两条（贴了渲染 HTML 实证）：专题组
「X·源卷」(data-colid="doc:<文档id>") + 文档组「X」(data-docid) 同 id 同
题数并存，且信息不对称（文档条带「已刷 N·时长」，源卷条只有题数）。

**成因（有意设计留重复）**：`QuestionBank.ts` refreshDoc 入库时自动创建
源卷影子专题（id=`doc:<docId>`，标题 `<文档名>·源卷`）——为让题库/专题域
以专题为统一单元覆盖文档。两种入口：文档组=文档模式（实时块、计时记文档
属性），源卷=题库模式（存档记录+专题操作）。

**已修（2026-08-26 深夜，随 [[variant-and-doctree-impl]] 侧栏树化 S3）**：
`CardHtml.renderSideBodyHtml` 专题区渲染时过滤 `doc:` 开头行——文档树本体
已在眼前；源卷专题在题库内部照常存在（专题管理弹窗/收集补题/归档不受
影响）。refreshDoc 的自动创建逻辑未动。

**Why:** 用户认定是缺陷；侧栏树化后双显更刺眼，一并消除。
**How to apply:** 再遇「侧栏少了源卷专题」类反馈时说明是 S3 有意过滤，
去专题管理弹窗操作；相关：[[wengu-ai-gen-branch]]（影子专题出生地）。
