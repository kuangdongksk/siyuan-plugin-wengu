---
name: wengu-col-folder-branch
description: col-folder 已并dev(d03eab7)——专题管理新建文件夹+官方文档树样式，合并版d95aad7已部署待验收
metadata:
    node_type: memory
    type: project
    originSessionId: sess_e55da06e-c0ae-4c4a-b4ef-dddabd4b5a36
---

col-folder 分支（提交 903e9b2）**已并入 dev 并清理完毕**（worktree/分支已删）。合并是并发完成的：另一会话把我卡在 CHANGELOG 冲突中的合并直接提交成 d03eab7，随后又并 opt-compact 成 d95aad7；期间我按行号 sed 删标记因行号漂移误删正文——**教训：并发窗口下禁用行号编辑，一律按模式匹配**。合并版 d95aad7 已构建部署机器 A 待用户验收。

功能内容（仍在待验收状态）：

- **新建文件夹**：BankData 新增 `folders` 字段（旧数据缺省补 []），CRUD 在友元模块 `src/bank/data/BankFolders.ts`（QuestionBank 卡 500 行红线）；删除=两击确认+严格前缀下专题连带清 col: 会话（同名平铺专题不牵连）。
- **官方树样式**：CollectionPanel 重写为官方文档树同款 DOM（ul.b3-list--background + b3-list-item--hide-action 行壳、__toggle/__arrow 折叠、counter 徽标、hover __action 图标+b3-tooltips、行内 --file-toggle-width），行与子目录按名混排，统计移入 tooltip；专题删除也改图标两击确认。
- 图标全走官方 sprite（iconFolder/iconEdit/iconTrashcan/iconAdd 均在 litheness icon.js 验证存在）。
- **prettier 坑**：`prettier --write .` 会把文档里的 `~x` 规范成 `~~x`（question-block-contract.md 两处，主仓库另一会话同款脏改同源）——不是人为编辑，属格式化噪音。

关联 [[project-parallel-sessions]]、[[wengu-full-audit-20260828]]。
