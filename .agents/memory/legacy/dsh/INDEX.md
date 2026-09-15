# Project Memory Index

Before starting any task, scan this index for entries whose summary matches it and read them first. Never read the whole memory directory.

- decisions/2026-08-21-question-storage-architecture.md — 在 siyuan-plugin-wengu 上开发任何题目/题库/错题功能时适用:题目不建独立题库,一律存为思源容器块 + custom-plugin-wengu-* 自定义属性,插件只做读块/判分/写状态/进闪卡。
- decisions/2026-08-21-grading-policy.md — 实现或修改刷题判分逻辑时适用:single/multiple/judge/fill 四类客观题自动判分(大小写与空格不敏感),judge 归一化"对/错/X",fill 用 | 分隔多个可接受答案,brief 大题不自动判分、走"作答→看解析→自评"。
- conventions/2026-08-21-custom-attr-contract.md — 给题目块打属性、或让 AI 把笔记块转换成题目块时适用:必须遵循 docs/question-block-contract.md 的属性契约,统一前缀 custom-plugin-wengu-,插件侧常量见 src/wengu/attrs.ts。
- conventions/2026-08-21-repo-docs-origin.md — 翻阅本仓库文档、写 changelog 或追溯版本历史时适用:CHANGELOG.md 是官方 siyuan plugin-sample 的 changelog 残留、docs/superpowers/ 是官方 kernel 插件 demo 的设计文档,均与温故业务无关;温故业务文档只有 docs/question-block-contract.md。
- decisions/2026-08-21-block-first-question-model.md — 在 siyuan-plugin-wengu 上开发题目相关功能时适用(2026-08-21 起):题目 = 超级块容器 + part 标记子块,答案/解析存子块不存属性;容器查询必须用 b.id IN 子查询。
- conventions/2026-08-21-question-sql-and-part-pitfalls.md — 修改温故的题目查询或渲染逻辑时适用:listQuestions 必须用 b.id IN 子查询(原 root_id IN 实测返回 0 行);收集选项按 option- 前缀匹配,不要精确匹配 'option'。
- conventions/2026-08-21-answer-block-grading-input.md — 实现判分、转换题目或检查填空题时适用:answer 子块若是展示文本(如 "> 正确答案：$e^2$")会被 grade() 直接当判分原料导致永远判错;2026-08-21 已决策暂不处理,方案二选一(转换侧纯答案 / 代码侧提取)。
